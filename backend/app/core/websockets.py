import asyncio
import os
import time
from typing import Dict, List, Optional
from fastapi import WebSocket

class ConnectionManager:
    def __init__(self):
        # Map job_id to list of WebSockets
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self._connection_meta: Dict[WebSocket, Dict[str, float]] = {}
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.max_connections_per_job = int(os.getenv("SWEET_TEA_WS_MAX_PER_JOB", "4"))
        self.max_connection_age_s = int(os.getenv("SWEET_TEA_WS_MAX_AGE_S", "14400"))

    async def connect(self, websocket: WebSocket, job_id: str):
        await websocket.accept()
        now = time.time()
        if job_id not in self.active_connections:
            self.active_connections[job_id] = []
        self.active_connections[job_id].append(websocket)
        self._connection_meta[websocket] = {"connected_at": now, "last_seen_at": now}
        await self._enforce_job_limit(job_id)

    def disconnect(self, websocket: WebSocket, job_id: str):
        if job_id in self.active_connections:
            if websocket in self.active_connections[job_id]:
                self.active_connections[job_id].remove(websocket)
            if not self.active_connections[job_id]:
                del self.active_connections[job_id]
        self._connection_meta.pop(websocket, None)

    def mark_seen(self, websocket: WebSocket):
        meta = self._connection_meta.get(websocket)
        if meta:
            meta["last_seen_at"] = time.time()

    async def broadcast(self, message: dict, job_id: str):
        if job_id in self.active_connections:
            # Iterate over a copy to avoid modification during iteration if disconnect happens
            for connection in self.active_connections[job_id][:]:
                try:
                    await connection.send_json(message)
                    self.mark_seen(connection)
                except Exception:
                    # Connection might be closed, we can clean it up later or rely on disconnect
                    self.disconnect(connection, job_id)
            await self._prune_stale_connections(job_id)

    def broadcast_sync(self, message: dict, job_id: str):
        """Thread-safe broadcast for background tasks running in threads."""
        if self.loop and self.loop.is_running():
            return asyncio.run_coroutine_threadsafe(self.broadcast(message, job_id), self.loop)
        else:
            # Fallback or error if loop isn't captured
            print(f"Warning: ConnectionManager loop not set. Cannot broadcast to {job_id}")
            return None

    async def close_job(self, job_id: str, code: int = 1000):
        connections = self.active_connections.get(job_id, [])
        for connection in connections[:]:
            try:
                await connection.close(code=code)
            except Exception:
                pass
            self.disconnect(connection, job_id)

    def close_job_sync(self, job_id: str, code: int = 1000):
        if self.loop and self.loop.is_running():
            return asyncio.run_coroutine_threadsafe(self.close_job(job_id, code=code), self.loop)
        else:
            print(f"Warning: ConnectionManager loop not set. Cannot close websockets for {job_id}")
            return None

    def get_stats(self) -> dict:
        now = time.time()
        counts = {job_id: len(conns) for job_id, conns in self.active_connections.items()}
        ages = [
            now - meta.get("connected_at", now)
            for meta in self._connection_meta.values()
        ]
        return {
            "active_jobs": len(self.active_connections),
            "active_connections": sum(counts.values()),
            "connections_by_job": counts,
            "max_connections_per_job": self.max_connections_per_job,
            "oldest_connection_age_s": int(max(ages)) if ages else None,
        }

    async def _enforce_job_limit(self, job_id: str):
        connections = self.active_connections.get(job_id, [])
        if len(connections) <= self.max_connections_per_job:
            return
        now = time.time()
        ordered = sorted(
            connections,
            key=lambda ws: self._connection_meta.get(ws, {}).get("connected_at", now),
        )
        excess = len(connections) - self.max_connections_per_job
        for connection in ordered[:excess]:
            try:
                await connection.close(code=1000)
            except Exception:
                pass
            self.disconnect(connection, job_id)

    async def _prune_stale_connections(self, job_id: str):
        if self.max_connection_age_s <= 0:
            return
        now = time.time()
        connections = self.active_connections.get(job_id, [])
        for connection in connections[:]:
            meta = self._connection_meta.get(connection)
            if not meta:
                continue
            last_seen = meta.get("last_seen_at", meta.get("connected_at", now))
            if (now - last_seen) < self.max_connection_age_s:
                continue
            try:
                await connection.close(code=1001)
            except Exception:
                pass
            self.disconnect(connection, job_id)

manager = ConnectionManager()
