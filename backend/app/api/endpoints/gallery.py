import json
import logging
import os
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from PIL import Image as PILImage
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
    limit: Optional[int] = Query(None, ge=1, description="Max items to return. If omitted, returns all."),
    search: Optional[str] = Query(None, description="Search by prompt text, tags, or caption"),
    kept_only: bool = Query(False),
    collection_id: Optional[int] = Query(None),
    project_id: Optional[int] = Query(None),
    unassigned_only: bool = Query(False, description="Return only images with no project assignment"),
    session: Session = Depends(get_session),
):
    # When limit is None, fetch all; when searching, fetch more to allow scoring/filtering
    fetch_limit = None
    if limit is not None:
        fetch_limit = limit * 5 if search else limit
    
    stmt = (
        select(Image, Job, Prompt)
        .join(Job, Image.job_id == Job.id, isouter=True)
        .join(Prompt, Job.prompt_id == Prompt.id, isouter=True)
        .where(Image.is_deleted == False)  # Exclude soft-deleted images
        .order_by(Image.created_at.desc())
        .offset(skip)
    )
    if fetch_limit is not None:
        stmt = stmt.limit(fetch_limit)

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
        if limit is not None:
            return [item for _, item in scored_items[:limit]]
        return [item for _, item in scored_items]

    return [item for _, item in scored_items]


@router.delete("/{image_id}")
def delete_image(image_id: int, session: Session = Depends(get_session)):
    # Reuse bulk path for robustness and consistent behavior
    result = _bulk_soft_delete([image_id], session)
    if result.deleted == 0:
        logger.warning("Image not found for deletion", extra={"image_id": image_id})
        raise HTTPException(status_code=404, detail="Image not found")

    return {
        "status": "deleted",
        "file_deleted": image_id not in result.file_errors,
        "soft_delete": True,
        "not_found": result.not_found,
        "file_errors": result.file_errors,
    }

# --- Specific Features from Sweet Tea Studio Repo (Preserved) ---

class KeepRequest(BaseModel):
    image_ids: List[int]
    keep: bool


@router.post("/keep")
def keep_images(req: KeepRequest, session: Session = Depends(get_session)):
    images = session.exec(select(Image).where(Image.id.in_(req.image_ids)).where(Image.is_deleted == False)).all()
    for img in images:
        img.is_kept = req.keep
        session.add(img)
    session.commit()
    return {"status": "updated", "count": len(images)}


class CleanupRequest(BaseModel):
    job_id: Optional[int] = None


class BulkDeleteRequest(BaseModel):
    image_ids: List[int]


class BulkDeleteResult(BaseModel):
    deleted: int
    not_found: List[int]
    file_errors: List[int]


def _bulk_soft_delete(image_ids: List[int], session: Session) -> BulkDeleteResult:
    """Best-effort soft delete of images + file cleanup without blowing up the server."""
    if not image_ids:
        return BulkDeleteResult(deleted=0, not_found=[], file_errors=[])

    images = session.exec(select(Image).where(Image.id.in_(image_ids))).all()
    images_by_id = {img.id: img for img in images}

    not_found = [img_id for img_id in image_ids if img_id not in images_by_id]
    file_errors: List[int] = []
    deleted_count = 0

    for img_id in image_ids:
        image = images_by_id.get(img_id)
        if not image:
            continue

        # Delete files best-effort
        try:
            if image.path and isinstance(image.path, str) and os.path.exists(image.path):
                os.remove(image.path)
                json_path = os.path.splitext(image.path)[0] + ".json"
                if os.path.exists(json_path):
                    os.remove(json_path)
        except OSError:
            file_errors.append(img_id)
            logger.exception("Failed to delete file during bulk delete", extra={"path": image.path, "image_id": img_id})

        # Soft delete in DB
        image.is_deleted = True
        image.deleted_at = datetime.utcnow()
        session.add(image)
        deleted_count += 1

    session.commit()
    return BulkDeleteResult(deleted=deleted_count, not_found=not_found, file_errors=file_errors)


@router.post("/bulk_delete", response_model=BulkDeleteResult)
def bulk_delete_images(req: BulkDeleteRequest, session: Session = Depends(get_session)):
    """
    Delete many images in a single transaction to avoid dozens of concurrent DELETE calls
    (which can exhaust workers and lock SQLite). Performs soft-delete in the DB and tries
    to remove the files; failure to delete a file no longer aborts the whole batch.
    """
    try:
        return _bulk_soft_delete(req.image_ids, session)
    except SQLAlchemyError:
        logger.exception("Bulk delete failed at DB layer")
        raise HTTPException(status_code=500, detail="Failed to delete images")


@router.post("/cleanup")
def cleanup_images(req: CleanupRequest, session: Session = Depends(get_session)):
    query = select(Image).where(Image.is_kept == False).where(Image.is_deleted == False)
    if req.job_id:
        query = query.where(Image.job_id == req.job_id)

    images_to_delete = session.exec(query).all()

    count = 0
    deleted_files = 0
    for img in images_to_delete:
        # Delete from disk
        if img.path and os.path.exists(img.path):
            try:
                os.remove(img.path)
                deleted_files += 1
                
                # Also delete associated .json metadata file if it exists
                json_path = os.path.splitext(img.path)[0] + ".json"
                if os.path.exists(json_path):
                    os.remove(json_path)
            except OSError:
                logger.exception("Failed to delete file", extra={"path": img.path, "image_id": img.id})

        # Soft delete: set flag instead of removing from DB
        img.is_deleted = True
        img.deleted_at = datetime.utcnow()
        session.add(img)
        count += 1

    session.commit()
    return {"status": "cleaned", "count": count, "files_deleted": deleted_files, "soft_delete": True}


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


@router.get("/image/path/metadata")
def get_image_metadata_by_path(path: str, session: Session = Depends(get_session)):
    """
    Read metadata directly from a PNG file.
    
    Returns ComfyUI workflow/prompt data and Sweet Tea provenance if embedded.
    Falls back to database extra_metadata if PNG metadata is not available.
    """
    # Resolve the actual file path
    actual_path = None
    
    if os.path.exists(path):
        actual_path = path
    else:
        # Try engine directories
        engine = session.exec(select(Engine).where(Engine.name == "Local ComfyUI")).first()
        if not engine:
            engine = session.exec(select(Engine)).first()
        
        if engine:
            if engine.input_dir:
                input_path = os.path.join(engine.input_dir, path)
                if os.path.exists(input_path):
                    actual_path = input_path
            if not actual_path and engine.output_dir:
                output_path = os.path.join(engine.output_dir, path)
                if os.path.exists(output_path):
                    actual_path = output_path
    
    if not actual_path:
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    
    result = {
        "path": path,
        "prompt": None,
        "negative_prompt": None,
        "workflow": None,
        "parameters": {},
        "source": "none"
    }
    
    try:
        with PILImage.open(actual_path) as img:
            info = img.info or {}
            
            # Try Sweet Tea provenance first (our custom format)
            if "sweet_tea_provenance" in info:
                try:
                    provenance = json.loads(info["sweet_tea_provenance"])
                    result["prompt"] = provenance.get("positive_prompt")
                    result["negative_prompt"] = provenance.get("negative_prompt")
                    result["parameters"] = {
                        k: v for k, v in provenance.items()
                        if k not in ["positive_prompt", "negative_prompt", "models", "params"]
                        and v is not None
                    }
                    # Include flattened params
                    if "params" in provenance and isinstance(provenance["params"], dict):
                        result["parameters"].update(provenance["params"])
                    result["source"] = "sweet_tea"
                    return result
                except json.JSONDecodeError:
                    pass
            
            # Try ComfyUI "prompt" metadata (standard ComfyUI format)
            if "prompt" in info:
                try:
                    prompt_data = json.loads(info["prompt"])
                    # Extract prompts from CLIPTextEncode nodes
                    for node_id, node in prompt_data.items():
                        if isinstance(node, dict):
                            class_type = node.get("class_type", "")
                            inputs = node.get("inputs", {})
                            if class_type == "CLIPTextEncode":
                                text = inputs.get("text", "")
                                if not result["prompt"]:
                                    result["prompt"] = text
                                elif not result["negative_prompt"]:
                                    result["negative_prompt"] = text
                            # Extract KSampler parameters
                            elif "KSampler" in class_type or "Sampler" in class_type:
                                for k in ["seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"]:
                                    if k in inputs and inputs[k] is not None:
                                        result["parameters"][k] = inputs[k]
                            # Extract checkpoint/model info
                            elif "CheckpointLoader" in class_type or "Load Checkpoint" in class_type:
                                ckpt = inputs.get("ckpt_name")
                                if ckpt:
                                    result["parameters"]["checkpoint"] = ckpt
                            # Extract dimensions from EmptyLatentImage
                            elif "EmptyLatentImage" in class_type or "LatentImage" in class_type:
                                if "width" in inputs:
                                    result["parameters"]["width"] = inputs["width"]
                                if "height" in inputs:
                                    result["parameters"]["height"] = inputs["height"]
                            # Extract dimensions from general image nodes
                            elif "width" in inputs and "height" in inputs:
                                if "width" not in result["parameters"]:
                                    result["parameters"]["width"] = inputs["width"]
                                if "height" not in result["parameters"]:
                                    result["parameters"]["height"] = inputs["height"]
                    result["source"] = "comfyui"
                    return result
                except json.JSONDecodeError:
                    pass
            
            # Try ComfyUI "workflow" metadata
            if "workflow" in info:
                try:
                    result["workflow"] = json.loads(info["workflow"])
                    result["source"] = "comfyui_workflow"
                except json.JSONDecodeError:
                    pass
    
    except Exception as e:
        logger.warning("Failed to read PNG metadata", extra={"path": path, "error": str(e)})
    
    # Fallback: try to find in database by path (most recent first)
    image = session.exec(
        select(Image).where(Image.path == path).order_by(Image.created_at.desc())
    ).first()
    if image and image.extra_metadata:
        metadata = image.extra_metadata if isinstance(image.extra_metadata, dict) else {}
        if isinstance(image.extra_metadata, str):
            try:
                metadata = json.loads(image.extra_metadata)
            except json.JSONDecodeError:
                metadata = {}
        
        active_prompt = metadata.get("active_prompt", {})
        result["prompt"] = active_prompt.get("positive_text")
        result["negative_prompt"] = active_prompt.get("negative_text")
        result["source"] = "database"
        
        # Use generation_params if available (ALL non-bypassed node params)
        # Fall back to job.input_params for legacy images
        gen_params = metadata.get("generation_params")
        if gen_params and isinstance(gen_params, dict):
            # Filter only primitives for display, but include ALL params
            result["parameters"] = {
                k: v for k, v in gen_params.items() 
                if v is not None and not isinstance(v, (dict, list))
            }
        else:
            # Legacy fallback: get params from job.input_params
            job = session.get(Job, image.job_id) if image.job_id else None
            if job and job.input_params:
                params = job.input_params if isinstance(job.input_params, dict) else {}
                # For legacy: include all primitive params
                result["parameters"] = {
                    k: v for k, v in params.items() 
                    if v is not None and not isinstance(v, (dict, list)) and not k.startswith("__")
                }
    
    return result
