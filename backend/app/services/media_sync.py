from __future__ import annotations

import os
import threading
import time
from typing import Optional

from sqlmodel import Session

_RESYNC_LOCK = threading.Lock()
_LAST_RESYNC_TS = 0.0


def maybe_resync_media_index(
    session: Session,
    *,
    min_interval_seconds: Optional[int] = None,
) -> bool:
    """
    Best-effort, throttled resync to keep DB in sync with filesystem.
    Returns True if a resync was attempted in this call.
    """
    if min_interval_seconds is None:
        raw = os.getenv("SWEET_TEA_MEDIA_RESYNC_INTERVAL_SECONDS", "60").strip()
        try:
            min_interval_seconds = int(raw)
        except ValueError:
            min_interval_seconds = 60

    now = time.time()
    with _RESYNC_LOCK:
        global _LAST_RESYNC_TS
        if now - _LAST_RESYNC_TS < max(0, min_interval_seconds):
            return False
        _LAST_RESYNC_TS = now

    # Run resync in background thread so caller returns immediately.
    # This prevents the heavy disk scan from blocking API responses.
    def _background_resync() -> None:
        try:
            from app.api.endpoints.gallery import resync_images_from_disk
            from app.db.engine import engine as db_engine
            from sqlmodel import Session as DbSession

            with DbSession(db_engine) as bg_session:
                resync_images_from_disk(bg_session)
        except Exception:
            pass

    import threading

    threading.Thread(target=_background_resync, daemon=True).start()
    return True
