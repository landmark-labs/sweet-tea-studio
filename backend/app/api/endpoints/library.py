"""
Library API Endpoints

This module handles:
1. PROMPTS: CRUD operations and search for prompt library
   - GET /library/ - List/search prompts with fuzzy matching
   - POST /library/ - Create new prompt
   - GET /library/{prompt_id} - Get single prompt
   - DELETE /library/{prompt_id} - Delete prompt

2. SUGGESTIONS: Autocomplete for prompts (and tags via sub-router)
   - GET /library/suggest - Combined suggestion endpoint

3. TAGS: Mounted from library_tags.py at /tags
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Literal, Optional
import json
import math
import time
from threading import Thread

from difflib import SequenceMatcher
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from sqlmodel import Session, col, func, or_, select

from app.models.prompt import Prompt, PromptCreate, PromptRead
from app.models.tag import Tag
from app.db.engine import engine as db_engine, tags_engine
from app.models.image import Image
from app.models.job import Job
from app.models.project import Project
from app.services.gallery.metadata import _extract_prompts_from_param_dict

# Import new tag module
from app.api.endpoints import library_tags

router = APIRouter()

# Include the tags router with prefix
router.include_router(library_tags.router, prefix="/tags", tags=["tags"])

# Constants
TAG_CACHE_MAX_AGE = timedelta(hours=24)
TAG_CACHE_MAX_TAGS = 10000

# --- Models ---

class Suggestion(BaseModel):
    value: str
    type: Literal["tag", "prompt"]
    frequency: int = 0
    source: Optional[str] = None
    snippet: Optional[str] = None

class LibraryPrompt(BaseModel):
    image_id: int
    job_id: Optional[int] = None
    workflow_template_id: Optional[int] = None
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    created_at: datetime
    preview_path: str
    active_positive: Optional[str] = None
    active_negative: Optional[str] = None
    job_params: Dict[str, Any] = Field(default_factory=dict)
    prompt_history: List[Any] = Field(default_factory=list) # simplified for now
    tags: List[str] = Field(default_factory=list)
    caption: Optional[str] = None
    prompt_id: Optional[int] = None
    prompt_name: Optional[str] = None

class PromptStage(BaseModel):
    stage: int
    positive_text: Optional[str] = None
    negative_text: Optional[str] = None
    source: Optional[str] = None
    timestamp: Optional[str] = None


class LibrarySearchResponse(BaseModel):
    items: List[LibraryPrompt]
    offset: int
    limit: int
    has_more: bool

# --- Helpers ---

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


def _tokenize_query(query: str) -> List[str]:
    return [tok for tok in query.lower().replace(",", " ").split() if tok]


def _field_relevance(query: str, tokens: List[str], text: str) -> float:
    if not text:
        return 0.0
    lower = text.lower()
    token_hits = sum(1 for token in tokens if token in lower)
    coverage = token_hits / len(tokens) if tokens else 0.0
    phrase = 1.0 if query and query in lower else 0.0
    fuzzy = SequenceMatcher(None, query, lower).ratio() if query else 0.0
    return (0.58 * coverage) + (0.28 * phrase) + (0.14 * fuzzy)


def _recency_score(created_at: datetime) -> float:
    age_days = max((datetime.utcnow() - created_at).total_seconds() / 86400.0, 0.0)
    # Smooth half-life (~45 days) so very old but highly relevant items can still rank.
    return math.exp(-age_days / 45.0)


def _score_search_match(
    query: str,
    *,
    active_positive: Optional[str],
    active_negative: Optional[str],
    caption: Optional[str],
    tags: List[str],
    prompt_history: List[PromptStage],
    prompt_name: Optional[str],
    project_name: Optional[str],
    filename: Optional[str],
    created_at: datetime,
) -> float:
    query_lower = (query or "").strip().lower()
    if not query_lower:
        # No query: pure recency ranking.
        return _recency_score(created_at)

    tokens = _tokenize_query(query_lower)
    if not tokens:
        return _recency_score(created_at)

    history_text = " ".join(
        f"{stage.positive_text or ''} {stage.negative_text or ''}" for stage in prompt_history
    )
    tag_text = " ".join(tags or [])

    relevance = (
        0.40 * _field_relevance(query_lower, tokens, active_positive or "")
        + 0.08 * _field_relevance(query_lower, tokens, active_negative or "")
        + 0.28 * _field_relevance(query_lower, tokens, caption or "")
        + 0.12 * _field_relevance(query_lower, tokens, tag_text)
        + 0.06 * _field_relevance(query_lower, tokens, history_text)
        + 0.03 * _field_relevance(query_lower, tokens, prompt_name or "")
        + 0.02 * _field_relevance(query_lower, tokens, project_name or "")
        + 0.01 * _field_relevance(query_lower, tokens, filename or "")
    )
    recency = _recency_score(created_at)
    return (0.86 * relevance) + (0.14 * recency)


def _search_library_prompts(
    session: Session,
    *,
    search: Optional[str],
    workflow_id: Optional[int],
    offset: int,
    limit: int,
) -> tuple[List[LibraryPrompt], bool]:
    base_query = (
        select(Image, Job, Prompt, Project)
        .join(Job, Image.job_id == Job.id, isouter=True)
        .join(Prompt, Job.prompt_id == Prompt.id, isouter=True)
        .join(Project, Job.project_id == Project.id, isouter=True)
        .where(Image.is_deleted == False)  # noqa: E712
        .order_by(Image.created_at.desc())
    )
    if workflow_id:
        base_query = base_query.where(Job.workflow_template_id == workflow_id)

    clean_search = (search or "").strip()
    if not clean_search:
        rows = session.exec(base_query.offset(offset).limit(limit + 1)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
    else:
        tokens = _tokenize_query(clean_search)
        try:
            prompt_field = func.lower(func.coalesce(func.json_extract(Job.input_params, "$.prompt"), ""))
            negative_field = func.lower(func.coalesce(func.json_extract(Job.input_params, "$.negative_prompt"), ""))
        except AttributeError:
            prompt_field = func.lower(func.coalesce(Job.input_params, ""))
            negative_field = func.lower(func.coalesce(Job.input_params, ""))

        token_filters = []
        for token in tokens[:4]:
            like = f"%{token}%"
            token_filters.append(
                or_(
                    func.lower(func.coalesce(Image.caption, "")).like(like),
                    prompt_field.like(like),
                    negative_field.like(like),
                    func.lower(func.coalesce(Prompt.positive_text, "")).like(like),
                    func.lower(func.coalesce(Prompt.negative_text, "")).like(like),
                    func.lower(func.coalesce(Prompt.name, "")).like(like),
                    func.lower(func.coalesce(Image.filename, "")).like(like),
                    func.lower(func.coalesce(Project.name, "")).like(like),
                )
            )
        filtered = base_query.where(or_(*token_filters)) if token_filters else base_query
        candidate_limit = min(max((offset + limit) * 8, 320), 5000)
        rows = session.exec(filtered.limit(candidate_limit)).all()
        has_more = False

    scored_results: List[tuple[float, LibraryPrompt]] = []
    query_tokens = _tokenize_query(clean_search) if clean_search else []
    for image, job, prompt, project in rows:
        raw_params = job.input_params if job and job.input_params else {}
        if isinstance(raw_params, str):
            try:
                raw_params = json.loads(raw_params)
            except Exception:
                raw_params = {}
        if not isinstance(raw_params, dict):
            raw_params = {}

        metadata = image.extra_metadata if isinstance(image.extra_metadata, dict) else {}
        if isinstance(image.extra_metadata, str):
            try:
                metadata = json.loads(image.extra_metadata)
            except Exception:
                metadata = {}
        if not isinstance(metadata, dict):
            metadata = {}

        raw_history = metadata.get("prompt_history", [])
        prompt_history: List[PromptStage] = []
        if isinstance(raw_history, list):
            for idx, entry in enumerate(raw_history):
                if not isinstance(entry, dict):
                    continue
                prompt_history.append(
                    PromptStage(
                        stage=entry.get("stage", idx),
                        positive_text=entry.get("positive_text"),
                        negative_text=entry.get("negative_text"),
                        source=entry.get("source"),
                        timestamp=entry.get("timestamp"),
                    )
                )

        active_prompt = metadata.get("active_prompt") if isinstance(metadata.get("active_prompt"), dict) else {}
        active_positive = active_prompt.get("positive_text")
        active_negative = active_prompt.get("negative_text")

        if not active_positive or not active_negative:
            inferred_pos, inferred_neg = _extract_prompts_from_param_dict(raw_params)
            if not active_positive and inferred_pos:
                active_positive = inferred_pos
            if not active_negative and inferred_neg:
                active_negative = inferred_neg

        if not active_positive:
            active_positive = (
                raw_params.get("prompt")
                or raw_params.get("positive_prompt")
                or raw_params.get("positive")
                or raw_params.get("text_positive")
            )
        if not active_negative:
            active_negative = (
                raw_params.get("negative_prompt")
                or raw_params.get("negative")
                or raw_params.get("text_negative")
            )

        tags: List[str] = []
        raw_tags = prompt.tags if prompt else []
        if isinstance(raw_tags, str):
            try:
                parsed_tags = json.loads(raw_tags)
                if isinstance(parsed_tags, list):
                    tags = [tag for tag in parsed_tags if isinstance(tag, str)]
            except Exception:
                tags = []
        elif isinstance(raw_tags, list):
            tags = [tag for tag in raw_tags if isinstance(tag, str)]

        caption = image.caption
        preview_path = image.thumbnail_path or image.path

        item = LibraryPrompt(
            image_id=image.id,
            job_id=job.id if job else None,
            workflow_template_id=job.workflow_template_id if job else None,
            project_id=project.id if project else None,
            project_name=project.name if project else None,
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
        )

        if clean_search:
            haystack = " ".join(
                filter(
                    None,
                    [
                        active_positive or "",
                        active_negative or "",
                        caption or "",
                        " ".join(tags),
                        image.filename or "",
                        item.prompt_name or "",
                        item.project_name or "",
                    ],
                )
            ).lower()
            if not any(token in haystack for token in query_tokens):
                continue

        score = _score_search_match(
            clean_search,
            active_positive=active_positive,
            active_negative=active_negative,
            caption=caption,
            tags=tags,
            prompt_history=prompt_history,
            prompt_name=item.prompt_name,
            project_name=item.project_name,
            filename=image.filename,
            created_at=image.created_at,
        )

        scored_results.append((score, item))

    scored_results.sort(key=lambda row: (row[0], row[1].created_at), reverse=True)
    if clean_search:
        has_more = len(scored_results) > (offset + limit)

    paged = scored_results[offset: offset + limit]
    return [item for _, item in paged], has_more


# --- Endpoints ---

@router.get("/", response_model=List[LibraryPrompt])
def read_prompts(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    workflow_id: Optional[int] = None
):
    with Session(db_engine) as session:
        results, _has_more = _search_library_prompts(
            session,
            search=search,
            workflow_id=workflow_id,
            offset=skip,
            limit=limit,
        )
        return results


@router.get("/media-search", response_model=LibrarySearchResponse)
def media_search(
    q: Optional[str] = None,
    workflow_id: Optional[int] = None,
    offset: int = 0,
    limit: int = 20,
):
    with Session(db_engine) as session:
        items, has_more = _search_library_prompts(
            session,
            search=q,
            workflow_id=workflow_id,
            offset=max(0, offset),
            limit=max(1, min(limit, 100)),
        )
        return LibrarySearchResponse(
            items=items,
            offset=max(0, offset),
            limit=max(1, min(limit, 100)),
            has_more=has_more,
        )


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
        
        # Call the new tags module function
        library_tags.upsert_tags_in_cache(inferred_tags, source="prompt")
        
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
    q = f"%{query.lower()}%"

    with Session(tags_engine) as tag_session:
        tag_stmt = (
            select(Tag)
            .where(col(Tag.name).ilike(q))
            .order_by(Tag.frequency.desc())
            .limit(limit)
        )
        tags = tag_session.exec(tag_stmt).all()

    with Session(db_engine) as session:
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

# Background Tasks (e.g. daily refresh) are now handled by library_tags
# We could export a helper here if needed, but they are generally started by the main app lifespan.
