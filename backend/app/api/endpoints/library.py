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
import time
from threading import Thread

from difflib import SequenceMatcher
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from sqlmodel import Session, col, select

from app.models.prompt import Prompt, PromptCreate, PromptRead
from app.models.tag import Tag
from app.db.engine import engine as db_engine, tags_engine
from app.models.image import Image
from app.models.job import Job
from app.models.project import Project

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


def _score_search_match(search: str, text_block: str) -> float:
    """Return a fuzzy score between the search term and the text block."""

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


# --- Endpoints ---

@router.get("/", response_model=List[LibraryPrompt])
def read_prompts(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    workflow_id: Optional[int] = None
):
    with Session(db_engine) as session:
        query = (
            select(Image, Job, Prompt, Project)
            .join(Job, Image.job_id == Job.id, isouter=True)
            .join(Prompt, Job.prompt_id == Prompt.id, isouter=True)
            .join(Project, Job.project_id == Project.id, isouter=True)
            .where(Image.is_deleted == False)  # Exclude soft-deleted
            .order_by(Image.created_at.desc())
        )

        if workflow_id:
            query = query.where(Job.workflow_template_id == workflow_id)

        rows = session.exec(query.offset(skip).limit(limit * 5)).all()

        scored_results: List[tuple[float, LibraryPrompt]] = []
        for image, job, prompt, project in rows:
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

            # Helper to find text from node-prefixed keys (e.g., CLIPTextEncode.text)
            def find_text_value(params: dict, patterns: list, exclude_patterns: list = None) -> Optional[str]:
                """Search for the first matching key pattern that contains text."""
                exclude_patterns = exclude_patterns or []
                for key, value in params.items():
                    key_lower = key.lower()
                    # Skip if any exclude pattern is in the key
                    if any(ex in key_lower for ex in exclude_patterns):
                        continue
                    # Check if any pattern matches
                    if any(p in key_lower for p in patterns):
                        if isinstance(value, str) and len(value) > 5:
                            return value
                return None

            # Helper to classify prompt fields by checking key names for positive/negative hints
            def classify_prompt_fields(params: dict) -> tuple:
                """
                Scan params for STRING_LITERAL or CLIPTextEncode text fields.
                Classify as positive/negative based on key name patterns.
                Returns (positive, negative) tuple.
                """
                import re
                positive_hints = ["positive", "_pos", ".pos", "pos_"]
                negative_hints = ["negative", "_neg", ".neg", "neg_"]
                
                candidates = []
                for key, value in params.items():
                    if not isinstance(value, str) or len(value.strip()) < 3:
                        continue
                    key_lower = key.lower()
                    # Skip lora-related fields
                    if "lora" in key_lower:
                        continue
                    # Check for prompt-like patterns
                    is_prompt_field = (
                        ("cliptextencode" in key_lower and ".text" in key_lower) or
                        "string_literal" in key_lower or
                        "stringliteral" in key_lower or
                        (".string" in key_lower and "lora" not in key_lower)
                    )
                    if not is_prompt_field:
                        continue
                    
                    # Classify by key name hints
                    is_positive = any(h in key_lower for h in positive_hints)
                    is_negative = any(h in key_lower for h in negative_hints)
                    
                    # Extract node ID for ordering fallback
                    node_id = None
                    node_match = re.match(r'^(\d+)\.', key)
                    if node_match:
                        node_id = int(node_match.group(1))
                    else:
                        # Try to extract from patterns like "STRING_LITERAL_2.string"
                        id_match = re.search(r'_(\d+)[._]', key)
                        if id_match:
                            node_id = int(id_match.group(1))
                    
                    candidates.append({
                        "key": key,
                        "value": value,
                        "is_positive": is_positive,
                        "is_negative": is_negative,
                        "node_id": node_id
                    })
                
                # First pass: use explicit positive/negative hints in key names
                pos_result = None
                neg_result = None
                for c in candidates:
                    if c["is_positive"] and not c["is_negative"] and not pos_result:
                        pos_result = c["value"]
                    if c["is_negative"] and not c["is_positive"] and not neg_result:
                        neg_result = c["value"]
                
                # Second pass: if not found by hints, use node ID ordering (lower ID = positive)
                if not pos_result or not neg_result:
                    # Sort by node_id (None values last)
                    sorted_candidates = sorted(
                        [c for c in candidates if not c["is_positive"] and not c["is_negative"]],
                        key=lambda x: (x["node_id"] is None, x["node_id"] or 9999)
                    )
                    for c in sorted_candidates:
                        if not pos_result:
                            pos_result = c["value"]
                        elif not neg_result:
                            neg_result = c["value"]
                            break
                
                return pos_result, neg_result

            # Fallbacks for older records - check multiple common field names
            if not active_positive:
                # First try: direct keys
                active_positive = (
                    (prompt_history[0].positive_text if prompt_history else None) or 
                    raw_params.get("prompt") or
                    raw_params.get("positive_prompt") or
                    raw_params.get("positive") or
                    raw_params.get("text_positive") or
                    raw_params.get("clip_l") or
                    raw_params.get("text")
                )
                # Second try: node-prefixed keys (e.g., CLIPTextEncode.text)
                if not active_positive:
                    # Look for first CLIPTextEncode (usually positive)
                    active_positive = find_text_value(
                        raw_params, 
                        ["cliptextencode.text", "clip_text.text", "positive.text"],
                        exclude_patterns=["_2.", "_neg", "negative"]
                    )
                # Third try: use smart classification for STRING_LITERAL/CLIPTextEncode
                if not active_positive:
                    classified_pos, classified_neg = classify_prompt_fields(raw_params)
                    if classified_pos:
                        active_positive = classified_pos
                    # Also set negative if found and not already set
                    if classified_neg and not active_negative:
                        active_negative = classified_neg
            
            if not active_negative:
                active_negative = (
                    (prompt_history[0].negative_text if prompt_history else None) or 
                    raw_params.get("negative_prompt") or
                    raw_params.get("negative") or
                    raw_params.get("text_negative") or
                    raw_params.get("clip_l_negative")
                )
                # Second try: node-prefixed keys (e.g., CLIPTextEncode_2.text)
                if not active_negative:
                    active_negative = find_text_value(
                        raw_params,
                        ["cliptextencode_2.text", "cliptextencode_neg", "negative.text", "_2.text"],
                        exclude_patterns=[]
                    )
                # Third try: use smart classification (may already be set above)
                if not active_negative:
                    _, classified_neg = classify_prompt_fields(raw_params)
                    if classified_neg:
                        active_negative = classified_neg

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
