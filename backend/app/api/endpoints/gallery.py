import json
import logging
import os
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, func, or_, select

from app.db.database import get_session
from app.models.engine import Engine
from app.models.image import Image, ImageRead
from app.models.job import Job
from app.models.prompt import Prompt

router = APIRouter()
logger = logging.getLogger(__name__)


class GalleryItem(BaseModel):
    image: ImageRead
    job_params: Dict[str, Any]
    prompt: Optional[str] = None
    negative_prompt: Optional[str] = None
    prompt_history: List[Dict[str, Any]] = Field(default_factory=list)
    workflow_template_id: Optional[int] = None
    created_at: datetime
    caption: Optional[str] = None
    prompt_tags: List[str] = Field(default_factory=list)
    prompt_name: Optional[str] = None
    engine_id: Optional[int] = None
    collection_id: Optional[int] = None
    project_id: Optional[int] = None


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


def _log_context(request: Optional[Request], **extra: Any) -> Dict[str, Any]:
    context = {
        "path": request.url.path if request else None,
        "method": request.method if request else None,
        "client": request.client.host if request and request.client else None,
    }
    context.update({k: v for k, v in extra.items() if v is not None})
    return context


@router.get("/", response_model=List[GalleryItem])
def read_gallery(
    request: Request,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    search: Optional[str] = Query(None, description="Search by prompt text, tags, or caption"),
    kept_only: bool = Query(False),
    collection_id: Optional[int] = Query(None),
    project_id: Optional[int] = Query(None),
    unassigned_only: bool = Query(False, description="Return only images with no project assignment"),
    session: Session = Depends(get_session),
):
    fetch_limit = limit * 5 if search else limit
    stmt = (
        select(Image, Job, Prompt)
        .join(Job, Image.job_id == Job.id, isouter=True)
        .join(Prompt, Job.prompt_id == Prompt.id, isouter=True)
        .order_by(Image.created_at.desc())
        .offset(skip)
        .limit(fetch_limit)
    )

    if kept_only:
        stmt = stmt.where(Image.is_kept == True)

    if collection_id is not None:
        stmt = stmt.where(Image.collection_id == collection_id)

    if project_id is not None:
        stmt = stmt.where(Job.project_id == project_id)
    elif unassigned_only:
        stmt = stmt.where(Job.project_id == None)

    if search:
        like = f"%{search.lower()}%"
        try:
            prompt_field = func.lower(func.coalesce(func.json_extract(Job.input_params, '$.prompt'), ""))
            negative_field = func.lower(func.coalesce(func.json_extract(Job.input_params, '$.negative_prompt'), ""))
            tag_field = func.lower(func.coalesce(func.json_extract(Prompt.tags, '$'), ""))
        except AttributeError:
            prompt_field = func.lower(func.coalesce(Job.input_params, ""))
            negative_field = func.lower(func.coalesce(Job.input_params, ""))
            tag_field = func.lower(func.coalesce(Prompt.tags, ""))

        stmt = stmt.where(
            or_(
                prompt_field.like(like),
                negative_field.like(like),
                func.lower(func.coalesce(Prompt.positive_text, "")).like(like),
                func.lower(func.coalesce(Prompt.negative_text, "")).like(like),
                func.lower(func.coalesce(Image.caption, "")).like(like),
                tag_field.like(like),
            )
        )

    try:
        results = session.exec(stmt).all()
    except SQLAlchemyError:
        logger.exception(
            "Failed to fetch gallery results",
            extra=_log_context(
                request,
                search=search,
                skip=skip,
                limit=limit,
                kept_only=kept_only,
                collection_id=collection_id,
            ),
        )
        raise HTTPException(status_code=500, detail="Unable to fetch gallery items")

    scored_items: List[tuple[float, GalleryItem]] = []
    for img, job, prompt in results:
        params = job.input_params if job and job.input_params else {}
        if isinstance(params, str):
            try:
                params = json.loads(params)
            except json.JSONDecodeError:
                logger.exception(
                    "Invalid stored job params",
                    extra=_log_context(request, image_id=img.id, job_id=job.id if job else None),
                )
                params = {}

        prompt_text = params.get("prompt") if isinstance(params, dict) else None
        negative_prompt = params.get("negative_prompt") if isinstance(params, dict) else None

        metadata = img.extra_metadata if isinstance(img.extra_metadata, dict) else {}
        if isinstance(img.extra_metadata, str):
            try:
                metadata = json.loads(img.extra_metadata)
            except json.JSONDecodeError:
                logger.exception(
                    "Invalid extra metadata JSON",
                    extra=_log_context(request, image_id=img.id),
                )
                metadata = {}

        history = []
        if isinstance(metadata, dict):
            raw_history = metadata.get("prompt_history", [])
            if isinstance(raw_history, list):
                history = [entry for entry in raw_history if isinstance(entry, dict)]

            active_prompt = metadata.get("active_prompt")
            if isinstance(active_prompt, dict):
                prompt_text = active_prompt.get("positive_text", prompt_text)
                negative_prompt = active_prompt.get("negative_text", negative_prompt)

        raw_tags = prompt.tags if prompt else []
        if isinstance(raw_tags, str):
            try:
                prompt_tags = json.loads(raw_tags)
            except json.JSONDecodeError:
                logger.exception(
                    "Invalid prompt tags JSON",
                    extra=_log_context(request, prompt_id=prompt.id if prompt else None),
                )
                prompt_tags = []
        else:
            prompt_tags = raw_tags or []

        caption = img.caption

        search_block = _build_search_block(
            prompt_text=prompt_text,
            negative_prompt=negative_prompt,
            caption=caption,
            tags=prompt_tags,
            history=history,
        )

        if search:
            score = _score_search_match(search, search_block)
            if score < 0.35:
                continue
        else:
            score = 1.0

        item = GalleryItem(
            image=img,
            job_params=params if isinstance(params, dict) else {},
            prompt=prompt_text,
            negative_prompt=negative_prompt,
            prompt_history=history,
            workflow_template_id=job.workflow_template_id if job else None,
            created_at=img.created_at,
            caption=caption,
            prompt_tags=prompt_tags,
            prompt_name=prompt.name if prompt else None,
            engine_id=job.engine_id if job else None,
            collection_id=img.collection_id,
            project_id=job.project_id if job else None,
        )
        scored_items.append((score, item))

    if search:
        scored_items.sort(key=lambda r: (r[0], r[1].created_at), reverse=True)
        return [item for _, item in scored_items[:limit]]

    return [item for _, item in scored_items]


@router.delete("/{image_id}")
def delete_image(image_id: int, session: Session = Depends(get_session)):
    image = session.get(Image, image_id)
    if not image:
        logger.warning("Image not found for deletion", extra={"image_id": image_id})
        raise HTTPException(status_code=404, detail="Image not found")
    session.delete(image)
    session.commit()
    return {"status": "deleted"}

# --- Specific Features from Sweet Tea Studio Repo (Preserved) ---

class KeepRequest(BaseModel):
    image_ids: List[int]
    keep: bool


@router.post("/keep")
def keep_images(req: KeepRequest, session: Session = Depends(get_session)):
    images = session.exec(select(Image).where(Image.id.in_(req.image_ids))).all()
    for img in images:
        img.is_kept = req.keep
        session.add(img)
    session.commit()
    return {"status": "updated", "count": len(images)}


class CleanupRequest(BaseModel):
    job_id: Optional[int] = None


@router.post("/cleanup")
def cleanup_images(req: CleanupRequest, session: Session = Depends(get_session)):
    query = select(Image).where(Image.is_kept == False)
    if req.job_id:
        query = query.where(Image.job_id == req.job_id)

    images_to_delete = session.exec(query).all()

    count = 0
    for img in images_to_delete:
        # Delete from disk
        if img.path and os.path.exists(img.path):
            try:
                os.remove(img.path)
            except OSError:
                logger.exception("Failed to delete file", extra={"path": img.path, "image_id": img.id})

        # Delete from DB
        session.delete(img)
        count += 1

    session.commit()
    return {"status": "cleaned", "count": count}


# ----------------------------------------------------------------

@router.get("/image/path")
def serve_image_by_path(path: str, session: Session = Depends(get_session)):
    # 1. Try absolute/direct path
    if os.path.exists(path):
        return FileResponse(path, media_type="image/png")

    # 2. Try looking in Engine directories (Input/Output)
    # We fetch the first active engine or "Local ComfyUI"
    engine = session.exec(select(Engine).where(Engine.name == "Local ComfyUI")).first()
    if not engine:
        # Fallback to any engine
        engine = session.exec(select(Engine)).first()

    if engine:
        # Check Input Dir
        if engine.input_dir:
            input_path = os.path.join(engine.input_dir, path)
            if os.path.exists(input_path):
                return FileResponse(input_path, media_type="image/png")

        # Check Output Dir
        if engine.output_dir:
            output_path = os.path.join(engine.output_dir, path)
            if os.path.exists(output_path):
                return FileResponse(output_path, media_type="image/png")

    logger.warning("Serve Path: Missing file", extra={"path": path})
    raise HTTPException(status_code=404, detail=f"File not found: {path}")


@router.get("/image/{image_id}")
def serve_image(image_id: int, session: Session = Depends(get_session)):
    image = session.get(Image, image_id)
    if not image:
        logger.warning("Serve Image: ID not found in DB", extra={"image_id": image_id})
        raise HTTPException(status_code=404, detail="Image not found")

    if not os.path.exists(image.path):
        logger.warning("Serve Image: File missing on disk", extra={"path": image.path, "image_id": image_id})
        raise HTTPException(status_code=404, detail=f"File not found on disk: {image.path}")

    logger.info("Serving image", extra={"image_id": image_id, "path": image.path})
    return FileResponse(image.path, media_type="image/png")
