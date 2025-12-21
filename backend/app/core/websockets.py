import asyncio
from typing import List, Dict, Optional
from fastapi import WebSocket

class ConnectionManager:
    def __init__(self):
        # Map job_id to list of WebSockets
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    async def connect(self, websocket: WebSocket, job_id: str):
        await websocket.accept()
        if job_id not in self.active_connections:
            self.active_connections[job_id] = []
        self.active_connections[job_id].append(websocket)

    def disconnect(self, websocket: WebSocket, job_id: str):
        if job_id in self.active_connections:
            self.active_connections[job_id].remove(websocket)
            if not self.active_connections[job_id]:
                del self.active_connections[job_id]

    async def broadcast(self, message: dict, job_id: str):
        if job_id in self.active_connections:
            # Iterate over a copy to avoid modification during iteration if disconnect happens
            for connection in self.active_connections[job_id][:]:
                try:
                    await connection.send_json(message)
                except Exception:
                    # Connection might be closed, we can clean it up later or rely on disconnect
                    self.disconnect(connection, job_id)

    def broadcast_sync(self, message: dict, job_id: str):
        """Thread-safe broadcast for background tasks running in threads."""
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(self.broadcast(message, job_id), self.loop)
        else:
            # Fallback or error if loop isn't captured
            print(f"Warning: ConnectionManager loop not set. Cannot broadcast to {job_id}")

manager = ConnectionManager()
