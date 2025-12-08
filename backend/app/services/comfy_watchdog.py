import asyncio
import time
from dataclasses import dataclass
from typing import Dict, List, Optional

from sqlmodel import Session, select

from app.core.comfy_client import ComfyClient, ComfyConnectionError
from app.db.engine import engine as db_engine
from app.models.engine import Engine


@dataclass
class EngineWatchState:
    healthy: bool = True
    backoff: int = 5
    last_checked: float = 0
    last_checked_wall: float = 0
    next_check: float = 0
    last_error: Optional[str] = None
    engine_name: Optional[str] = None


class ComfyWatchdog:
    """Background watchdog that tracks ComfyUI reachability per engine."""

    def __init__(self, poll_interval: int = 5, max_backoff: int = 60):
        self.poll_interval = poll_interval
        self.max_backoff = max_backoff
        self.state: Dict[int, EngineWatchState] = {}
        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()

    async def start(self):
        if self._task and not self._task.done():
            return

        self._stop_event.clear()
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        if self._task and not self._task.done():
            self._stop_event.set()
            await self._task

    def ensure_engine_ready(self, engine: Engine):
        """Raise a connection error if the engine is currently marked unhealthy."""
        state = self.state.get(engine.id)
        if not state:
            # Perform a synchronous check to seed state
            state = self._check_engine(engine)

        if not state.healthy:
            retry_in = max(int(state.next_check - time.monotonic()), 0)
            raise ComfyConnectionError(
                state.last_error
                or f"ComfyUI at {engine.base_url} is unreachable. Next retry in {retry_in} seconds."
            )

    def get_status(self) -> List[dict]:
        now = time.monotonic()
        results = []
        for engine_id, state in self.state.items():
            results.append(
                {
                    "engine_id": engine_id,
                    "engine_name": state.engine_name,
                    "healthy": state.healthy,
                    "last_error": state.last_error,
                    "last_checked_at": state.last_checked_wall,
                    "next_check_in": max(int(state.next_check - now), 0),
                }
            )
        return results

    async def _run(self):
        while not self._stop_event.is_set():
            await self._poll_once()
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.poll_interval)
            except asyncio.TimeoutError:
                continue

    async def _poll_once(self):
        now = time.monotonic()
        with Session(db_engine) as session:
            engines = session.exec(select(Engine).where(Engine.is_active == True)).all()

        for engine in engines:
            state = self.state.get(engine.id)
            if state and not state.healthy and now < state.next_check:
                # Respect backoff when down
                continue

            if state and state.healthy and (now - state.last_checked) < self.poll_interval:
                continue

            await asyncio.to_thread(self._check_engine, engine)

    def _check_engine(self, engine: Engine) -> EngineWatchState:
        state = self.state.get(engine.id, EngineWatchState(backoff=self.poll_interval))
        state.engine_name = engine.name
        start = time.monotonic()
        wall = time.time()

        try:
            client = ComfyClient(engine)
            client.get_object_info()
            state.healthy = True
            state.last_error = None
            state.backoff = self.poll_interval
        except Exception as exc:
            state.healthy = False
            state.last_error = str(exc)
            state.backoff = min(max(state.backoff, self.poll_interval) * 2, self.max_backoff)

        state.last_checked = start
        state.last_checked_wall = wall
        state.next_check = state.last_checked + state.backoff
        self.state[engine.id] = state
        return state


watchdog = ComfyWatchdog()
