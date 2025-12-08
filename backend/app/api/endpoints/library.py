from datetime import datetime, timedelta
from typing import Any, Dict, List, Literal, Optional

import httpx
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


@router.get("/", response_model=List[PromptWithImages])
def read_prompts(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    workflow_id: Optional[int] = None
):
    with Session(db_engine) as session:
        query = select(Prompt)
        if search:
            s = f"%{search.lower()}%"
            # simple case-insensitive like Search
            query = query.where(
                (col(Prompt.name).ilike(s)) |
                (col(Prompt.positive_text).ilike(s)) |
                (col(Prompt.negative_text).ilike(s))
            )

        if workflow_id:
            query = query.where(Prompt.workflow_id == workflow_id)
        
        query = query.order_by(Prompt.updated_at.desc()).offset(skip).limit(limit)
        prompts = session.exec(query).all()

        if search:
            search_lower = search.lower()

            def matches(p: Prompt) -> bool:
                text_block = " ".join([
                    p.name or "",
                    p.description or "",
                    p.positive_text or "",
                    p.negative_text or "",
                ]).lower()

                # Handle tags if they are strings (SQLite)
                ptags = p.tags or []
                if isinstance(ptags, str):
                    try:
                       ptags = json.loads(ptags)
                    except:
                       ptags = []

                tag_match = any(search_lower in (t or "").lower() for t in ptags)
                return search_lower in text_block or tag_match

            prompts = [p for p in prompts if matches(p)]

        results: List[PromptWithImages] = []
        for p in prompts:
            # Handle tags defensive loading
            if isinstance(p.tags, str):
                try:
                    p.tags = json.loads(p.tags)
                except:
                    p.tags = []

            # Find related images via Jobs (N+1 but acceptable for small limit)
            job_stmt = select(Job.id).where(Job.prompt_id == p.id)
            job_ids = session.exec(job_stmt).all()

            related: List[str] = []
            if job_ids:
                img_stmt = (
                    select(Image.path)
                    .where(col(Image.job_id).in_(job_ids))
                    .order_by(Image.id.desc())
                    .limit(4)
                )
                related = session.exec(img_stmt).all()

            results.append(
                PromptWithImages(
                    **p.dict(),
                    related_images=related,
                )
            )

        return results


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

    existing = session.exec(select(Tag).where(col(Tag.name).in_(names))).all()
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
