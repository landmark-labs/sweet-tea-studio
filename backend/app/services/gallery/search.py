"""Search helpers for gallery endpoints."""

import json
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import text
from sqlmodel import Session

from app.models.image import Image

_fts_cache: Dict[str, Optional[bool]] = {"available": None}


def _fts_available(session: Session) -> bool:
    cached = _fts_cache.get("available")
    if cached is not None:
        return cached
    try:
        result = session.exec(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='gallery_fts' LIMIT 1")
        ).first()
        available = result is not None
    except Exception:
        available = False
    _fts_cache["available"] = available
    return available


def _fts_query(search: str) -> str:
    tokens = [t for t in search.replace('"', " ").replace("'", " ").split() if t]
    if not tokens:
        return ""
    return " ".join(f"{token}*" for token in tokens)

def build_search_text(
    prompt_text: Optional[str],
    negative_prompt: Optional[str],
    caption: Optional[str],
    tags: Optional[Iterable[str]],
    history: Optional[List[Dict[str, Any]]],
) -> str:
    """Compose a normalized search block for FTS indexing."""
    tag_list = [tag for tag in (tags or []) if isinstance(tag, str)]
    history_list = list(history or [])
    return _build_search_block(prompt_text, negative_prompt, caption, tag_list, history_list)


def build_search_text_from_image(image: Image) -> str:
    """Build search text for an image using stored metadata and caption."""
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
    history_list = history if isinstance(history, list) else []
    return build_search_text(prompt_text, negative_prompt, image.caption, None, history_list)


def update_gallery_fts(session: Session, image_id: int, search_text: str) -> bool:
    """Insert/replace the FTS record for an image."""
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


def _build_search_block(
    prompt_text: Optional[str],
    negative_prompt: Optional[str],
    caption: Optional[str],
    tags: List[str],
    history: List[Dict[str, Any]],
) -> str:
    history_text = " ".join(
        (
            (entry.get("positive_text") or "") + " " + (entry.get("negative_text") or "")
            for entry in history
            if isinstance(entry, dict)
        )
    )

    return " ".join(
        filter(
            None,
            [prompt_text or "", negative_prompt or "", caption or "", " ".join(tags), history_text],
        )
    ).lower()


def _score_search_match(search: str, text_block: str) -> float:
    search_lower = (search or "").strip().lower()
    if not search_lower:
        return 0.0

    text_lower = text_block.lower()
    tokens = [t for t in search_lower.replace(",", " ").split() if t]
    token_hits = sum(1 for t in tokens if t in text_lower)
    coverage = token_hits / len(tokens) if tokens else 0
    similarity = SequenceMatcher(None, search_lower, text_lower).ratio()
    substring_bonus = 0.25 if search_lower in text_lower else 0
    return (0.6 * coverage) + (0.4 * similarity) + substring_bonus
