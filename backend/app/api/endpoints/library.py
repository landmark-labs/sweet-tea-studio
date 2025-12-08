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

router = APIRouter()


class Suggestion(BaseModel):
    value: str
    type: Literal["tag", "prompt"]
    frequency: int = 0
    source: Optional[str] = None
    snippet: Optional[str] = None


class PromptWithImages(PromptRead):
    related_images: List[str] = Field(default_factory=list)


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

                tag_match = any(search_lower in (t or "").lower() for t in (p.tags or []))
                return search_lower in text_block or tag_match

            prompts = [p for p in prompts if matches(p)]

        results: List[PromptWithImages] = []
        for p in prompts:
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
            snippet_parts = [p.positive_text or "", p.description or ""]
            snippet = " ".join([s for s in snippet_parts if s]).strip()
            suggestions.append(
                Suggestion(
                    value=p.name,
                    type="prompt",
                    frequency=len(p.tags or []),
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
