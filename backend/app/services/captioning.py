"""Caption persistence helpers.

This module handles:
- caption version history in DB (active/inactive rows)
- caption updates on media files (embedded metadata for images, sidecar for videos)
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from PIL import Image as PILImage
from PIL import PngImagePlugin
from sqlmodel import Session, or_, select

from app.models.caption import CaptionVersion
from app.models.image import Image
from app.services.gallery.constants import VIDEO_EXTENSIONS


_PNG_CAPTION_KEY = "sweet_tea_caption"
_EXIF_USER_COMMENT_TAG = 0x9286


def normalize_caption(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    normalized = value.strip()
    return normalized if normalized else None


def _coerce_json_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


def _caption_sidecar_path(media_path: str) -> str:
    return os.path.splitext(media_path)[0] + ".json"


def _read_sidecar(sidecar_path: str) -> Dict[str, Any]:
    if not os.path.exists(sidecar_path):
        return {}
    try:
        with open(sidecar_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
            if isinstance(payload, dict):
                return payload
    except Exception:
        return {}
    return {}


def _write_sidecar_payload(sidecar_path: str, payload: Dict[str, Any]) -> None:
    parent = os.path.dirname(sidecar_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    tmp_path = f"{sidecar_path}.caption.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, sidecar_path)


def _upsert_sidecar_caption(media_path: str, caption: Optional[str]) -> None:
    sidecar_path = _caption_sidecar_path(media_path)
    payload = _read_sidecar(sidecar_path)

    if caption:
        payload["caption"] = caption
        payload["caption_updated_at"] = datetime.utcnow().isoformat()
    else:
        payload.pop("caption", None)
        payload.pop("caption_updated_at", None)

    if payload:
        _write_sidecar_payload(sidecar_path, payload)


def _write_png_caption(media_path: str, caption: Optional[str]) -> bool:
    try:
        with PILImage.open(media_path) as img:
            pnginfo = PngImagePlugin.PngInfo()
            info = img.info or {}

            # Preserve existing text chunks.
            for key, raw_value in info.items():
                if key == _PNG_CAPTION_KEY:
                    continue
                if isinstance(raw_value, bytes):
                    try:
                        raw_value = raw_value.decode("utf-8", errors="ignore")
                    except Exception:
                        continue
                if isinstance(raw_value, str):
                    try:
                        pnginfo.add_text(key, raw_value)
                    except Exception:
                        continue

            if caption:
                pnginfo.add_text(_PNG_CAPTION_KEY, caption)

            tmp_path = f"{media_path}.caption.tmp"
            img.save(tmp_path, format="PNG", pnginfo=pnginfo)
            os.replace(tmp_path, media_path)
            return True
    except Exception:
        return False
    return False


def _write_jpeg_caption(media_path: str, caption: Optional[str]) -> bool:
    try:
        with PILImage.open(media_path) as img:
            exif = img.getexif()
            if caption:
                exif[_EXIF_USER_COMMENT_TAG] = caption
            elif _EXIF_USER_COMMENT_TAG in exif:
                del exif[_EXIF_USER_COMMENT_TAG]

            tmp_path = f"{media_path}.caption.tmp"
            target = (img.format or "JPEG").upper()
            save_kwargs: Dict[str, Any] = {"exif": exif.tobytes()}
            if target in {"JPG", "JPEG"}:
                if img.mode not in ("RGB", "L"):
                    img = img.convert("RGB")
                save_kwargs["quality"] = 95
                target = "JPEG"
            img.save(tmp_path, format=target, **save_kwargs)
            os.replace(tmp_path, media_path)
            return True
    except Exception:
        return False
    return False


def persist_caption_to_media(media_path: str, caption: Optional[str]) -> str:
    """
    Persist caption onto the media file.

    Returns one of:
    - "embedded" when written to image metadata
    - "sidecar" when written to JSON sidecar
    - "none" when no write was possible (missing path)
    """
    if not media_path:
        return "none"

    ext = os.path.splitext(media_path)[1].lower()
    if ext in VIDEO_EXTENSIONS:
        _upsert_sidecar_caption(media_path, caption)
        return "sidecar"

    if ext == ".png" and _write_png_caption(media_path, caption):
        return "embedded"

    if ext in {".jpg", ".jpeg"} and _write_jpeg_caption(media_path, caption):
        return "embedded"

    # Fallback for unsupported image formats or failed embed writes.
    _upsert_sidecar_caption(media_path, caption)
    return "sidecar"


def apply_caption_update(
    session: Session,
    *,
    media_path: str,
    caption: Optional[str],
    image: Optional[Image] = None,
    source: str = "manual",
    meta: Optional[Dict[str, Any]] = None,
) -> Optional[CaptionVersion]:
    """
    Update active caption + keep historical inactive versions.
    Caller is responsible for committing.
    """
    normalized = normalize_caption(caption)
    now = datetime.utcnow()

    active_stmt = select(CaptionVersion).where(CaptionVersion.is_active == True)  # noqa: E712
    if image and image.id:
        active_stmt = active_stmt.where(
            or_(CaptionVersion.image_id == image.id, CaptionVersion.media_path == media_path)
        )
    else:
        active_stmt = active_stmt.where(CaptionVersion.media_path == media_path)

    active_versions = session.exec(active_stmt).all()
    for version in active_versions:
        version.is_active = False
        version.deactivated_at = now
        session.add(version)

    created: Optional[CaptionVersion] = None
    if normalized:
        created = CaptionVersion(
            image_id=image.id if image else None,
            media_path=media_path,
            caption=normalized,
            source=source or "manual",
            is_active=True,
            meta=meta or None,
            created_at=now,
        )
        session.add(created)

    if image:
        image.caption = normalized
        extra = _coerce_json_dict(image.extra_metadata)
        if normalized:
            extra["caption"] = normalized
            extra["caption_source"] = source or "manual"
            extra["caption_updated_at"] = now.isoformat()
        else:
            extra.pop("caption", None)
            extra.pop("caption_source", None)
            extra.pop("caption_updated_at", None)
        image.extra_metadata = extra
        session.add(image)

    return created


def list_caption_versions(
    session: Session,
    *,
    image_id: Optional[int],
    media_path: str,
    limit: int = 50,
) -> List[CaptionVersion]:
    stmt = select(CaptionVersion)
    if image_id:
        stmt = stmt.where(
            or_(CaptionVersion.image_id == image_id, CaptionVersion.media_path == media_path)
        )
    else:
        stmt = stmt.where(CaptionVersion.media_path == media_path)
    stmt = stmt.order_by(CaptionVersion.created_at.desc()).limit(max(1, min(limit, 200)))
    return session.exec(stmt).all()
