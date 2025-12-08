from datetime import datetime, timedelta
from typing import Any, Dict, List, Literal, Optional

import httpx
from datetime import datetime
from difflib import SequenceMatcher
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, col, select

from app.models.prompt import Prompt, PromptCreate, PromptRead
from app.models.tag import Tag, TagCreate, TagSyncState
from app.db.engine import engine as db_engine
from app.models.image import Image
from app.models.job import Job
import json
from threading import Thread

router = APIRouter()


class Suggestion(BaseModel):
    value: str
    type: Literal["tag", "prompt"]
    frequency: int = 0
    source: Optional[str] = None
    snippet: Optional[str] = None


class PromptWithImages(PromptRead):
    related_images: List[str] = Field(default_factory=list)


class TagSuggestion(BaseModel):
    name: str
    source: str = "library"
    frequency: int = 0
    description: Optional[str] = None


TAG_CACHE_MAX_AGE = timedelta(hours=24)
TAG_CACHE_MAX_TAGS = 5000
TAG_CACHE_PAGE_SIZE = 200
class PromptStage(BaseModel):
    stage: int
    positive_text: Optional[str] = None
    negative_text: Optional[str] = None
    source: Optional[str] = None
    timestamp: Optional[str] = None


class LibraryPrompt(BaseModel):
    image_id: int
    job_id: Optional[int] = None
    workflow_template_id: Optional[int] = None
    created_at: datetime
    preview_path: str
    active_positive: Optional[str] = None
    active_negative: Optional[str] = None
    job_params: Dict[str, Any] = Field(default_factory=dict)
    prompt_history: List[PromptStage] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    caption: Optional[str] = None
    prompt_id: Optional[int] = None
    prompt_name: Optional[str] = None


def _build_search_block(
    active_positive: Optional[str],
    active_negative: Optional[str],
    caption: Optional[str],
    tags: List[str],
    prompt_history: List[PromptStage],
) -> str:
    return " ".join(
        filter(
            None,
            [
                active_positive or "",
                active_negative or "",
                caption or "",
                " ".join(tags),
                " ".join(
                    (
                        (stage.positive_text or "") + " " + (stage.negative_text or "")
                        for stage in prompt_history
                    )
                ),
            ],
        )
    ).lower()


def _score_search_match(search: str, text_block: str) -> float:
    """Return a fuzzy score between the search term and the text block.

    The score blends token coverage and SequenceMatcher similarity so that
    partial matches (e.g. "surf dog" vs "dog on a surfboard") are surfaced even
    when they are not exact substrings.
    """

    search_lower = (search or "").strip().lower()
    if not search_lower:
        return 0.0

    text_lower = text_block.lower()
    tokens = [t for t in search_lower.replace(",", " ").split() if t]
    token_hits = sum(1 for t in tokens if t in text_lower)
    coverage = token_hits / len(tokens) if tokens else 0
    similarity = SequenceMatcher(None, search_lower, text_lower).ratio()

    # Reward direct substring matches while keeping fuzzy similarity relevant.
    substring_bonus = 0.25 if search_lower in text_lower else 0
    return (0.6 * coverage) + (0.4 * similarity) + substring_bonus


def upsert_tags(session: Session, tags: List[str], source: str = "custom") -> None:
    if not tags:
        return

    normalized = [t.strip() for t in tags if t and t.strip()]
    if not normalized:
        return

    existing = session.exec(select(Tag).where(col(Tag.name).in_(normalized))).all()
    existing_map = {t.name: t for t in existing}

    for name in normalized:
        if name in existing_map:
            existing_map[name].frequency += 1
            existing_map[name].updated_at = datetime.utcnow()
        else:
            session.add(Tag(name=name, source=source, frequency=1))

    session.commit()


@router.get("/", response_model=List[LibraryPrompt])
def read_prompts(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    workflow_id: Optional[int] = None
):
    with Session(db_engine) as session:
        query = (
            select(Image, Job, Prompt)
            .join(Job, Image.job_id == Job.id, isouter=True)
            .join(Prompt, Job.prompt_id == Prompt.id, isouter=True)
            .order_by(Image.created_at.desc())
        )

        if workflow_id:
            query = query.where(Job.workflow_template_id == workflow_id)

        rows = session.exec(query.offset(skip).limit(limit * 5)).all()

        scored_results: List[tuple[float, LibraryPrompt]] = []
        for image, job, prompt in rows:
            raw_params = job.input_params if job and job.input_params else {}
            if isinstance(raw_params, str):
                try:
                    raw_params = json.loads(raw_params)
                except Exception:
                    raw_params = {}

            metadata = image.metadata if isinstance(image.metadata, dict) else {}
            if isinstance(image.metadata, str):
                try:
                    metadata = json.loads(image.metadata)
                except Exception:
                    metadata = {}

            raw_history = metadata.get("prompt_history", []) if isinstance(metadata, dict) else []
            prompt_history: List[PromptStage] = []
            for entry in raw_history:
                if isinstance(entry, dict):
                    prompt_history.append(PromptStage(**{**entry, "stage": entry.get("stage", len(prompt_history))}))

            active_prompt = metadata.get("active_prompt") if isinstance(metadata, dict) else None
            active_positive = None
            active_negative = None
            if isinstance(active_prompt, dict):
                active_positive = active_prompt.get("positive_text")
                active_negative = active_prompt.get("negative_text")

            # Fallbacks for older records
            if not active_positive:
                active_positive = (prompt_history[0].positive_text if prompt_history else None) or raw_params.get("prompt")
            if not active_negative:
                active_negative = (prompt_history[0].negative_text if prompt_history else None) or raw_params.get("negative_prompt")

            tags = []
            if prompt and prompt.tags:
                if isinstance(prompt.tags, str):
                    try:
                        tags = json.loads(prompt.tags)
                    except Exception:
                        tags = []
                else:
                    tags = prompt.tags or []

            caption = image.caption
            preview_path = image.thumbnail_path or image.path

            text_block = _build_search_block(
                active_positive=active_positive,
                active_negative=active_negative,
                caption=caption,
                tags=tags,
                prompt_history=prompt_history,
            )

            if search:
                score = _score_search_match(search, text_block)
                if score < 0.35:
                    continue
            else:
                score = 1.0

            scored_results.append(
                (
                    score,
                    LibraryPrompt(
                        image_id=image.id,
                        job_id=job.id if job else None,
                        workflow_template_id=job.workflow_template_id if job else None,
                        created_at=image.created_at,
                        preview_path=preview_path,
                        active_positive=active_positive,
                        active_negative=active_negative,
                        job_params=raw_params,
                        prompt_history=prompt_history,
                        tags=tags,
                        caption=caption,
                        prompt_id=prompt.id if prompt else None,
                        prompt_name=prompt.name if prompt else None,
                    ),
                )
            )

        scored_results.sort(key=lambda r: (r[0], r[1].created_at), reverse=True)
        return [result for _, result in scored_results[:limit]]


@router.post("/", response_model=PromptRead)
def create_prompt(prompt: PromptCreate):
    with Session(db_engine) as session:
        inferred_tags = prompt.tags or []
        if not inferred_tags and prompt.positive_text:
            inferred_tags = [t.strip() for t in prompt.positive_text.split(",") if t.strip()]

        new_prompt = Prompt.from_orm(prompt)
        new_prompt.tags = inferred_tags
        session.add(new_prompt)
        session.commit()
        session.refresh(new_prompt)
        upsert_tags(session, inferred_tags, source="prompt")
        return new_prompt

@router.get("/{prompt_id}", response_model=PromptRead)
def read_prompt(prompt_id: int):
    with Session(db_engine) as session:
        prompt = session.get(Prompt, prompt_id)
        if not prompt:
            raise HTTPException(status_code=404, detail="Prompt not found")
        
        if isinstance(prompt.tags, str):
            try:
                prompt.tags = json.loads(prompt.tags)
            except:
                prompt.tags = []
                
        return prompt

@router.delete("/{prompt_id}")
def delete_prompt(prompt_id: int):
    with Session(db_engine) as session:
        prompt = session.get(Prompt, prompt_id)
        if not prompt:
            raise HTTPException(status_code=404, detail="Prompt not found")
        session.delete(prompt)
        session.commit()
        return {"status": "deleted"}


@router.get("/suggest", response_model=List[Suggestion])
def suggest(query: str, limit: int = 15):
    with Session(db_engine) as session:
        q = f"%{query.lower()}%"

        tag_stmt = (
            select(Tag)
            .where(col(Tag.name).ilike(q))
            .order_by(Tag.frequency.desc())
            .limit(limit)
        )
        prompt_stmt = (
            select(Prompt)
            .where(
                (col(Prompt.name).ilike(q))
                | (col(Prompt.positive_text).ilike(q))
                | (col(Prompt.negative_text).ilike(q))
            )
            .order_by(Prompt.updated_at.desc())
            .limit(limit)
        )

        tags = session.exec(tag_stmt).all()
        prompts = session.exec(prompt_stmt).all()

        suggestions: List[Suggestion] = []
        for t in tags:
            suggestions.append(
                Suggestion(value=t.name, type="tag", frequency=t.frequency, source=t.source)
            )

        for p in prompts:
            # Handle tags defensive
            ptags = p.tags or []
            if isinstance(ptags, str):
                 try: ptags = json.loads(ptags)
                 except: ptags = []

            snippet_parts = [p.positive_text or "", p.description or ""]
            snippet = " ".join([s for s in snippet_parts if s]).strip()
            suggestions.append(
                Suggestion(
                    value=p.name,
                    type="prompt",
                    frequency=len(ptags),
                    source="library",
                    snippet=snippet[:180] if snippet else None,
                )
            )

        suggestions.sort(key=lambda s: (0 if s.type == "tag" else 1, -s.frequency, s.value))
        return suggestions[:limit]


def bulk_upsert_tag_suggestions(session: Session, tags: List[TagSuggestion], source: str) -> int:
    if not tags:
        return 0

    names = [t.name for t in tags if t.name]
    if not names:
        return 0

    existing: List[Tag] = []
    chunk_size = 900  # stay well under SQLite's default 999 variable limit
    for start in range(0, len(names), chunk_size):
        chunk_names = names[start : start + chunk_size]
        existing.extend(session.exec(select(Tag).where(col(Tag.name).in_(chunk_names))).all())

    existing_map = {t.name: t for t in existing}

    updated = 0
    created = 0
    for tag in tags:
        if tag.name in existing_map:
            current = existing_map[tag.name]
            current.frequency = max(current.frequency or 0, tag.frequency)
            current.description = current.description or tag.description
            current.updated_at = datetime.utcnow()
            current.source = current.source or source
            updated += 1
            continue

        session.add(
            Tag(
                name=tag.name,
                source=source,
                frequency=tag.frequency,
                description=tag.description,
            )
        )
        created += 1

    session.commit()
    return created + updated


def fetch_danbooru_tags(query: str, limit: int = 10) -> List[TagSuggestion]:
    try:
        with httpx.Client(timeout=5.0, headers={"User-Agent": "sweet-tea-studio/0.1"}) as client:
            res = client.get(
                "https://danbooru.donmai.us/tags.json",
                params={
                    "search[name_matches]": f"{query}*",
                    "search[order]": "count",
                    "limit": limit,
                },
            )
            res.raise_for_status()
            data = res.json()
            return [
                TagSuggestion(
                    name=tag.get("name", ""),
                    source="danbooru",
                    frequency=int(tag.get("post_count", 0) or 0),
                    description=tag.get("category_name"),
                )
                for tag in data
                if tag.get("name")
            ]
    except Exception:
        return []


def fetch_all_danbooru_tags(max_tags: int = TAG_CACHE_MAX_TAGS, page_size: int = TAG_CACHE_PAGE_SIZE) -> List[TagSuggestion]:
    collected: List[TagSuggestion] = []
    page = 1

    with httpx.Client(timeout=10.0, headers={"User-Agent": "sweet-tea-studio/0.1 (preload)"}) as client:
        while len(collected) < max_tags:
            try:
                res = client.get(
                    "https://danbooru.donmai.us/tags.json",
                    params={
                        "search[order]": "count",
                        "limit": page_size,
                        "page": page,
                    },
                )
                res.raise_for_status()
                data = res.json()
            except Exception:
                break

            if not data:
                break

            collected.extend(
                [
                    TagSuggestion(
                        name=tag.get("name", ""),
                        source="danbooru",
                        frequency=int(tag.get("post_count", 0) or 0),
                        description=tag.get("category_name"),
                    )
                    for tag in data
                    if tag.get("name")
                ]
            )

            if len(data) < page_size:
                break
            page += 1

    return collected[:max_tags]


def fetch_e621_tags(query: str, limit: int = 10) -> List[TagSuggestion]:
    try:
        with httpx.Client(
            timeout=5.0,
            headers={"User-Agent": "sweet-tea-studio/0.1 (autocomplete)"},
        ) as client:
            res = client.get(
                "https://e621.net/tags.json",
                params={
                    "search[name_matches]": f"{query}*",
                    "search[order]": "count",
                    "limit": limit,
                },
            )
            res.raise_for_status()
            data = res.json()
            return [
                TagSuggestion(
                    name=tag.get("name", ""),
                    source="e621",
                    frequency=int(tag.get("post_count", 0) or 0),
                    description=tag.get("category"),
                )
                for tag in data
                if tag.get("name")
            ]
    except Exception:
        return []


def fetch_all_e621_tags(max_tags: int = TAG_CACHE_MAX_TAGS, page_size: int = TAG_CACHE_PAGE_SIZE) -> List[TagSuggestion]:
    collected: List[TagSuggestion] = []
    page = 1

    with httpx.Client(
        timeout=10.0,
        headers={"User-Agent": "sweet-tea-studio/0.1 (preload)"},
    ) as client:
        while len(collected) < max_tags:
            try:
                res = client.get(
                    "https://e621.net/tags.json",
                    params={
                        "search[order]": "count",
                        "limit": page_size,
                        "page": page,
                    },
                )
                res.raise_for_status()
                data = res.json()
            except Exception:
                break

            if not data:
                break

            collected.extend(
                [
                    TagSuggestion(
                        name=tag.get("name", ""),
                        source="e621",
                        frequency=int(tag.get("post_count", 0) or 0),
                        description=tag.get("category"),
                    )
                    for tag in data
                    if tag.get("name")
                ]
            )

            if len(data) < page_size:
                break
            page += 1

    return collected[:max_tags]


def refresh_remote_tag_cache_if_stale():
    sources = {
        "danbooru": fetch_all_danbooru_tags,
        "e621": fetch_all_e621_tags,
    }

    with Session(db_engine) as session:
        for source, fetcher in sources.items():
            state = session.exec(
                select(TagSyncState).where(TagSyncState.source == source)
            ).first()

            is_stale = True
            if state:
                is_stale = datetime.utcnow() - state.last_synced_at > TAG_CACHE_MAX_AGE

            if not is_stale:
                continue

            remote_tags = fetcher()
            bulk_upsert_tag_suggestions(session, remote_tags, source)

            if state:
                state.last_synced_at = datetime.utcnow()
                state.tag_count = len(remote_tags)
            else:
                session.add(
                    TagSyncState(
                        source=source,
                        last_synced_at=datetime.utcnow(),
                        tag_count=len(remote_tags),
                    )
                )

            session.commit()


def start_tag_cache_refresh_background():
    Thread(target=refresh_remote_tag_cache_if_stale, daemon=True).start()


@router.get("/tags/suggest", response_model=List[TagSuggestion])
def suggest_tags(query: str, limit: int = 20):
    query_like = f"%{query.lower()}%"

    merged: Dict[str, TagSuggestion] = {}

    with Session(db_engine) as session:
        tag_stmt = (
            select(Tag)
            .where(col(Tag.name).ilike(query_like))
            .order_by(Tag.frequency.desc())
            .limit(limit * 2)
        )
        tags = session.exec(tag_stmt).all()
        for tag in tags:
            merged[tag.name.lower()] = TagSuggestion(
                name=tag.name,
                source=tag.source or "library",
                frequency=tag.frequency or 0,
                description=tag.description,
            )

    priority = {"library": 0, "prompt": 0, "custom": 0, "danbooru": 1, "e621": 2}
    sorted_tags = sorted(
        merged.values(),
        key=lambda t: (
            priority.get(t.source, 3),
            -t.frequency,
            t.name,
        ),
    )

    return sorted_tags[:limit]


class TagImportRequest(BaseModel):
    tags: List[TagCreate]


@router.post("/tags/import", response_model=Dict[str, Any])
def import_tags(payload: TagImportRequest):
    with Session(db_engine) as session:
        created = 0
        updated = 0
        for tag in payload.tags:
            existing = session.exec(select(Tag).where(Tag.name == tag.name)).first()
            if existing:
                existing.frequency = max(existing.frequency, tag.frequency)
                existing.source = tag.source
                existing.description = tag.description
                updated += 1
            else:
                session.add(Tag.from_orm(tag))
                created += 1

        session.commit()
        return {"created": created, "updated": updated, "total": created + updated}
