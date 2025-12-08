import json
import uuid
import urllib.request
import urllib.parse
import websocket
from typing import Dict, Any, List
from app.models.engine import Engine

class ComfyClient:
    def __init__(self, engine: Engine):
        self.engine = engine
        self.client_id = str(uuid.uuid4())
        self.ws = None

    def _get_url(self, path: str) -> str:
        base = self.engine.base_url.rstrip("/")
        return f"{base}{path}"

    def connect(self):
        """Connect to the ComfyUI WebSocket."""
        ws_url = self._get_url(f"/ws?clientId={self.client_id}").replace("http", "ws")
        self.ws = websocket.WebSocket()
        self.ws.connect(ws_url)

    def queue_prompt(self, prompt: Dict[str, Any]) -> str:
        """Submit a workflow to ComfyUI."""
        p = {"prompt": prompt, "client_id": self.client_id}
        data = json.dumps(p).encode('utf-8')
        try:
            req = urllib.request.Request(self._get_url("/prompt"), data=data)
            response = json.loads(urllib.request.urlopen(req).read())
            return response['prompt_id']
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            raise Exception(f"ComfyUI Error {e.code}: {error_body}") from e

    def interrupt(self):
        """Interrupt the current execution."""
        try:
            req = urllib.request.Request(self._get_url("/interrupt"), data=b"", method="POST")
            urllib.request.urlopen(req)
        except Exception as e:
            print(f"Failed to interrupt: {e}")

    def get_history(self, prompt_id: str) -> Dict[str, Any]:
        """Retrieve history for a specific prompt ID."""
        with urllib.request.urlopen(self._get_url(f"/history/{prompt_id}")) as response:
            return json.loads(response.read())

    import base64

    def get_images(self, prompt_id: str, progress_callback=None) -> List[Dict[str, Any]]:
        """
        Wait for job completion and retrieve output images.
        Optional progress_callback(data: dict) called on updates.
        """
        if not self.ws:
            self.connect()

        print(f"Listening for completion of {prompt_id}...")
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
                # Binary preview (JPEG)
                # Header format: 4 bytes type, 4 bytes len? 
                # ComfyUI sends raw bytes for previews. The first 8 bytes ~ 
                # Actually, standard WS client might return bytes.
                # For now, let's just forward it if possible, or ignore.
                # If we want to support previews, we need to handle binary messages.
                # Let's assume text messages for progress for now.
                continue
            else:
                continue

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
