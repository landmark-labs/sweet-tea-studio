"""Path resolution and filtering helpers for gallery endpoints."""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Optional

from sqlmodel import Session, select

from app.core.config import settings
from app.models.engine import Engine
from app.services.media_paths import normalize_fs_path
from app.services.gallery.config import _get_media_path_cache_max, _get_media_path_cache_ttl_s
from app.services.gallery.constants import VIDEO_EXTENSIONS

logger = logging.getLogger(__name__)

_resolve_path_cache: "OrderedDict[str, tuple[float, Optional[str]]]" = OrderedDict()
_resolve_path_cache_lock = threading.Lock()


def _normalize_fs_path(path: str) -> str:
    # Keep a local wrapper so call sites can stay unchanged while we reuse the shared helper.
    return normalize_fs_path(path)


def _is_skipped_media_path(path: Path) -> bool:
    """
    Filter out non-gallery media like masks, thumbnails, and cache/trash artifacts.

    Keep this conservative: better to skip obvious non-gallery assets than to import noise.
    """
    parts_lower = {p.lower() for p in path.parts}
    skip_dirs = {
        ".trash",
        ".cache",
        ".thumbnails",
        "thumbnails",
        "__pycache__",
        "masks",
        "mask",
    }
    if parts_lower & skip_dirs:
        return True

    name_lower = path.name.lower()
    stem_lower = path.stem.lower()
    if any(token in stem_lower for token in ("_thumb", "_thumbnail", "-thumb", "-thumbnail")):
        return True
    if any(token in name_lower for token in ("thumb", "thumbnail")):
        return True

    # Heuristic: mask exports often contain a clear "mask" token even outside /masks.
    if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
        if stem_lower == "mask":
            return True
        if stem_lower.startswith(("mask_", "mask-")):
            return True
        if stem_lower.endswith(("_mask", "-mask")):
            return True

    return False


def _resolve_cache_get(path: str) -> tuple[bool, Optional[str]]:
    ttl_s = _get_media_path_cache_ttl_s()
    if ttl_s <= 0:
        return False, None
    key = _normalize_fs_path(path)
    if not key:
        return False, None
    now = time.time()
    with _resolve_path_cache_lock:
        entry = _resolve_path_cache.get(key)
        if not entry:
            return False, None
        cached_at, cached_value = entry
        if now - cached_at > ttl_s:
            _resolve_path_cache.pop(key, None)
            return False, None
        _resolve_path_cache.move_to_end(key)
        return True, cached_value


def _resolve_cache_set(path: str, resolved: Optional[str]) -> None:
    ttl_s = _get_media_path_cache_ttl_s()
    max_entries = _get_media_path_cache_max()
    if ttl_s <= 0 or max_entries <= 0:
        return
    key = _normalize_fs_path(path)
    if not key:
        return
    with _resolve_path_cache_lock:
        _resolve_path_cache[key] = (time.time(), resolved)
        _resolve_path_cache.move_to_end(key)
        while len(_resolve_path_cache) > max_entries:
            _resolve_path_cache.popitem(last=False)


def _resolve_media_path(path: str, session: Session) -> Optional[str]:
    cache_hit, cached = _resolve_cache_get(path)
    if cache_hit:
        if cached and os.path.exists(cached):
            return cached
        if cached is None:
            return None

    if os.path.exists(path):
        _resolve_cache_set(path, path)
        return path

    normalized = path.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]

    # Try engines in a stable, useful order: active -> Local ComfyUI -> any.
    engines: list[Engine] = []
    seen_ids: set[int] = set()

    active = session.exec(select(Engine).where(Engine.is_active == True)).first()
    if active and active.id is not None:
        engines.append(active)
        seen_ids.add(active.id)

    local = session.exec(select(Engine).where(Engine.name == "Local ComfyUI")).first()
    if local and local.id is not None and local.id not in seen_ids:
        engines.append(local)
        seen_ids.add(local.id)

    for engine in session.exec(select(Engine)).all():
        if engine.id is not None and engine.id in seen_ids:
            continue
        engines.append(engine)
        if engine.id is not None:
            seen_ids.add(engine.id)

    def candidate_paths_for_base(base: str) -> list[str]:
        base_str = str(base).strip().strip('"').strip("'")
        if not base_str:
            return []

        base_path = Path(base_str)
        candidates: list[Path] = []

        segments = [segment for segment in normalized.split("/") if segment and segment != "."]
        suffixes = ["/".join(segments[i:]) for i in range(len(segments))] if segments else [normalized]

        # Direct join: <base>/<path>, progressively dropping leading segments.
        for suffix in suffixes:
            candidates.append(base_path / suffix)

        # If base points to ComfyUI root (or unknown), try common subdirs.
        # If base points to /.../output, try sibling /.../input.
        # If base points to /.../input, try sibling /.../output.
        base_name = base_path.name.lower()
        if base_name in {"input", "output"}:
            siblings_root = base_path.parent
            for suffix in suffixes:
                candidates.append(siblings_root / "input" / suffix)
                candidates.append(siblings_root / "output" / suffix)
        else:
            for suffix in suffixes:
                candidates.append(base_path / "input" / suffix)
                candidates.append(base_path / "output" / suffix)

        # Deduplicate while preserving order
        unique: list[str] = []
        seen: set[str] = set()
        for cand in candidates:
            cand_str = str(cand)
            if cand_str in seen:
                continue
            seen.add(cand_str)
            unique.append(cand_str)
        return unique

    for engine in engines:
        for base in (engine.input_dir, engine.output_dir):
            if not base:
                continue
            for candidate in candidate_paths_for_base(base):
                if os.path.exists(candidate):
                    _resolve_cache_set(path, candidate)
                    return candidate

    # Final fallback: allow environment-configured ComfyUI locations even if engine rows
    # are misconfigured or missing paths.
    for base in (
        getattr(settings, "COMFYUI_INPUT_DIR", None),
        getattr(settings, "COMFYUI_OUTPUT_DIR", None),
        getattr(settings, "COMFYUI_PATH", None),
    ):
        if not base:
            continue
        for candidate in candidate_paths_for_base(str(base)):
            if os.path.exists(candidate):
                _resolve_cache_set(path, candidate)
                return candidate

    _resolve_cache_set(path, None)
    return None


def _log_resolution_failure(path: str, session: Session) -> None:
    normalized = (path or "").replace("\\", "/")
    engines = session.exec(select(Engine)).all()
    engine_payload = []
    for engine in engines[:10]:
        engine_payload.append(
            {
                "id": engine.id,
                "name": engine.name,
                "is_active": engine.is_active,
                "input_dir": engine.input_dir,
                "output_dir": engine.output_dir,
            }
        )
    logger.info(
        "Unable to resolve media path",
        extra={
            "path": path,
            "normalized": normalized,
            "settings_comfyui_input_dir": getattr(settings, "COMFYUI_INPUT_DIR", None),
            "settings_comfyui_output_dir": getattr(settings, "COMFYUI_OUTPUT_DIR", None),
            "settings_comfyui_path": getattr(settings, "COMFYUI_PATH", None),
            "engines_total": len(engines),
            "engines_sample": engine_payload,
        },
    )


def _guess_media_type(path: str) -> str:
    guessed = None
    try:
        import mimetypes
        guessed = mimetypes.guess_type(path)[0]
    except Exception:
        guessed = None
    if guessed:
        return guessed
    ext = os.path.splitext(path)[1].lower()
    if ext in VIDEO_EXTENSIONS:
        if ext == ".webm":
            return "video/webm"
        if ext == ".mov":
            return "video/quicktime"
        if ext == ".mkv":
            return "video/x-matroska"
        if ext == ".avi":
            return "video/x-msvideo"
        if ext in (".mpg", ".mpeg"):
            return "video/mpeg"
        return "video/mp4"
    return "application/octet-stream"
