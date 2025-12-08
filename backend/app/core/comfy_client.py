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
    def __init__(self, engine: Engine):
        self.engine = engine
        self.client_id = str(uuid.uuid4())
        self.ws = None
        self._default_backoff = 1
        self._max_backoff = 30

    def _get_url(self, path: str) -> str:
        base = self.engine.base_url.rstrip("/")
        if not base.startswith("http"):
             # Handle cases where user might have entered ws:// for base_url or just ip
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

    def get_images(self, prompt_id: str, progress_callback=None) -> List[Dict[str, Any]]:
        """
        Wait for job completion and retrieve output images.
        Optional progress_callback(data: dict) called on updates.
        """
        if not self.ws:
            self.connect()

        print(f"Listening for completion of {prompt_id}...")
        backoff = self._default_backoff

        try:
            while True:
                try:
                    out = self.ws.recv()
                    backoff = self._default_backoff
                except websocket.WebSocketTimeoutException:
                    if not self._ping():
                        self._reconnect_with_backoff(backoff)
                        backoff = min(backoff * 2, self._max_backoff)
                    continue
                except (websocket.WebSocketException, ConnectionResetError, socket.error):
                    self._reconnect_with_backoff(backoff)
                    backoff = min(backoff * 2, self._max_backoff)
                    continue

                if isinstance(out, str):
                    message = json.loads(out)
                    if progress_callback:
                        progress_callback(message)

                    if message['type'] == 'executing':
                        data = message['data']
                        if data['node'] is None and data['prompt_id'] == prompt_id:
                            break # Execution is done

                elif isinstance(out, bytes):
                    continue
                else:
                    continue
        except (websocket.WebSocketException, ConnectionResetError) as e:
             raise ComfyConnectionError(f"WebSocket connection lost during execution.") from e

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
