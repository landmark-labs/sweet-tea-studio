from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List, Optional

from sqlmodel import Session
from sqlalchemy import text

from app.models.image import Image


def build_search_text(
    prompt_text: Optional[str],
    negative_prompt: Optional[str],
    caption: Optional[str],
    tags: Optional[Iterable[str]],
    history: Optional[List[Dict[str, Any]]],
) -> str:
    history_text = " ".join(
        (
            (entry.get("positive_text") or "") + " " + (entry.get("negative_text") or "")
            for entry in (history or [])
            if isinstance(entry, dict)
        )
    )

    tag_text = " ".join(tags) if tags else ""
    return " ".join(
        filter(
            None,
            [prompt_text or "", negative_prompt or "", caption or "", tag_text, history_text],
        )
    ).lower()


def build_search_text_from_image(image: Image) -> str:
    metadata = image.extra_metadata if isinstance(image.extra_metadata, dict) else {}
    if isinstance(image.extra_metadata, str):
        try:
            metadata = json.loads(image.extra_metadata)
        except Exception:
            metadata = {}

    active_prompt = metadata.get("active_prompt") if isinstance(metadata, dict) else None
    if not isinstance(active_prompt, dict):
        active_prompt = {}

    prompt_text = active_prompt.get("positive_text")
    negative_prompt = active_prompt.get("negative_text")
    history = metadata.get("prompt_history") if isinstance(metadata, dict) else []
    return build_search_text(prompt_text, negative_prompt, image.caption, None, history if isinstance(history, list) else [])


def update_gallery_fts(session: Session, image_id: int, search_text: str) -> bool:
    if not search_text:
        return False
    try:
        session.exec(
            text(
                "INSERT OR REPLACE INTO gallery_fts(rowid, image_id, search_text) "
                "VALUES (:rowid, :image_id, :search_text)"
            ),
            {"rowid": image_id, "image_id": image_id, "search_text": search_text},
        )
        return True
    except Exception:
        return False
