"""Thumbnail helpers for gallery endpoints."""

from __future__ import annotations

import hashlib
import io
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Optional

from PIL import Image as PILImage, ImageOps

from app.core.config import settings
from app.services.gallery.config import (
    _get_thumb_cache_max_age_days,
    _get_thumb_cache_max_files,
    _get_thumb_cache_max_mb,
    _get_thumb_cache_prune_interval_s,
)
from app.services.gallery.constants import THUMBNAIL_DEFAULT_PX
import logging

logger = logging.getLogger(__name__)

_thumb_cache_prune_lock = threading.Lock()
_thumb_cache_prune_last = 0.0


def _create_inline_thumbnail(
    path: str,
    max_px: int = THUMBNAIL_DEFAULT_PX,
    quality: int = 45,
) -> tuple[Optional[bytes], Optional[int], Optional[int]]:
    """
    Create a compact inline thumbnail for DB storage.

    Returns (thumbnail_bytes, width, height).
    """
    try:
        with PILImage.open(path) as img:
            img = ImageOps.exif_transpose(img)
            width, height = img.size
            img.thumbnail((max_px, max_px))
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality)
            return buf.getvalue(), width, height
    except Exception:
        return None, None, None


def _thumbnail_cache_dir() -> Path:
    cache_dir = settings.meta_dir / "thumbnails"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def _maybe_prune_thumbnail_cache() -> None:
    global _thumb_cache_prune_last
    max_files = _get_thumb_cache_max_files()
    max_mb = _get_thumb_cache_max_mb()
    max_age_days = _get_thumb_cache_max_age_days()
    prune_interval_s = _get_thumb_cache_prune_interval_s()

    if max_files <= 0 and max_mb <= 0 and max_age_days <= 0:
        return

    now = time.time()
    if now - _thumb_cache_prune_last < prune_interval_s:
        return

    with _thumb_cache_prune_lock:
        if now - _thumb_cache_prune_last < prune_interval_s:
            return
        _thumb_cache_prune_last = now

    cache_dir = _thumbnail_cache_dir()
    try:
        entries: list[tuple[float, int, Path]] = []
        total_bytes = 0
        cutoff = None
        if max_age_days > 0:
            cutoff = now - (max_age_days * 86400)

        for entry in cache_dir.iterdir():
            if not entry.is_file():
                continue
            try:
                stat = entry.stat()
            except OSError:
                continue
            total_bytes += stat.st_size
            if cutoff and stat.st_mtime < cutoff:
                try:
                    entry.unlink()
                except OSError:
                    pass
                continue
            entries.append((stat.st_mtime, stat.st_size, entry))

        max_bytes = max_mb * 1024 * 1024 if max_mb > 0 else 0
        max_files_limit = max_files if max_files > 0 else 0

        if (max_files_limit and len(entries) > max_files_limit) or (max_bytes and total_bytes > max_bytes):
            entries.sort(key=lambda item: item[0])  # oldest first
            remaining = len(entries)
            for _mtime, size, path in entries:
                if max_files_limit and remaining <= max_files_limit and (not max_bytes or total_bytes <= max_bytes):
                    break
                try:
                    path.unlink()
                except OSError:
                    continue
                total_bytes = max(0, total_bytes - size)
                remaining -= 1
    except Exception as exc:
        logger.debug("Failed to prune thumbnail cache", extra={"error": str(exc)})


def _purge_thumbnail_cache_for_path(path: str) -> int:
    """
    Remove all cached thumbnails for a given source image path.

    Thumbnails are keyed by SHA1 of "{path}:{mtime}:{size}:{max_px}:{type}".
    Since we don't know all possible max_px variants, we generate cache keys
    for common sizes and delete matching files.

    Returns the number of cache files deleted.
    """
    cache_dir = _thumbnail_cache_dir()
    deleted = 0

    # Try to get file stats for accurate cache key matching
    try:
        stat = os.stat(path)
        mtime_ns = stat.st_mtime_ns
        size = stat.st_size
    except OSError:
        # File already deleted, use fallback key format
        mtime_ns = None
        size = None

    # Common thumbnail sizes used by Gallery (512) and ProjectGallery (256)
    for max_px in [64, 128, 256, 512, 1024]:
        for media_type in ["image", "video"]:
            if mtime_ns is not None and size is not None:
                cache_key = f"{path}:{mtime_ns}:{size}:{max_px}:{media_type}"
            else:
                # Fallback key format when file is already deleted
                cache_key = f"{path}:{max_px}:{media_type}"

            cache_name = hashlib.sha1(cache_key.encode("utf-8")).hexdigest()
            cache_path = cache_dir / f"{cache_name}.jpg"

            try:
                if cache_path.exists():
                    cache_path.unlink()
                    deleted += 1
            except OSError:
                pass

    return deleted


def _build_placeholder_svg(label: str, size_px: int) -> bytes:
    size = max(64, min(size_px, 512))
    safe_label = re.sub(r"[^a-zA-Z0-9 _-]", "", label).strip() or "preview"
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
  <rect width="100%" height="100%" fill="#0f172a"/>
  <rect x="8" y="8" width="{size - 16}" height="{size - 16}" rx="10" ry="10" fill="#1e293b"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#e2e8f0" font-family="Arial, sans-serif" font-size="{max(10, size // 8)}" letter-spacing="2">{safe_label.upper()}</text>
</svg>"""
    return svg.encode("utf-8")


def _create_image_thumbnail_bytes(path: str, max_px: int, quality: int = 60) -> Optional[bytes]:
    try:
        with PILImage.open(path) as img:
            img = ImageOps.exif_transpose(img)
            img.thumbnail((max_px, max_px))
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality, optimize=True)
            return buf.getvalue()
    except Exception as exc:
        logger.debug("Failed to build image thumbnail", extra={"path": path, "error": str(exc)})
        return None


def _create_video_poster_bytes(path: str, max_px: int) -> Optional[bytes]:
    def resolve_ffmpeg() -> Optional[str]:
        configured = getattr(settings, "FFMPEG_PATH", None)
        if configured and isinstance(configured, str) and configured.strip():
            candidate = configured.strip().strip('"')
            if os.path.exists(candidate):
                return candidate

        ffmpeg_from_path = shutil.which("ffmpeg")
        if ffmpeg_from_path:
            return ffmpeg_from_path

        # Common Conda layout on Windows: %CONDA_PREFIX%/Library/bin/ffmpeg.exe
        if os.name == "nt":
            conda_candidate = Path(sys.prefix) / "Library" / "bin" / "ffmpeg.exe"
            if conda_candidate.exists():
                return str(conda_candidate)

        # Common venv layout on *nix: <prefix>/bin/ffmpeg
        unix_candidate = Path(sys.prefix) / "bin" / "ffmpeg"
        if unix_candidate.exists():
            return str(unix_candidate)

        return None

    ffmpeg = resolve_ffmpeg()
    if not ffmpeg:
        return None

    scale_expr = f"scale={max_px}:{max_px}:force_original_aspect_ratio=decrease"

    # Order matters: try fast seek first, then a decoding-based thumbnail filter.
    attempts: list[list[str]] = []
    for ss in ("0.5", "0.0"):
        attempts.append([
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-ss",
            ss,
            "-i",
            path,
            "-frames:v",
            "1",
            "-vf",
            scale_expr,
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "-an",
            "pipe:1",
        ])

    # Fallback: ask ffmpeg to pick a representative frame (can be slower but works for tricky seeks).
    attempts.append([
        ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-i",
        path,
        "-frames:v",
        "1",
        "-vf",
        f"thumbnail,{scale_expr}",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-an",
        "pipe:1",
    ])

    last_error: str | None = None
    last_returncode: int | None = None

    for cmd in attempts:
        ss = None
        if "-ss" in cmd:
            try:
                ss = cmd[cmd.index("-ss") + 1]
            except Exception:
                ss = None
        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=10,
            )
        except subprocess.TimeoutExpired:
            logger.debug("Video poster generation timed out", extra={"path": path, "ss": ss})
            continue

        last_returncode = result.returncode
        stderr_text = result.stderr.decode("utf-8", errors="ignore")
        if stderr_text:
            last_error = stderr_text[:400]

        if result.returncode == 0 and result.stdout:
            return result.stdout

        logger.debug(
            "Video poster generation failed",
            extra={
                "path": path,
                "ss": ss,
                "stderr": stderr_text[:200],
            },
        )

    if last_error or last_returncode is not None:
        logger.info(
            "Video poster generation failed; returning placeholder",
            extra={
                "path": path,
                "returncode": last_returncode,
                "stderr": last_error,
                "ffmpeg": ffmpeg,
            },
        )

    return None
