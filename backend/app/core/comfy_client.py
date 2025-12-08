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

    def _get_url(self, path: str) -> str:
        base = self.engine.base_url.rstrip("/")
        if not base.startswith("http"):
             # Handle cases where user might have entered ws:// for base_url or just ip
             pass 
        return f"{base}{path}"

    def connect(self):
        """Connect to the ComfyUI WebSocket with retry logic."""
        ws_url = self._get_url(f"/ws?clientId={self.client_id}").replace("http", "ws")
        
        max_retries = 3
        for attempt in range(max_retries):
            try:
                self.ws = websocket.WebSocket()
                self.ws.connect(ws_url, timeout=5)
                return
            except (ConnectionRefusedError, socket.timeout, Exception) as e:
                if attempt == max_retries - 1:
                    raise ComfyConnectionError(f"Failed to connect to ComfyUI at {self.engine.base_url} after {max_retries} attempts. Is it running?") from e
                time.sleep(1)

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
            with urllib.request.urlopen(req) as response:
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
            urllib.request.urlopen(req)
        except urllib.error.URLError:
             # If we can't connect to interrupt, it's probably already dead or down.
             # We log it but don't crash, as this is often called during cleanup
             print(f"Warning: Could not connect to interrupt ComfyUI at {self.engine.base_url}")
        except Exception as e:
            print(f"Failed to interrupt: {e}")

    def get_object_info(self) -> Dict[str, Any]:
        """Retrieve node definitions from ComfyUI."""
        try:
            with urllib.request.urlopen(self._get_url("/object_info")) as response:
                return json.loads(response.read())
        except urllib.error.URLError as e:
            raise ComfyConnectionError(f"Could not retrieve node definitions from {self.engine.base_url}. Is it running?") from e

    def get_history(self, prompt_id: str) -> Dict[str, Any]:
        """Retrieve history for a specific prompt ID."""
        try:
            with urllib.request.urlopen(self._get_url(f"/history/{prompt_id}")) as response:
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
        try:
            while True:
                out = self.ws.recv()
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
