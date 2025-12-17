"""HTTP + WebSocket client wrapper for interacting with ComfyUI."""

import json
import uuid
import urllib.request
import urllib.parse
import urllib.error
import websocket
import time
import socket
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

        print(f"Listening for completion of {prompt_id}...")
        backoff = self._default_backoff
        reconnect_attempts = 0
        max_reconnect_attempts = 10
        
        # Store images captured from WebSocket binary stream (SaveImageWebsocket node)
        captured_images: List[Dict[str, Any]] = []
        # Track preview images as fallback when no SaveImage node exists
        preview_images: List[Dict[str, Any]] = []
        image_counter = 0
        preview_counter = 0
        execution_complete = False  # Track when node execution finishes

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
                    
                    print(f"[ComfyClient] Received BINARY frame. EventType: {event_type}, Format: {image_format}, DataLen: {len(image_data)}")
                    
                    if event_type == 1:  # PREVIEW_IMAGE
                        print(f"[ComfyClient] Received PREVIEW_IMAGE (Event 1). Length: {len(image_data)} bytes")
                        # Convert to base64 for frontend preview
                        b64_img = base64.b64encode(image_data).decode('utf-8')
                        prefix = "data:image/jpeg;base64," if image_format == 1 else "data:image/png;base64,"
                        
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
                        
                        if progress_callback:
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
                            "source": "websocket"
                        })
                        
                        print(f"Captured image from WebSocket: {filename} ({len(image_data)} bytes)")
                        
                        # Also send preview to frontend
                        b64_img = base64.b64encode(image_data).decode('utf-8')
                        prefix = "data:image/jpeg;base64," if image_format == 1 else "data:image/png;base64,"
                        
                        if progress_callback:
                            progress_callback({
                                "type": "preview",
                                "data": {
                                    "blob": f"{prefix}{b64_img}",
                                    "is_final": True
                                }
                            })
                    
                    continue  # Done processing binary message
                    
        except (websocket.WebSocketException, ConnectionResetError) as e:
            raise ComfyConnectionError(f"WebSocket connection lost during execution.") from e

        # If we captured images via WebSocket, use those (no HTTP download needed)
        if captured_images:
            print(f"Using {len(captured_images)} images captured from WebSocket stream")
            return captured_images
        
        # Fallback: Use the last preview image(s) as output when no SaveImage node exists
        # This handles workflows using only PreviewImage nodes
        if preview_images:
            print(f"No SaveImage node detected. Using {len(preview_images)} preview image(s) as final output")
            # Use the last preview as the final image (it's the completed generation)
            last_preview = preview_images[-1]
            return [{
                "filename": f"gen_{prompt_id[:8]}_{1:03d}.{last_preview['format']}",
                "subfolder": "",
                "type": "output",
                "image_bytes": last_preview["image_bytes"],
                "format": last_preview["format"],
                "source": "preview_fallback"
            }]

        # Fallback: Fetch from history API (traditional SaveImage node)
        history = self.get_history(prompt_id)[prompt_id]
        output_images = []

        for node_id in history['outputs']:
            node_output = history['outputs'][node_id]
            if 'images' in node_output:
                for image in node_output['images']:
                    # Construct full URL or path
                    image['url'] = self._get_url(f"/view?filename={image['filename']}&subfolder={image['subfolder']}&type={image['type']}")
                    output_images.append(image)

        return output_images

