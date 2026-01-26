"""Sequence cache helpers for job processing output naming."""

from __future__ import annotations

import os
import re
import threading
import time
from typing import Any

from sqlmodel import Session, select

from app.models.image import Image

_sequence_cache: dict[str, dict[str, float | int]] = {}
_sequence_lock = threading.Lock()
_sequence_pattern_cache: dict[str, dict[str, object]] = {}
_sequence_cache_last_prune = 0.0
_sequence_cache_max = int(os.getenv("SWEET_TEA_SEQ_CACHE_MAX", "512"))
_sequence_pattern_cache_max = int(os.getenv("SWEET_TEA_SEQ_PATTERN_CACHE_MAX", "512"))
_sequence_cache_ttl_s = int(os.getenv("SWEET_TEA_SEQ_CACHE_TTL_S", "3600"))
_sequence_cache_prune_interval_s = int(os.getenv("SWEET_TEA_SEQ_CACHE_PRUNE_INTERVAL_S", "60"))


def _prune_sequence_caches(now: float) -> None:
    """Drop expired entries and cap cache sizes."""
    global _sequence_cache_last_prune
    if now - _sequence_cache_last_prune < _sequence_cache_prune_interval_s:
        return

    _sequence_cache_last_prune = now

    def prune(cache: dict[str, dict[str, object]], max_items: int) -> None:
        expired = [
            key for key, entry in cache.items()
            if now - float(entry.get("last_used", now)) > _sequence_cache_ttl_s
        ]
        for key in expired:
            cache.pop(key, None)

        if len(cache) <= max_items:
            return

        ordered = sorted(
            cache.items(),
            key=lambda item: float(item[1].get("last_used", now)),
        )
        for key, _entry in ordered[: max(0, len(cache) - max_items)]:
            cache.pop(key, None)

    prune(_sequence_cache, _sequence_cache_max)
    prune(_sequence_pattern_cache, _sequence_pattern_cache_max)


def get_sequence_cache_stats() -> dict[str, Any]:
    """Return basic cache stats for monitoring."""
    with _sequence_lock:
        now = time.time()

        def stats(cache: dict[str, dict[str, object]]) -> dict[str, Any]:
            if not cache:
                return {"count": 0, "oldest_age_s": None, "newest_age_s": None}
            ages = [now - float(entry.get("last_used", now)) for entry in cache.values()]
            return {
                "count": len(cache),
                "oldest_age_s": int(max(ages)),
                "newest_age_s": int(min(ages)),
            }

        return {
            "sequence_cache": stats(_sequence_cache),
            "pattern_cache": stats(_sequence_pattern_cache),
        }


def _get_next_sequence_start(session: Session, filename_prefix: str, reserve: int) -> int:
    """
    Quickly determine the next sequence number for a filename prefix.
    Uses the Image table (latest 100 rows) and an in-memory cache to avoid
    slow directory scans when folders contain thousands of files.
    """
    if reserve <= 0:
        return 0

    with _sequence_lock:
        now = time.time()
        _prune_sequence_caches(now)

        cached = _sequence_cache.get(filename_prefix)
        if cached is not None:
            start = int(cached.get("next", 0))
            cached["next"] = start + reserve
            cached["last_used"] = now
            return start

        pattern_entry = _sequence_pattern_cache.get(filename_prefix)
        if pattern_entry is None:
            pattern = re.compile(
                rf"^{re.escape(filename_prefix)}-(\d+)\.(jpg|jpeg|png|webp|gif|mp4|webm|mov|mkv|avi)$",
                re.IGNORECASE
            )
            _sequence_pattern_cache[filename_prefix] = {"pattern": pattern, "last_used": now}
        else:
            pattern_entry["last_used"] = now
            pattern = pattern_entry.get("pattern")
            if not pattern:
                pattern = re.compile(
                    rf"^{re.escape(filename_prefix)}-(\d+)\.(jpg|jpeg|png|webp|gif|mp4|webm|mov|mkv|avi)$",
                    re.IGNORECASE
                )
                _sequence_pattern_cache[filename_prefix] = {"pattern": pattern, "last_used": now}

        max_seq = -1
        stmt = (
            select(Image.filename)
            .where(Image.filename.like(f"{filename_prefix}-%"))
            .order_by(Image.created_at.desc())
            .limit(100)
        )
        for row in session.exec(stmt):
            match = pattern.match(row)
            if match:
                max_seq = max(max_seq, int(match.group(1)))
                if max_seq >= 0:
                    break

        start = (max_seq + 1) if max_seq >= 0 else 0
        _sequence_cache[filename_prefix] = {"next": start + reserve, "last_used": now}
        return start


def _derive_output_filename(
    original_name: str | None,
    seq_num: int,
    ext: str,
    fallback_prefix: str,
    save_dir: str,
) -> str:
    """
    Derive output filename, preserving save node naming pattern if present.

    If original_name has a pattern like 'Prefix_00001.mp4', extract 'Prefix_'
    and generate 'Prefix_{seq_num:05d}.mp4' (matching the zero-padding width).

    Falls back to sweet-tea naming '{fallback_prefix}-{seq_num:04d}.{ext}'.
    """
    if not original_name:
        return f"{fallback_prefix}-{seq_num:04d}.{ext}"

    # Extract base name without extension
    base_name = original_name.rsplit(".", 1)[0] if "." in original_name else original_name

    # Pattern: prefix followed by digits (possibly with underscore/dash separator)
    match = re.match(r"^(.+?)([-_])?(\d+)$", base_name)
    if match:
        prefix = match.group(1)
        separator = match.group(2) or "_"  # Default to underscore if no separator
        digits = match.group(3)
        padding = len(digits)

        # Generate unique filename with this pattern
        candidate = f"{prefix}{separator}{seq_num:0{padding}d}.{ext}"
        if not os.path.exists(os.path.join(save_dir, candidate)):
            return candidate

        # If still exists, find next available sequence number
        for i in range(seq_num, seq_num + 1000):
            candidate = f"{prefix}{separator}{i:0{padding}d}.{ext}"
            if not os.path.exists(os.path.join(save_dir, candidate)):
                return candidate

    # No recognizable pattern - fallback to sweet-tea naming
    return f"{fallback_prefix}-{seq_num:04d}.{ext}"
