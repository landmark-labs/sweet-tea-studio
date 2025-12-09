"""Thin HTTP wrapper for interacting with the ComfyUI Manager endpoints."""

import urllib.request
import urllib.error
import json
from typing import List, Dict, Any, Optional
from app.models.engine import Engine
from app.core.comfy_client import ComfyConnectionError

class ComfyManagerClient:
    """Client for ComfyUI's Manager API used for extension management."""

    def __init__(self, engine: Engine):
        # Persist the engine configuration so every request uses the correct base URL.
        self.engine = engine

    def _get_url(self, path: str) -> str:
        base = self.engine.base_url.rstrip("/")
        if not base.startswith("http"):
            # Manager endpoints expect an HTTP(S) base; if the engine is missing a
            # scheme (e.g., "localhost:8188"), trust the caller to provide a valid
            # address and simply append the path to avoid mangling it here.
            pass
        return f"{base}{path}"

    def _request(self, path: str, method: str = "GET", data: Optional[Dict] = None) -> Any:
        """Execute a Manager request, handling JSON payloads and common failures."""
        url = self._get_url(path)
        try:
            body = json.dumps(data).encode('utf-8') if data else None
            req = urllib.request.Request(url, data=body, method=method, headers={'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req) as response:
                content = response.read()
                if not content:
                    return {}
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    return content.decode('utf-8')
        except urllib.error.HTTPError as e:
            # ComfyUI Manager often returns 400/403 for actionable errors
            raise Exception(f"Manager Error {e.code}: {e.read().decode('utf-8')}") from e
        except urllib.error.URLError as e:
            # Surface network-level failures distinctly so callers can prompt the
            # user to start ComfyUI or adjust the connection details.
            raise ComfyConnectionError(f"Could not connect to ComfyUI at {self.engine.base_url}") from e


    def get_mappings(self, mode: Optional[str] = None) -> List[Any]:
        """Fetch node class -> repo mappings."""
        # Endpoint: /customnode/getmappings?mode=... (optional)
        path = "/customnode/getmappings"
        if mode:
            path += f"?mode={mode}"
        return self._request(path)

    def get_list(self, mode: Optional[str] = None) -> Dict[str, Any]:
        """Fetch full node pack details."""
        # Endpoint: /customnode/getlist?mode=... (optional)
        path = "/customnode/getlist"
        if mode:
            path += f"?mode={mode}"
        return self._request(path)

    def install_node(self, node_pack: Dict[str, Any]) -> Any:
        """
        Trigger installation of a node pack.
        Expected payload matches what Manager UI sends.
        """
        # Endpoint: /manager/queue/install
        return self._request("/manager/queue/install", method="POST", data=node_pack)

    def reboot(self) -> Any:
        """Reboot ComfyUI."""
        # Endpoint: /manager/reboot
        return self._request("/manager/reboot")
