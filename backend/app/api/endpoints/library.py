from datetime import datetime
from fastapi import APIRouter, HTTPException
from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field
from sqlmodel import Session, select, col

from app.models.prompt import Prompt, PromptCreate, PromptRead
from app.models.tag import Tag, TagCreate
from app.db.engine import engine as db_engine
from app.models.image import Image
from app.models.job import Job
import json

router = APIRouter()


class Suggestion(BaseModel):
    value: str
    type: Literal["tag", "prompt"]
    frequency: int = 0
    source: Optional[str] = None
    snippet: Optional[str] = None


class PromptWithImages(PromptRead):
    related_images: List[str] = Field(default_factory=list)


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

        rows = session.exec(query.offset(skip).limit(limit * 3)).all()

        results: List[LibraryPrompt] = []
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

            if search:
                search_lower = search.lower()
                text_block = " ".join(filter(None, [
                    active_positive or "",
                    active_negative or "",
                    caption or "",
                    " ".join(tags),
                    " ".join([
                        (stage.positive_text or "") + " " + (stage.negative_text or "")
                        for stage in prompt_history
                    ]),
                ])).lower()

                if search_lower not in text_block:
                    continue

            results.append(
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
                )
            )

        return results[:limit]


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
