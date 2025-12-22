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
from typing import Dict, Any, List, Optional
from app.models.engine import Engine

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
            req = urllib.request.Request(self._get_url("/prompt"), data=data)
            with urllib.request.urlopen(req, timeout=10) as response:
                return json.loads(response.read())['prompt_id']
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


    def get_images(self, prompt_id: str, progress_callback=None) -> List[Dict[str, Any]]:
        """
        Wait for job completion and retrieve output images.
        Optional progress_callback(data: dict) called on updates.
        Also captures images sent via SaveImageWebsocket node.
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

        try:
            while True:
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
                        if data['node'] is None and data['prompt_id'] == prompt_id:
                            # Execution complete - signal frontend immediately!
                            execution_complete = True
                            print(f"[ComfyClient] Execution complete detected for {prompt_id}, sending execution_complete callback")
                            if progress_callback:
                                progress_callback({"type": "execution_complete", "prompt_id": prompt_id})
                            # Clear earlier preview images - only keep post-completion ones
                            preview_images.clear()
                            preview_counter = 0
                    
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
                        
                        captured_images.append({
                            "filename": filename,
                            "subfolder": "",
                            "type": "output",
                            "image_bytes": image_data,  # Raw bytes for direct save
                            "format": ext,
                            "source": "websocket",
                            "kind": "image",
                        })
                        
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

        # If we captured images via WebSocket, use those (no HTTP download needed)
        if captured_images:
            print(f"Using {len(captured_images)} images captured from WebSocket stream")
            _close_ws()
            return captured_images

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
            for node_output in outputs.values():
                if not isinstance(node_output, dict):
                    continue
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

                videos = node_output.get("videos") or []
                if isinstance(videos, list):
                    for video in videos:
                        if not isinstance(video, dict):
                            continue
                        filename = video.get("filename")
                        if not filename:
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
                        output_items.append(vid)

            return output_items

        # Prefer history outputs whenever possible so we preserve the true ComfyUI
        # filenames (including `type=temp` previews stored under ComfyUI/temp).
        # History can lag slightly behind the websocket completion signal, so retry briefly.
        for _attempt in range(5):
            output_items = _history_output_images()
            if output_items:
                _close_ws()
                return output_items
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
            return result

        _close_ws()
        return []
