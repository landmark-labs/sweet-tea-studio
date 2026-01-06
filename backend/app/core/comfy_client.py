"""HTTP + WebSocket client wrapper for interacting with ComfyUI."""

import json
import uuid
import urllib.request
import urllib.parse
import urllib.error
import websocket
import time
import socket
import os
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Callable
from app.models.engine import Engine


@dataclass
class NodeTimingInfo:
    """Timing info for a single node execution."""
    node_id: str
    node_type: Optional[str] = None
    start_time_ms: Optional[float] = None
    end_time_ms: Optional[float] = None
    duration_ms: Optional[int] = None
    execution_order: int = 0
    from_cache: bool = False
    vram_mb: Optional[float] = None  # VRAM usage at node start (if sampled)


@dataclass
class ExecutionMetrics:
    """Execution metrics collected during a run."""
    total_duration_ms: int = 0
    node_timings: List[NodeTimingInfo] = field(default_factory=list)
    cached_nodes: List[str] = field(default_factory=list)


class ComfyConnectionError(Exception):
    """Raised when unable to connect to ComfyUI instance."""
    pass


class ComfyResponseError(Exception):
    """Raised when ComfyUI returns an error response."""
    pass

class ComfyClient:
    """Handles synchronous HTTP calls and streaming WebSocket updates to ComfyUI."""

    def __init__(self, engine: Engine):
        # Store engine so URL construction always targets the configured instance.
        self.engine = engine
        # ComfyUI pairs WebSocket streams to a client id; generate once per client.
        self.client_id = str(uuid.uuid4())
        # WebSocket handle; lazily connected when a streaming call is made.
        self.ws = None
        # Network jitter is common; keep backoff tuning as attributes for reuse.
        self._default_backoff = 1
        self._max_backoff = 30

    def _get_url(self, path: str) -> str:
        base = self.engine.base_url.rstrip("/")
        if not base.startswith("http"):
            # Handle cases where the user provided a bare host or ws:// scheme. We
            # intentionally avoid mutation to prevent accidental double schemes and
            # let the upstream urllib error message remain accurate for debugging.
            pass
        return f"{base}{path}"

    def connect(self, *, max_attempts: int = 5):
        """Connect to the ComfyUI WebSocket with exponential backoff."""
        ws_url = self._get_url(f"/ws?clientId={self.client_id}").replace("http", "ws")

        delay = self._default_backoff
        for attempt in range(max_attempts):
            try:
                self.ws = websocket.WebSocket()
                self.ws.connect(ws_url, timeout=5)
                self.ws.settimeout(10)
                return
            except (ConnectionRefusedError, socket.timeout, websocket.WebSocketException, Exception) as e:
                if attempt == max_attempts - 1:
                    raise ComfyConnectionError(
                        f"Failed to connect to ComfyUI at {self.engine.base_url} after {max_attempts} attempts. Is it running?"
                    ) from e
                time.sleep(delay)
                delay = min(delay * 2, self._max_backoff)

    def _ping(self):
        """Send a WebSocket ping to ensure the connection is alive."""
        if not self.ws:
            return False

        try:
            self.ws.ping()
            return True
        except Exception:
            return False

    def _reconnect_with_backoff(self, initial_delay: int):
        """Attempt to reconnect using exponential backoff."""
        delay = max(initial_delay, self._default_backoff)

        while delay <= self._max_backoff:
            if self.check_health():
                try:
                    self.connect()
                    return
                except ComfyConnectionError:
                    pass

            time.sleep(delay)
            delay = min(delay * 2, self._max_backoff)

        raise ComfyConnectionError(
            f"WebSocket connection lost during execution and failed to reconnect to {self.engine.base_url}."
        )

    def check_health(self) -> bool:
        """Lightweight check to see if ComfyUI is reachable."""
        try:
            self.get_object_info()
            return True
        except ComfyConnectionError:
            return False

    def queue_prompt(self, prompt: Dict[str, Any]) -> str:
        """Submit a workflow to ComfyUI."""
        p = {"prompt": prompt, "client_id": self.client_id}
        data = json.dumps(p).encode('utf-8')
        try:
            req = urllib.request.Request(
                self._get_url("/prompt"),
                data=data,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                payload = json.loads(response.read())
                node_errors = payload.get("node_errors")
                if isinstance(node_errors, dict) and node_errors:
                    raise ComfyResponseError(
                        f"ComfyUI prompt validation failed: {json.dumps(node_errors, ensure_ascii=False)}"
                    )

                prompt_id = payload.get("prompt_id")
                if not isinstance(prompt_id, str) or not prompt_id:
                    raise ComfyResponseError(
                        f"ComfyUI response missing prompt_id: {json.dumps(payload, ensure_ascii=False)}"
                    )
                return prompt_id
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            raise ComfyResponseError(f"ComfyUI Error {e.code}: {error_body}") from e
        except urllib.error.URLError as e:
            raise ComfyConnectionError(f"Could not connect to ComfyUI at {self.engine.base_url}. Is it running?") from e

    def interrupt(self):
        """Interrupt the current execution."""
        try:
            req = urllib.request.Request(self._get_url("/interrupt"), data=b"", method="POST")
            urllib.request.urlopen(req, timeout=5)
        except urllib.error.URLError:
            # If we can't connect to interrupt, it's probably already dead or down.
            # We log it but don't crash, as this is often called during cleanup
            print(f"Warning: Could not connect to interrupt ComfyUI at {self.engine.base_url}")
        except Exception as e:
            print(f"Failed to interrupt: {e}")

    def get_queue(self) -> Dict[str, Any]:
        """Get the current ComfyUI execution queue."""
        try:
            with urllib.request.urlopen(self._get_url("/queue"), timeout=5) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            raise ComfyResponseError(f"ComfyUI Error {e.code}: {error_body}") from e
        except urllib.error.URLError as e:
            raise ComfyConnectionError(f"Could not retrieve queue from {self.engine.base_url}") from e

    def update_queue(self, *, clear: bool = False, delete: Optional[List[object]] = None) -> Dict[str, Any]:
        """
        Update the ComfyUI queue.

        Args:
            clear: If True, clear the pending queue.
            delete: If provided, delete these queue items (token is ComfyUI-defined).

        Returns:
            Parsed JSON response from ComfyUI.
        """
        payload: Dict[str, Any] = {}
        if clear:
            payload["clear"] = True
        if delete:
            payload["delete"] = delete

        data = json.dumps(payload).encode("utf-8")
        try:
            req = urllib.request.Request(self._get_url("/queue"), data=data, method="POST")
            req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=10) as response:
                body = response.read()
                return json.loads(body) if body else {"ok": True}
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            raise ComfyResponseError(f"ComfyUI Error {e.code}: {error_body}") from e
        except urllib.error.URLError as e:
            raise ComfyConnectionError(f"Could not update queue on {self.engine.base_url}") from e

    @staticmethod
    def _extract_queue_entries(queue_items: object) -> List[Dict[str, object]]:
        """
        Normalize ComfyUI queue entries into dicts:
          { "prompt_id": <str>, "delete_token": <object> }

        ComfyUI has changed queue payload shapes over time; keep this permissive.
        """
        entries: List[Dict[str, object]] = []
        if not isinstance(queue_items, list):
            return entries

        for item in queue_items:
            prompt_id: Optional[str] = None
            delete_token: object | None = None

            if isinstance(item, (list, tuple)):
                if item:
                    delete_token = item[0]
                for element in item:
                    if isinstance(element, str) and element:
                        prompt_id = element
                        break

            elif isinstance(item, dict):
                raw_prompt_id = item.get("prompt_id") or item.get("promptId") or item.get("id")
                if isinstance(raw_prompt_id, str) and raw_prompt_id:
                    prompt_id = raw_prompt_id
                delete_token = item.get("id") or prompt_id

            if isinstance(prompt_id, str) and prompt_id and delete_token is not None:
                entries.append({"prompt_id": prompt_id, "delete_token": delete_token})

        return entries

    def cancel_prompt(self, prompt_id: str) -> Dict[str, Any]:
        """
        Best-effort cancel for a single prompt:
        - If prompt is currently running, interrupt execution
        - If prompt is pending, remove it from the queue

        Returns:
            Dict with diagnostic info about what was attempted.
        """
        result: Dict[str, Any] = {
            "prompt_id": prompt_id,
            "interrupted": False,
            "deleted": False,
            "delete_tokens": [],
        }
        if not isinstance(prompt_id, str) or not prompt_id:
            return result

        queue = self.get_queue()
        running_entries = self._extract_queue_entries(queue.get("queue_running"))
        pending_entries = self._extract_queue_entries(queue.get("queue_pending"))

        if any(entry.get("prompt_id") == prompt_id for entry in running_entries):
            self.interrupt()
            result["interrupted"] = True

        delete_tokens = [
            entry.get("delete_token")
            for entry in (pending_entries + running_entries)
            if entry.get("prompt_id") == prompt_id and entry.get("delete_token") is not None
        ]
        result["delete_tokens"] = delete_tokens

        if delete_tokens:
            try:
                self.update_queue(delete=delete_tokens)
                result["deleted"] = True
            except Exception:
                result["deleted"] = False

        return result

    def get_object_info(self) -> Dict[str, Any]:
        """Retrieve node definitions from ComfyUI."""
        try:
            with urllib.request.urlopen(self._get_url("/object_info"), timeout=5) as response:
                return json.loads(response.read())
        except urllib.error.URLError as e:
            raise ComfyConnectionError(f"Could not retrieve node definitions from {self.engine.base_url}. Is it running?") from e

    def get_history(self, prompt_id: str) -> Dict[str, Any]:
        """Retrieve history for a specific prompt ID."""
        try:
            with urllib.request.urlopen(self._get_url(f"/history/{prompt_id}"), timeout=10) as response:
                return json.loads(response.read())
        except urllib.error.URLError as e:
            raise ComfyConnectionError(f"Could not retrieve history from {self.engine.base_url}") from e

    def get_system_stats(self) -> Dict[str, Any]:
        """Retrieve system stats including version info from ComfyUI."""
        try:
            with urllib.request.urlopen(self._get_url("/system_stats"), timeout=5) as response:
                return json.loads(response.read())
        except urllib.error.URLError as e:
            raise ComfyConnectionError(f"Could not retrieve system stats from {self.engine.base_url}") from e

    def free_memory(self, unload_models: bool = False, free_memory: bool = False) -> bool:
        """
        Request ComfyUI to free memory/unload models.
        
        Args:
            unload_models: If True, unload models from VRAM
            free_memory: If True, free all memory (VRAM + RAM)
            
        Returns:
            True if successful
        """
        payload = {}
        if unload_models:
            payload["unload_models"] = True
        if free_memory:
            payload["free_memory"] = True
            
        if not payload:
            return True  # Nothing to do
            
        data = json.dumps(payload).encode('utf-8')
        try:
            req = urllib.request.Request(
                self._get_url("/free"),
                data=data,
                method="POST"
            )
            req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=10) as response:
                return response.status == 200
        except urllib.error.URLError as e:
            raise ComfyConnectionError(f"Could not free memory on {self.engine.base_url}. Is it running?") from e



    def get_images(
        self,
        prompt_id: str,
        progress_callback=None,
        on_image_callback=None,
        track_timing: bool = False,
        workflow_graph: Optional[Dict[str, Any]] = None,
        cancel_check: Optional[Callable[[], bool]] = None,
    ) -> tuple[List[Dict[str, Any]], Optional[ExecutionMetrics]]:
        """
        Wait for job completion and retrieve output images.
        Optional progress_callback(data: dict) called on updates.
        Optional on_image_callback(data: dict) called when an image is received.
        Also captures images sent via SaveImageWebsocket node.
        
        If track_timing=True, returns ExecutionMetrics with node timing data.
        workflow_graph is used to look up node class types for timing info.
        
        Returns:
            Tuple of (output_images_list, execution_metrics_or_none)
        """
        if not self.ws:
            self.connect()

        debug_ws = os.getenv("SWEET_TEA_COMFY_DEBUG", "").lower() in ("1", "true", "yes")

        def _debug(message: str):
            if debug_ws:
                print(message)

        def _close_ws():
            if self.ws:
                try:
                    self.ws.close()
                except Exception:
                    pass
                self.ws = None

        print(f"Listening for completion of {prompt_id}...")
        backoff = self._default_backoff
        reconnect_attempts = 0
        max_reconnect_attempts = 10
        
        # Store images captured from WebSocket binary stream (SaveImageWebsocket node)
        captured_images: List[Dict[str, Any]] = []
        # Track preview images as fallback when no SaveImage node exists
        preview_images: List[Dict[str, Any]] = []
        max_preview_images = 3
        image_counter = 0
        preview_counter = 0
        execution_complete = False  # Track when node execution finishes
        self._last_preview_time = 0
        preview_stream_enabled = os.getenv("SWEET_TEA_PREVIEW_STREAM", "true").lower() not in ("0", "false", "no")
        preview_max_fps_raw = os.getenv("SWEET_TEA_PREVIEW_MAX_FPS", "2").strip()
        try:
            preview_max_fps = float(preview_max_fps_raw)
        except ValueError:
            preview_max_fps = 2.0
        preview_min_interval = (1 / preview_max_fps) if preview_max_fps > 0 else None
        
        # Timing tracking (when enabled)
        execution_start_time_ms: Optional[float] = None
        node_timing_map: Dict[str, NodeTimingInfo] = {}  # node_id -> timing info
        current_node_id: Optional[str] = None
        node_execution_order: int = 0
        cached_nodes: List[str] = []

        try:
            while True:
                if cancel_check and cancel_check():
                    _close_ws()
                    return [], None

                try:
                    out = self.ws.recv()
                    backoff = self._default_backoff
                    reconnect_attempts = 0  # Reset on successful receive
                except websocket.WebSocketTimeoutException:
                    # A timeout is normal while waiting for new frames; if the ping
                    # also fails we proactively reconnect to avoid missing events.
                    if not self._ping():
                        self._reconnect_with_backoff(backoff)
                        backoff = min(backoff * 2, self._max_backoff)
                    # If execution already completed and we timeout, we're done
                    if execution_complete:
                        break
                    if cancel_check and cancel_check():
                        _close_ws()
                        return [], None
                    continue
                except (websocket.WebSocketException, ConnectionResetError, socket.error):
                    # Hard disconnect; re-establish the connection and back off so we
                    # do not hammer a recovering ComfyUI instance.
                    reconnect_attempts += 1
                    if reconnect_attempts > max_reconnect_attempts:
                        _close_ws()
                        raise ComfyConnectionError(
                            f"Lost connection to ComfyUI after {max_reconnect_attempts} reconnection attempts."
                        )
                    print(f"Connection lost, reconnection attempt {reconnect_attempts}/{max_reconnect_attempts}")
                    self._reconnect_with_backoff(backoff)
                    backoff = min(backoff * 2, self._max_backoff)
                    continue

                # Handle TEXT messages (JSON)
                if isinstance(out, str):
                    message = json.loads(out)
                    if progress_callback:
                        progress_callback(message)

                    if message['type'] == 'execution_error':
                        # ComfyUI reports a node execution failure
                        data = message.get('data', {})
                        node_id = data.get('node_id', 'unknown')
                        node_type = data.get('node_type', 'unknown')
                        exception_message = data.get('exception_message', 'Unknown error')
                        _close_ws()
                        raise ComfyResponseError(
                            f"ComfyUI execution failed at node {node_id} ({node_type}): {exception_message}"
                        )

                    if message['type'] == 'executing':
                        data = message['data']
                        current_time_ms = time.time() * 1000
                        
                        # Track timing if enabled
                        if track_timing:
                            if execution_start_time_ms is None:
                                execution_start_time_ms = current_time_ms
                            
                            # Close out previous node timing
                            if current_node_id and current_node_id in node_timing_map:
                                prev_timing = node_timing_map[current_node_id]
                                prev_timing.end_time_ms = current_time_ms
                                if prev_timing.start_time_ms:
                                    prev_timing.duration_ms = int(current_time_ms - prev_timing.start_time_ms)
                            
                            # Start timing for new node
                            new_node_id = data.get('node')
                            if new_node_id and new_node_id not in node_timing_map:
                                node_execution_order += 1
                                node_type = None
                                if workflow_graph and new_node_id in workflow_graph:
                                    node_type = workflow_graph[new_node_id].get('class_type')
                                node_timing_map[new_node_id] = NodeTimingInfo(
                                    node_id=new_node_id,
                                    node_type=node_type,
                                    start_time_ms=current_time_ms,
                                    execution_order=node_execution_order,
                                )
                            current_node_id = new_node_id
                        
                        if data['node'] is None and data['prompt_id'] == prompt_id:
                            # Execution complete - signal frontend immediately!
                            execution_complete = True
                            print(f"[ComfyClient] Execution complete detected for {prompt_id}, sending execution_complete callback")
                            if progress_callback:
                                progress_callback({"type": "execution_complete", "prompt_id": prompt_id})
                            # Clear earlier preview images - only keep post-completion ones
                            preview_images.clear()
                            preview_counter = 0
                            # Use a very short timeout to catch any trailing images, then exit
                            # This prevents waiting for the full 10s socket timeout
                            if self.ws:
                                self.ws.settimeout(1)
                    
                    continue  # Done processing text message
                
                # Handle BINARY messages (images)
                elif isinstance(out, bytes) and len(out) > 8:
                    import struct
                    import base64
                    
                    # ComfyUI Binary Message Format:
                    # 4 bytes: Event Type (1=Preview Image, 2=Final Image from SaveImageWebsocket)
                    # 4 bytes: Image Format (1=JPEG, 2=PNG)
                    # Remaining: Image Data
                    
                    event_type = struct.unpack('>I', out[0:4])[0]  # Big-Endian Unsigned Int
                    image_format = struct.unpack('>I', out[4:8])[0]
                    image_data = out[8:]
                    
                    _debug(f"[ComfyClient] Received BINARY frame. EventType: {event_type}, Format: {image_format}, DataLen: {len(image_data)}")
                    
                    if event_type == 1:  # PREVIEW_IMAGE
                        _debug(f"[ComfyClient] Received PREVIEW_IMAGE (Event 1). Length: {len(image_data)} bytes")
                        # Throttle previews to avoid overwhelming the WebSocket
                        # Always process if execution is complete (to ensure we capture the final result)
                        current_time = time.time()
                        if not execution_complete and preview_min_interval is not None:
                            if (current_time - self._last_preview_time) < preview_min_interval:
                                continue
                        self._last_preview_time = current_time

                        # Store preview image - will be cleared when execution completes
                        # Post-completion previews are the FINAL output from PreviewImage node
                        preview_counter += 1
                        ext = "jpg" if image_format == 1 else "png"
                        preview_images.append({
                            "filename": f"gen_{prompt_id[:8]}_{preview_counter:03d}.{ext}",
                            "image_bytes": image_data,
                            "format": ext,
                            "source": "final_preview" if execution_complete else "ksampler_preview"
                        })
                        if len(preview_images) > max_preview_images:
                            preview_images = preview_images[-max_preview_images:]
                        
                        if preview_stream_enabled and progress_callback:
                            # Convert to base64 for frontend preview
                            b64_img = base64.b64encode(image_data).decode('utf-8')
                            prefix = "data:image/jpeg;base64," if image_format == 1 else "data:image/png;base64,"
                            progress_callback({
                                "type": "preview",
                                "data": {
                                    "blob": f"{prefix}{b64_img}",
                                    "is_final": execution_complete
                                }
                            })
                        
                        # If this came after execution complete, we got our final image - done!
                        if execution_complete:
                            break
                    
                    elif event_type == 2:  # FINAL_IMAGE (SaveImageWebsocket)
                        # This is a final output image - capture it!
                        image_counter += 1
                        ext = "jpg" if image_format == 1 else "png"
                        filename = f"ws_image_{prompt_id[:8]}_{image_counter:03d}.{ext}"
                        
                        image_info = {
                            "filename": filename,
                            "subfolder": "",
                            "type": "output",
                            "image_bytes": image_data,  # Raw bytes for direct save
                            "format": ext,
                            "source": "websocket",
                            "kind": "image",
                        }
                        captured_images.append(image_info)
                        
                        if on_image_callback:
                            try:
                                on_image_callback(image_info)
                            except Exception as e:
                                print(f"Error in on_image_callback: {e}")

                        _debug(f"Captured image from WebSocket: {filename} ({len(image_data)} bytes)")
                        
                        if preview_stream_enabled and progress_callback:
                            # Also send preview to frontend
                            b64_img = base64.b64encode(image_data).decode('utf-8')
                            prefix = "data:image/jpeg;base64," if image_format == 1 else "data:image/png;base64,"
                            progress_callback({
                                "type": "preview",
                                "data": {
                                    "blob": f"{prefix}{b64_img}",
                                    "is_final": True
                                }
                            })
                    
                    continue  # Done processing binary message
                    
        except (websocket.WebSocketException, ConnectionResetError) as e:
            _close_ws()
            raise ComfyConnectionError(f"WebSocket connection lost during execution.") from e
        except Exception:
            _close_ws()
            raise

        # Helper to build ExecutionMetrics from collected timing data
        def _build_metrics() -> Optional[ExecutionMetrics]:
            if not track_timing:
                return None
            end_time_ms = time.time() * 1000
            total_duration = int(end_time_ms - execution_start_time_ms) if execution_start_time_ms else 0
            node_list = sorted(node_timing_map.values(), key=lambda n: n.execution_order)
            return ExecutionMetrics(
                total_duration_ms=total_duration,
                node_timings=node_list,
                cached_nodes=cached_nodes,
            )

        # If we captured images via WebSocket, use those (no HTTP download needed)
        if captured_images:
            print(f"Using {len(captured_images)} images captured from WebSocket stream")
            _close_ws()
            return captured_images, _build_metrics()

        def _history_output_images() -> List[Dict[str, Any]]:
            try:
                history_map = self.get_history(prompt_id)
                history = history_map.get(prompt_id) if isinstance(history_map, dict) else None
                if not history and isinstance(history_map, dict) and prompt_id in history_map:
                    history = history_map[prompt_id]
            except Exception:
                return []

            if not isinstance(history, dict):
                return []

            outputs = history.get("outputs") or {}
            if not isinstance(outputs, dict):
                return []

            output_items: List[Dict[str, Any]] = []
            for node_id, node_output in outputs.items():
                if not isinstance(node_output, dict):
                    continue
                # Debug: print all available keys in this node output
                output_keys = list(node_output.keys())
                print(f"[ComfyClient] Node {node_id} output keys: {output_keys}")
                if output_keys:
                    for key in output_keys:
                        val = node_output.get(key)
                        if isinstance(val, list) and len(val) > 0:
                            print(f"[ComfyClient]   {key} has {len(val)} items, first item: {val[0] if val else 'empty'}")
                images = node_output.get("images") or []
                if isinstance(images, list):
                    for image in images:
                        if not isinstance(image, dict):
                            continue
                        filename = image.get("filename")
                        if not filename:
                            continue
                        subfolder = image.get("subfolder") or ""
                        image_type = image.get("type") or "output"
                        img = dict(image)
                        img["url"] = self._get_url(
                            f"/view?filename={urllib.parse.quote(str(filename))}"
                            f"&subfolder={urllib.parse.quote(str(subfolder))}"
                            f"&type={urllib.parse.quote(str(image_type))}"
                        )
                        img["kind"] = "image"
                        output_items.append(img)

                # Check for videos under "videos" key (standard) and "gifs" key (VHS_VideoCombine)
                for video_key in ("videos", "gifs"):
                    videos = node_output.get(video_key) or []
                    if isinstance(videos, list) and len(videos) > 0:
                        print(f"[ComfyClient] Found {len(videos)} video(s) in node output under '{video_key}' key")
                        for video in videos:
                            if not isinstance(video, dict):
                                continue
                            filename = video.get("filename")
                            if not filename:
                                continue
                            # Skip non-video files (e.g., PNG workflow files)
                            if not any(filename.lower().endswith(ext) for ext in ('.mp4', '.webm', '.mov', '.mkv', '.avi', '.gif')):
                                continue
                            subfolder = video.get("subfolder") or ""
                            video_type = video.get("type") or "output"
                            vid = dict(video)
                            vid["url"] = self._get_url(
                                f"/view?filename={urllib.parse.quote(str(filename))}"
                                f"&subfolder={urllib.parse.quote(str(subfolder))}"
                                f"&type={urllib.parse.quote(str(video_type))}"
                            )
                            vid["kind"] = "video"
                            print(f"[ComfyClient] Video output: filename={filename}, type={video_type}, subfolder={subfolder}")
                            output_items.append(vid)

            return output_items

        # Prefer history outputs whenever possible so we preserve the true ComfyUI
        # filenames (including `type=temp` previews stored under ComfyUI/temp).
        # History can lag slightly behind the websocket completion signal, so retry briefly.
        for _attempt in range(5):
            output_items = _history_output_images()
            if output_items:
                _close_ws()
                return output_items, _build_metrics()
            time.sleep(0.2)

        # Fallback: Use the last preview image(s) as output when no history images exist.
        # This handles workflows using only PreviewImage nodes even if ComfyUI doesn't persist temp files.
        if preview_images:
            print(f"No history images detected. Using {len(preview_images)} preview image(s) as final output")
            last_preview = preview_images[-1]
            result = [
                {
                    "filename": f"gen_{prompt_id[:8]}_{1:03d}.{last_preview['format']}",
                    "subfolder": "",
                    "type": "output",
                    "image_bytes": last_preview["image_bytes"],
                    "format": last_preview["format"],
                    "source": "preview_fallback",
                    "kind": "image",
                }
            ]
            _close_ws()
            return result, _build_metrics()

        _close_ws()
        return [], _build_metrics()
