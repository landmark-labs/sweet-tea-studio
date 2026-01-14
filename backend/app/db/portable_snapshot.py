from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Optional

from sqlalchemy import event
from sqlmodel import Session as SQLModelSession

from app.core.config import settings
from app.db.engine import engine, ingestion_engine
from app.db.sqlite_health import create_portable_snapshot


class PortableSnapshotManager:
    def __init__(self, source_db: Path, dest_db: Path, *, debounce_s: float) -> None:
        self._source_db = source_db
        self._dest_db = dest_db
        self._debounce_s = max(1.0, float(debounce_s))

        self._lock = threading.Lock()
        self._event = threading.Event()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="sts-portable-db", daemon=True)

        self._pending = False
        self._in_progress = False
        self._last_snapshot_at: Optional[float] = None
        self._next_due: Optional[float] = None
        self._signal_seq = 0

        self._thread.start()

    def notify_write(self) -> None:
        if not settings.PORTABLE_DB_ENABLED:
            return
        self._request_snapshot(immediate=False)

    def flush(self, timeout_s: float = 10.0) -> bool:
        if not settings.PORTABLE_DB_ENABLED:
            return False
        with self._lock:
            if not self._pending and self._dest_db.exists():
                return True
        self._request_snapshot(immediate=True)
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            with self._lock:
                if not self._pending and not self._in_progress:
                    return True
            time.sleep(0.1)
        return False

    def stop(self, timeout_s: float = 10.0) -> None:
        self.flush(timeout_s=timeout_s)
        self._stop.set()
        self._event.set()
        self._thread.join(timeout=timeout_s)

    def request_snapshot_now(self) -> None:
        self._request_snapshot(immediate=True)

    def _request_snapshot(self, *, immediate: bool) -> None:
        now = time.monotonic()
        with self._lock:
            self._pending = True
            self._signal_seq += 1
            if immediate:
                self._next_due = now
            else:
                due = self._compute_due(now)
                if self._next_due is None or due < self._next_due:
                    self._next_due = due
        self._event.set()

    def _compute_due(self, now: float) -> float:
        if self._last_snapshot_at is None:
            return now + self._debounce_s
        if (now - self._last_snapshot_at) >= self._debounce_s:
            return now + self._debounce_s
        return self._last_snapshot_at + self._debounce_s

    def _run(self) -> None:
        while not self._stop.is_set():
            self._event.wait()
            if self._stop.is_set():
                break
            while True:
                with self._lock:
                    if not self._pending or self._next_due is None:
                        self._event.clear()
                        break
                    due = self._next_due

                wait_s = max(0.0, due - time.monotonic())
                if wait_s > 0:
                    self._event.clear()
                    self._event.wait(wait_s)
                    if self._stop.is_set():
                        return
                    continue

                with self._lock:
                    start_seq = self._signal_seq
                    self._in_progress = True

                try:
                    create_portable_snapshot(self._source_db, self._dest_db)
                except Exception as exc:
                    print(f"[DB] Portable snapshot failed: {exc}")
                finally:
                    with self._lock:
                        self._in_progress = False
                        self._last_snapshot_at = time.monotonic()
                        if self._signal_seq == start_seq:
                            self._pending = False
                            self._next_due = None
                            self._event.clear()
                            break
                        # New writes landed during snapshot; schedule the next run.
                        now = time.monotonic()
                        next_due = self._compute_due(now)
                        if self._next_due is None or next_due < self._next_due:
                            self._next_due = next_due


_manager: Optional[PortableSnapshotManager] = None
_listeners_installed = False


def _session_targets_profile_db(session: SQLModelSession) -> bool:
    try:
        bind = session.get_bind()
    except Exception:
        return False
    if hasattr(bind, "engine"):
        bind = bind.engine
    return bind in {engine, ingestion_engine}


def _after_commit(session: SQLModelSession) -> None:
    if _manager is None:
        return
    if _session_targets_profile_db(session):
        _manager.notify_write()


def start_portable_snapshot_service() -> None:
    global _manager, _listeners_installed
    if not settings.PORTABLE_DB_ENABLED:
        return
    if _manager is None:
        _manager = PortableSnapshotManager(
            settings.database_path,
            settings.portable_db_path,
            debounce_s=settings.PORTABLE_DB_DEBOUNCE_SECONDS,
        )
        if settings.database_path.exists() and not settings.portable_db_path.exists():
            _manager.request_snapshot_now()
    if not _listeners_installed:
        event.listen(SQLModelSession, "after_commit", _after_commit)
        _listeners_installed = True


def stop_portable_snapshot_service() -> None:
    global _manager
    if _manager is None:
        return
    _manager.stop(timeout_s=10.0)
    _manager = None
