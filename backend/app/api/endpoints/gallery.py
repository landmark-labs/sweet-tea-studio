from fastapi import APIRouter, HTTPException, Query, Depends
from typing import List, Dict, Any, Optional
from sqlalchemy import func, or_
from datetime import datetime
from fastapi.responses import FileResponse
import os
from sqlmodel import Session, select
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
    workflow_template_id: Optional[int] = None
    created_at: datetime
    caption: Optional[str] = None
    prompt_tags: List[str] = Field(default_factory=list)
    prompt_name: Optional[str] = None
    engine_id: Optional[int] = None
    collection_id: Optional[int] = None

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
        stmt = (
            select(Image, Job, Prompt)
            .join(Job, Image.job_id == Job.id, isouter=True)
            .join(Prompt, Job.prompt_id == Prompt.id, isouter=True)
            .order_by(Image.created_at.desc())
            .offset(skip)
            .limit(limit)
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
        
        items = []
        for img, job, prompt in results:
            params = job.input_params if job and job.input_params else {}
            if isinstance(params, str):
                try:
                    params = json.loads(params)
                except:
                    params = {}

            prompt_text = params.get("prompt")
            
            raw_tags = prompt.tags if prompt else []
            if isinstance(raw_tags, str):
                try:
                    prompt_tags = json.loads(raw_tags)
                except:
                   prompt_tags = []
            else:
                prompt_tags = raw_tags or []
                
            caption = img.caption

            item = GalleryItem(
                image=img,
                job_params=params,
                prompt=prompt_text,
                workflow_template_id=job.workflow_template_id if job else None,
                created_at=img.created_at,
                caption=caption,
                prompt_tags=prompt_tags,
                prompt_name=prompt.name if prompt else None,
                engine_id=job.engine_id if job else None,
                collection_id=img.collection_id
            )
            items.append(item)
            
        return items
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
