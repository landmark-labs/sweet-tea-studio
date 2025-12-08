from fastapi import APIRouter, HTTPException, Query, Depends
from typing import List, Dict, Any, Optional
from datetime import datetime
from difflib import SequenceMatcher
from fastapi.responses import FileResponse
import os
from sqlmodel import Session, select, func, or_
from app.db.database import get_session
from app.models.image import Image, ImageRead
from app.models.job import Job
from app.models.prompt import Prompt
from app.models.engine import Engine
from pydantic import BaseModel, Field
import json

router = APIRouter()

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

@router.get("/", response_model=List[GalleryItem])
def read_gallery(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    search: Optional[str] = Query(None, description="Search by prompt text, tags, or caption"),
    kept_only: bool = Query(False),
    collection_id: Optional[int] = Query(None),
    session: Session = Depends(get_session)
):
    try:
        # Join Image, Job, and Prompt
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

        if search:
            like = f"%{search.lower()}%"
            # SQLite specific extraction or generic text search
            # We assume Job.input_params is JSON. 
            # Depending on DB (SQLite vs Postgres), json access differs. 
            # In SQLite with SQLModel, JSON is text or strict JSON type.
            # We will try a robust text-based search for simplicity if JSON functions fail or just generic ILIKE on known columns.
            
            # Using the fork's logic map:
            # prompt_field = func.lower(func.coalesce(func.json_extract(Job.input_params, '$.prompt'), ""))
            # For robustness across different SQLite versions/drivers in python, we might stick to what we know works or generic text.
            # But let's try to stick to the fork's logic since it seemed to rely on `json_extract`.
            
            try:
                # Use SQLModel functions if imported, or sqlalchemy.func
                from sqlalchemy import func, or_
                
                # Try json_extract if supported
                prompt_field = func.lower(func.coalesce(func.json_extract(Job.input_params, '$.prompt'), ""))
                negative_field = func.lower(func.coalesce(func.json_extract(Job.input_params, '$.negative_prompt'), ""))
                tag_field = func.lower(func.coalesce(func.json_extract(Prompt.tags, '$'), ""))
            except Exception:
                # Fallback if json_extract not available (though it should be in modern sqlite)
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
        results = session.exec(stmt).all()
        scored_items: List[tuple[float, GalleryItem]] = []
        for img, job, prompt in results:
            params = job.input_params if job and job.input_params else {}
            if isinstance(params, str):
                try:
                    params = json.loads(params)
                except:
                    params = {}

            prompt_text = params.get("prompt")
            negative_prompt = params.get("negative_prompt")

            # Normalize prompt history from extra_metadata when available
            metadata = img.extra_metadata if isinstance(img.extra_metadata, dict) else {}
            if isinstance(img.extra_metadata, str):
                try:
                    metadata = json.loads(img.extra_metadata)
                except Exception:
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
                except Exception:
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
                job_params=params,
                prompt=prompt_text,
                negative_prompt=negative_prompt,
                prompt_history=history,
                workflow_template_id=job.workflow_template_id if job else None,
                created_at=img.created_at,
                caption=caption,
                prompt_tags=prompt_tags,
                prompt_name=prompt.name if prompt else None,
                engine_id=job.engine_id if job else None,
                collection_id=img.collection_id
            )
            scored_items.append((score, item))

        if search:
            scored_items.sort(key=lambda r: (r[0], r[1].created_at), reverse=True)
            return [item for _, item in scored_items[:limit]]

        return [item for _, item in scored_items]
    except Exception as e:
        print(f"Gallery read error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{image_id}")
def delete_image(image_id: int, session: Session = Depends(get_session)):
    image = session.get(Image, image_id)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    session.delete(image)
    session.commit()
    return {"status": "deleted"}

# --- Specific Features from Diffusion Studio Repo (Preserved) ---

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
            except Exception as e:
                print(f"Failed to delete file {img.path}: {e}")
        
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

    print(f"Serve Path: Missing {path}")
    raise HTTPException(status_code=404, detail=f"File not found: {path}")

@router.get("/image/{image_id}")
def serve_image(image_id: int, session: Session = Depends(get_session)):
    image = session.get(Image, image_id)
    if not image:
        print(f"Serve Image: ID {image_id} not found DB")
        raise HTTPException(status_code=404, detail="Image not found")
    
    if not os.path.exists(image.path):
            print(f"Serve Image: File missing at {image.path}")
            raise HTTPException(status_code=404, detail=f"File not found on disk: {image.path}")
            
    print(f"Serving image {image_id} from {image.path}")
    return FileResponse(image.path, media_type="image/png")
