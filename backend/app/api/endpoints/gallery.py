import hashlib
import io
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response, StreamingResponse

from PIL import Image as PILImage, ExifTags, ImageOps
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import text
from sqlmodel import Session, func, or_, select
from sqlalchemy.orm import defer

from app.db.database import get_session
from app.models.engine import Engine
from app.models.image import Image, ImageRead
from app.models.job import Job
from app.models.project import Project
from app.models.prompt import Prompt
from app.models.workflow import WorkflowTemplate
from app.core.config import settings
from app.services.gallery.constants import (
    THUMBNAIL_DEFAULT_PX,
    THUMBNAIL_MAX_PX,
    THUMBNAIL_MIN_PX,
    VIDEO_EXTENSIONS,
)
from app.services.gallery.metadata import (
    _ahash_for_image_path,
    _ahash_for_thumbnail_bytes,
    _build_resync_extra_metadata,
    _coerce_json_dict,
    _decode_xp_comment,
    _extract_metadata_from_file,
    _extract_prompts_from_comment_blob,
    _extract_prompts_from_param_dict,
    _merge_resync_extra_metadata,
    _safe_int,
)
from app.services.gallery.paths import (
    _guess_media_type,
    _is_skipped_media_path,
    _log_resolution_failure,
    _normalize_fs_path,
    _resolve_media_path,
)
from app.services.gallery.search import (
    _build_search_block,
    _fts_available,
    _fts_query,
    _score_search_match,
    build_search_text_from_image,
    update_gallery_fts,
)
from app.services.gallery.thumbnails import (
    _build_placeholder_svg,
    _create_image_thumbnail_bytes,
    _create_inline_thumbnail,
    _create_video_poster_bytes,
    _maybe_prune_thumbnail_cache,
    _purge_thumbnail_cache_for_path,
    _thumbnail_cache_dir,
)
from app.services.media_paths import build_project_path_index
from app.services.media_sync import maybe_resync_media_index
from app.api.endpoints.projects import refresh_project_stats

router = APIRouter()
logger = logging.getLogger(__name__)

class GalleryItem(BaseModel):
    image: ImageRead
    job_params: Dict[str, Any]
    prompt: Optional[str] = None
    negative_prompt: Optional[str] = None
    prompt_history: List[Dict[str, Any]] = Field(default_factory=list)
    workflow_template_id: Optional[int] = None
    workflow_name: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    created_at: datetime
    caption: Optional[str] = None
    prompt_tags: List[str] = Field(default_factory=list)
    prompt_name: Optional[str] = None
    engine_id: Optional[int] = None
    collection_id: Optional[int] = None
    project_id: Optional[int] = None


def _log_context(request: Optional[Request], **extra: Any) -> Dict[str, Any]:
    context = {
        "path": request.url.path if request else None,
        "method": request.method if request else None,
        "client": request.client.host if request and request.client else None,
    }
    context.update({k: v for k, v in extra.items() if v is not None})
    return context


def _attach_job_prompt_rehydration(
    result: Dict[str, Any],
    session: Session,
    *,
    path: str,
    actual_path: Optional[str],
) -> None:
    if not isinstance(result, dict):
        return

    params = result.get("parameters")
    if not isinstance(params, dict):
        params = {}
        result["parameters"] = params

    needs_workflow = "workflow_template_id" not in params
    needs_rehydration = "__st_prompt_rehydration" not in params
    if not (needs_workflow or needs_rehydration):
        return

    image = session.exec(
        select(Image).where(Image.path == path).order_by(Image.created_at.desc())
    ).first()
    if not image and actual_path and actual_path != path:
        image = session.exec(
            select(Image).where(Image.path == actual_path).order_by(Image.created_at.desc())
        ).first()
    if not image or not image.job_id:
        return

    job = session.get(Job, image.job_id)
    if not job:
        return

    if needs_workflow and job.workflow_template_id:
        params["workflow_template_id"] = job.workflow_template_id

    if needs_rehydration and job.input_params:
        job_params = job.input_params
        if isinstance(job_params, str):
            try:
                job_params = json.loads(job_params)
            except json.JSONDecodeError:
                job_params = {}
        if isinstance(job_params, dict):
            rehydration = job_params.get("__st_prompt_rehydration")
            if rehydration:
                params["__st_prompt_rehydration"] = rehydration

@router.get("/", response_model=List[GalleryItem])
def read_gallery(
    request: Request,
    skip: int = Query(0, ge=0),
    limit: Optional[int] = Query(None, ge=1, description="Max items to return. If omitted, returns all."),
    search: Optional[str] = Query(None, description="Search by prompt text, tags, or caption"),
    include_thumbnails: bool = Query(True, description="Include inline thumbnail bytes"),
    include_params: bool = Query(True, description="Include job params and prompt history in response"),
    kept_only: bool = Query(False),
    collection_id: Optional[int] = Query(None),
    project_id: Optional[int] = Query(None),
    folder: Optional[str] = Query(None, description="Filter by folder name in image path"),
    unassigned_only: bool = Query(False, description="Return only images with no project assignment"),
    session: Session = Depends(get_session),
):
    maybe_resync_media_index(session)
    # When limit is None, fetch all; when searching or folder filtering, fetch more to allow scoring/filtering
    fetch_limit = None
    if limit is not None:
        if search:
            fetch_limit = limit * 5
        elif folder:
            # Folder filter needs more candidates since LIKE may match folder name elsewhere in path
            fetch_limit = limit * 10
        else:
            fetch_limit = limit
    
    stmt = (
        select(Image, Job, Prompt, WorkflowTemplate)
        .join(Job, Image.job_id == Job.id, isouter=True)
        .join(Prompt, Job.prompt_id == Prompt.id, isouter=True)
        .join(WorkflowTemplate, Job.workflow_template_id == WorkflowTemplate.id, isouter=True)
        .where(Image.is_deleted == False)  # Exclude soft-deleted images
        .order_by(Image.created_at.desc())
        .offset(skip)
    )
    if not include_thumbnails:
        stmt = stmt.options(defer(Image.thumbnail_data))
    if fetch_limit is not None:
        stmt = stmt.limit(fetch_limit)

    if kept_only:
        stmt = stmt.where(Image.is_kept == True)

    if collection_id is not None:
        stmt = stmt.where(Image.collection_id == collection_id)

    if project_id is not None:
        stmt = stmt.where(or_(Job.project_id == project_id, Job.project_id == None))
    elif unassigned_only:
        stmt = stmt.where(Job.project_id == None)

    # Filter by folder at SQL level (before LIMIT) - match parent directory in path
    # Pattern: %/foldername/filename or %\foldername\filename
    if folder:
        folder_pattern_forward = f"%/{folder}/%"
        folder_pattern_back = f"%\\{folder}\\%"
        stmt = stmt.where(
            or_(
                Image.path.like(folder_pattern_forward),
                Image.path.like(folder_pattern_back),
            )
        )

    if search:
        fts_used = False
        if _fts_available(session):
            fts_query = _fts_query(search)
            if fts_query:
                try:
                    rows = session.exec(
                        text("SELECT image_id FROM gallery_fts WHERE gallery_fts MATCH :query"),
                        {"query": fts_query},
                    ).all()
                    fts_ids = [row[0] for row in rows if row and row[0] is not None]
                    if fts_ids:
                        stmt = stmt.where(Image.id.in_(fts_ids))
                        fts_used = True
                except Exception:
                    fts_used = False

        if not fts_used:
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

    engines = session.exec(select(Engine)).all()
    projects = session.exec(select(Project)).all()
    path_index = build_project_path_index(engines=engines, projects=projects)

    scored_items: List[tuple[float, GalleryItem]] = []
    missing_ids: List[int] = []
    for img, job, prompt, workflow in results:
        # Always verify file existence on disk - cached file_exists may be stale
        # (e.g., file deleted via filesystem or by delete_folder_images before soft-delete fix)
        file_exists = False
        if img.path and isinstance(img.path, str):
            file_exists = os.path.exists(img.path)
            # Update cache if changed
            if img.file_exists != file_exists:
                img.file_exists = file_exists
                session.add(img)
        if not file_exists:
            img.is_deleted = True
            img.deleted_at = datetime.utcnow()
            session.add(img)
            missing_ids.append(img.id)
            continue
        
        # Exact parent folder validation (LIKE pattern may match folder name elsewhere in path)
        if folder and img.path:
            path_normalized = img.path.replace("\\", "/")
            path_segments = path_normalized.split("/")
            if len(path_segments) >= 2:
                parent_folder = path_segments[-2]
                if parent_folder.lower() != folder.lower():
                    continue
            else:
                continue
        
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
        if not isinstance(prompt_text, str) or not prompt_text.strip():
            prompt_text = None
        else:
            prompt_text = prompt_text.strip()

        negative_prompt = params.get("negative_prompt") if isinstance(params, dict) else None
        if not isinstance(negative_prompt, str) or not negative_prompt.strip():
            negative_prompt = None
        else:
            negative_prompt = negative_prompt.strip()

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
            if include_params:
                raw_history = metadata.get("prompt_history", [])
                if isinstance(raw_history, list):
                    history = [entry for entry in raw_history if isinstance(entry, dict)]

            active_prompt = metadata.get("active_prompt")
            if isinstance(active_prompt, dict):
                prompt_text = active_prompt.get("positive_text", prompt_text)
                negative_prompt = active_prompt.get("negative_text", negative_prompt)

            if not isinstance(prompt_text, str) or not prompt_text.strip():
                prompt_text = None
            else:
                prompt_text = prompt_text.strip()

            if not isinstance(negative_prompt, str) or not negative_prompt.strip():
                negative_prompt = None
            else:
                negative_prompt = negative_prompt.strip()

            # If still missing, infer from stored generation params (ComfyUI workflows often store
            # prompts under keys like CLIPTextEncode.text / CLIPTextEncode_2.text).
            if not prompt_text or not negative_prompt:
                gen_params = metadata.get("generation_params")
                if isinstance(gen_params, dict):
                    inferred_pos, inferred_neg = _extract_prompts_from_param_dict(gen_params)
                    if not prompt_text and inferred_pos:
                        prompt_text = inferred_pos
                    if not negative_prompt and inferred_neg:
                        negative_prompt = inferred_neg

                # Final fallback: infer from job params too (supports non-standard key names).
                inferred_pos, inferred_neg = _extract_prompts_from_param_dict(params)
                if not prompt_text and inferred_pos:
                    prompt_text = inferred_pos
                if not negative_prompt and inferred_neg:
                    negative_prompt = inferred_neg

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

        job_project_id = job.project_id if job else None
        path_project_id = path_index.match_project_id(img.path) if img.path else None
        if path_project_id is not None:
            resolved_project_id = path_project_id
        elif not path_index.roots:
            resolved_project_id = job_project_id
        else:
            # Fall back to job_project_id when path matching fails
            resolved_project_id = job_project_id

        if project_id is not None:
            if resolved_project_id != project_id:
                continue
        elif unassigned_only:
            if resolved_project_id is not None:
                continue

        image_payload: Dict[str, Any] = {
            "id": img.id,
            "job_id": img.job_id,
            "path": img.path,
            "filename": img.filename,
            "format": img.format,
            "thumbnail_path": img.thumbnail_path,
            "thumbnail_data": img.thumbnail_data if include_thumbnails else None,
            "is_kept": img.is_kept,
            "is_deleted": img.is_deleted,
            "deleted_at": img.deleted_at,
            "caption": img.caption,
            "collection_id": img.collection_id,
            "extra_metadata": img.extra_metadata,
            "created_at": img.created_at,
        }

        # Get image dimensions (prefer stored values, fallback to job params)
        img_width = img.width
        img_height = img.height
        if isinstance(params, dict):
            if not img_width:
                img_width = params.get("width") or params.get("empty_latent_width")
            if not img_height:
                img_height = params.get("height") or params.get("empty_latent_height")
        if img.width is None and img_width:
            img.width = img_width
            session.add(img)
        if img.height is None and img_height:
            img.height = img_height
            session.add(img)

        item = GalleryItem(
            image=image_payload,
            job_params=params if include_params and isinstance(params, dict) else {},
            prompt=prompt_text,
            negative_prompt=negative_prompt,
            prompt_history=history if include_params else [],
            workflow_template_id=job.workflow_template_id if job else None,
            workflow_name=workflow.name if workflow else None,
            width=img_width,
            height=img_height,
            created_at=img.created_at,
            caption=caption,
            prompt_tags=prompt_tags,
            prompt_name=prompt.name if prompt else None,
            engine_id=job.engine_id if job else None,
            collection_id=img.collection_id,
            project_id=resolved_project_id,
        )
        scored_items.append((score, item))

    if missing_ids:
        try:
            session.commit()
            logger.info(
                "Soft-deleted missing gallery files",
                extra=_log_context(request, missing_count=len(missing_ids)),
            )
        except SQLAlchemyError:
            session.rollback()
            logger.exception(
                "Failed to soft-delete missing gallery files",
                extra=_log_context(request, missing_count=len(missing_ids)),
            )

    if search:
        scored_items.sort(key=lambda r: (r[0], r[1].created_at), reverse=True)
        if limit is not None:
            return [item for _, item in scored_items[:limit]]
        return [item for _, item in scored_items]

    if limit is not None:
        return [item for _, item in scored_items[:limit]]
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
    project_id: Optional[int] = None  # Scope cleanup to a specific project
    folder: Optional[str] = None  # Scope cleanup to a specific folder within the project
    keep_image_ids: Optional[List[int]] = None  # If provided, delete everything in-scope except these IDs


class BulkDeleteRequest(BaseModel):
    image_ids: List[int]


class BulkDeleteResult(BaseModel):
    deleted: int
    not_found: List[int]
    file_errors: List[int]


def _bulk_soft_delete(image_ids: List[int], session: Session) -> BulkDeleteResult:
    """Best-effort soft delete of images: moves files to .trash folder for potential restoration."""
    if not image_ids:
        return BulkDeleteResult(deleted=0, not_found=[], file_errors=[])

    images = session.exec(select(Image).where(Image.id.in_(image_ids))).all()
    images_by_id = {img.id: img for img in images}

    not_found = [img_id for img_id in image_ids if img_id not in images_by_id]
    file_errors: List[int] = []
    deleted_count = 0
    now = datetime.utcnow()
    timestamp = now.strftime("%Y%m%d_%H%M%S")
    
    # Track affected projects for cache refresh
    affected_job_ids = set(img.job_id for img in images if img.job_id)

    for img_id in image_ids:
        image = images_by_id.get(img_id)
        if not image:
            continue

        # Move files to .trash folder (best-effort)
        try:
            if image.path and isinstance(image.path, str) and os.path.exists(image.path):
                # Purge any cached thumbnails for this image before deletion
                _purge_thumbnail_cache_for_path(image.path)
                
                original_path = Path(image.path)
                trash_dir = original_path.parent / ".trash"
                trash_dir.mkdir(exist_ok=True)
                
                # Create unique trash filename: timestamp_imageId_originalFilename
                trash_filename = f"{timestamp}_{img_id}_{original_path.name}"
                trash_path = trash_dir / trash_filename
                
                # Move file to trash
                shutil.move(str(original_path), str(trash_path))
                image.trash_path = str(trash_path)
                
                # Also move associated .json metadata file if it exists
                json_path = original_path.with_suffix(".json")
                if json_path.exists():
                    trash_json = trash_dir / f"{timestamp}_{img_id}_{json_path.name}"
                    shutil.move(str(json_path), str(trash_json))
        except OSError:
            file_errors.append(img_id)
            logger.exception("Failed to move file to trash during bulk delete", extra={"path": image.path, "image_id": img_id})

        # Soft delete in DB
        image.is_deleted = True
        image.deleted_at = now
        session.add(image)
        deleted_count += 1

    session.commit()
    
    # Refresh cached stats for affected projects
    if affected_job_ids and deleted_count > 0:
        jobs = session.exec(select(Job).where(Job.id.in_(affected_job_ids))).all()
        affected_project_ids = set(j.project_id for j in jobs if j.project_id)
        for project_id in affected_project_ids:
            try:
                refresh_project_stats(session, project_id)
            except Exception:
                logger.exception("Failed to refresh project stats", extra={"project_id": project_id})
        if affected_project_ids:
            try:
                session.commit()
            except Exception:
                session.rollback()
    
    return BulkDeleteResult(deleted=deleted_count, not_found=not_found, file_errors=file_errors)


@router.post("/bulk_delete", response_model=BulkDeleteResult)
def bulk_delete_images(req: BulkDeleteRequest, session: Session = Depends(get_session)):
    """
    Delete many images in a single transaction to avoid dozens of concurrent DELETE calls
    (which can exhaust workers and lock SQLite). Performs soft-delete in the DB and moves
    files to .trash folder for potential restoration.
    """
    try:
        return _bulk_soft_delete(req.image_ids, session)
    except SQLAlchemyError:
        logger.exception("Bulk delete failed at DB layer")
        raise HTTPException(status_code=500, detail="Failed to delete images")


class RestoreRequest(BaseModel):
    image_ids: List[int]


class RestoreResult(BaseModel):
    restored: int
    not_found: List[int]
    file_errors: List[int]


@router.post("/restore", response_model=RestoreResult)
def restore_images(req: RestoreRequest, session: Session = Depends(get_session)):
    """
    Restore soft-deleted images by moving files from .trash back to original location.
    Clears is_deleted flag and trash_path.
    """
    if not req.image_ids:
        return RestoreResult(restored=0, not_found=[], file_errors=[])
    
    # Find soft-deleted images
    images = session.exec(
        select(Image).where(Image.id.in_(req.image_ids)).where(Image.is_deleted == True)
    ).all()
    images_by_id = {img.id: img for img in images}
    
    # Track affected jobs for cache refresh
    affected_job_ids = set(img.job_id for img in images if img.job_id)
    
    not_found = [img_id for img_id in req.image_ids if img_id not in images_by_id]
    file_errors: List[int] = []
    restored_count = 0
    
    for img_id in req.image_ids:
        image = images_by_id.get(img_id)
        if not image:
            continue
        
        # Move file back from trash to original location
        try:
            if image.trash_path and os.path.exists(image.trash_path):
                trash_path = Path(image.trash_path)
                original_path = Path(image.path)
                
                # Ensure parent directory exists
                original_path.parent.mkdir(parents=True, exist_ok=True)
                
                # Move file back
                shutil.move(str(trash_path), str(original_path))
                
                # Also restore .json metadata file if it exists
                # The trash json filename is: timestamp_imageId_originalname.json
                trash_json_pattern = trash_path.stem  # Gets "timestamp_imageId_originalname"
                # Find matching json in trash
                for json_file in trash_path.parent.glob("*.json"):
                    if json_file.stem.startswith(trash_json_pattern.rsplit(".", 1)[0].rsplit("_", 1)[0]):
                        original_json = original_path.with_suffix(".json")
                        shutil.move(str(json_file), str(original_json))
                        break
        except OSError:
            file_errors.append(img_id)
            logger.exception("Failed to restore file from trash", extra={"trash_path": image.trash_path, "image_id": img_id})
            continue
        
        # Clear soft-delete flags
        image.is_deleted = False
        image.deleted_at = None
        image.trash_path = None
        session.add(image)
        restored_count += 1
    
    try:
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        logger.exception("Failed to commit image restore transaction")
        raise HTTPException(status_code=500, detail="Failed to restore images")
    
    # Refresh cached stats for affected projects
    if affected_job_ids and restored_count > 0:
        jobs = session.exec(select(Job).where(Job.id.in_(affected_job_ids))).all()
        affected_project_ids = set(j.project_id for j in jobs if j.project_id)
        for project_id in affected_project_ids:
            try:
                refresh_project_stats(session, project_id)
            except Exception:
                logger.exception("Failed to refresh project stats", extra={"project_id": project_id})
        if affected_project_ids:
            try:
                session.commit()
            except Exception:
                session.rollback()
    
    return RestoreResult(restored=restored_count, not_found=not_found, file_errors=file_errors)


class MoveImagesRequest(BaseModel):
    image_ids: List[int]
    project_id: int
    subfolder: Optional[str] = None  # e.g., "transform", "output"; defaults to "output"


class MoveImagesResult(BaseModel):
    moved: int
    failed: List[int]
    new_paths: Dict[int, str]  # image_id -> new path


def _get_next_image_number(directory: Path, prefix: str = "") -> int:
    """
    Find the highest numeric suffix in existing images and return next number.
    
    Looks for files matching the pattern: {prefix}{number}.ext
    For example, with prefix='project-output-', finds 'project-output-0050.png' -> returns 51
    """
    if not directory.exists():
        return 1
    
    max_num = 0
    
    # Pattern to extract the numeric suffix from filenames
    # Matches: prefix + digits at the end of the stem
    if prefix:
        # Escape special regex characters in prefix
        escaped_prefix = re.escape(prefix)
        pattern = re.compile(rf"^{escaped_prefix}(\d+)$")
    else:
        # Fallback: just find trailing digits
        pattern = re.compile(r"(\d+)$")
    
    for ext in [".png", ".jpg", ".jpeg", ".webp"]:
        for f in directory.glob(f"*{ext}"):
            match = pattern.match(f.stem) if prefix else pattern.search(f.stem)
            if match:
                num = int(match.group(1))
                max_num = max(max_num, num)
    
    return max_num + 1


def _matches_naming_convention(filename: str) -> bool:
    """
    Check if a filename matches Sweet Tea's naming convention.
    
    Standard format: {project-slug}-{subfolder}-{NNNN}.ext
    Examples: myproject-output-0051.png, photos-transform-0001.jpg
    
    Returns True if the filename matches this pattern, False otherwise.
    Files like 'myimage.jpg' or 'photo.png' will return False.
    """
    stem = Path(filename).stem
    # Pattern: word-word-digits (at least one digit at the end after two dashes)
    pattern = re.compile(r"^[\w]+-[\w]+-\d+$")
    return bool(pattern.match(stem))


def _clone_job(session: Session, job: Job, target_project_id: int) -> Job:
    """
    Clone a job record to support splitting a batch.
    
    Used when multiple images belong to one job but only a subset are being moved
    to a different project. The moved images will point to this new job.
    """
    new_job = Job(
        engine_id=job.engine_id,
        workflow_template_id=job.workflow_template_id,
        status=job.status,
        input_params=job.input_params,
        prompt_id=job.prompt_id,
        comfy_prompt_id=job.comfy_prompt_id,
        title=job.title,
        project_id=target_project_id,
        output_dir=job.output_dir,
        input_dir=job.input_dir,
        mask_dir=job.mask_dir,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        error=job.error,
    )
    session.add(new_job)
    session.flush()  # Ensure we get an ID
    return new_job



@router.post("/move", response_model=MoveImagesResult)
def move_images(req: MoveImagesRequest, session: Session = Depends(get_session)):
    """
    Move images from one project (typically drafts) to another project.
    
    Files are renamed to match the standard naming convention with incrementing
    sequence numbers (e.g., 0051.png, 0052.png) based on existing images in the
    destination folder.
    
    Both the physical files and database records are updated.
    """
    if not req.image_ids:
        return MoveImagesResult(moved=0, failed=[], new_paths={})
    
    # Load target project
    project = session.get(Project, req.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Target project not found")
    
    # Get engine for determining output directory
    engine = session.exec(select(Engine).where(Engine.is_active == True)).first()
    if not engine:
        engine = session.exec(select(Engine)).first()
    
    if not engine:
        raise HTTPException(status_code=500, detail="No engine configured")
    
    # Determine destination directory - all outputs go to ComfyUI/input/<project>/<subfolder>
    subfolder = req.subfolder or "output"
    
    if engine.input_dir:
        # Preferred: use input_dir/<project>/<subfolder>
        dest_dir = Path(engine.input_dir) / project.slug / subfolder
    elif engine.output_dir:
        # Fallback: derive input dir from output_dir (ComfyUI/output -> ComfyUI/input)
        output_path = Path(engine.output_dir)
        if output_path.name in ("output", "input"):
            comfy_root = output_path.parent
        else:
            comfy_root = output_path
        dest_dir = comfy_root / "input" / project.slug / subfolder
    else:
        raise HTTPException(status_code=500, detail="No input or output directory configured")
    
    dest_dir.mkdir(parents=True, exist_ok=True)
    
    # Build filename prefix: project-subfolder- (e.g., 'myproject-output-')
    filename_prefix = f"{project.slug}-{subfolder}-"
    
    # Get starting sequence number based on existing files
    next_num = _get_next_image_number(dest_dir, filename_prefix)
    
    # Load images
    images = session.exec(
        select(Image).where(Image.id.in_(req.image_ids)).where(Image.is_deleted == False)
    ).all()
    images_by_id = {img.id: img for img in images}
    
    moved = 0
    failed: List[int] = []
    new_paths: Dict[int, str] = {}
    
    # --- Job Splitting Logic ---
    # Determine which jobs need to be moved or split
    # 1. Identify all jobs involved
    job_ids = set(img.job_id for img in images if img.job_id)
    
    # Map original job_id -> target job_id (either moved original or new clone)
    job_mapping: Dict[int, int] = {}
    
    for jid in job_ids:
        job = session.get(Job, jid)
        if not job:
            continue
            
        # Only process if the job isn't already in the target project
        if job.project_id != req.project_id:
            # Count total active images in this job
            total_images_count = session.exec(
                select(func.count(Image.id))
                .where(Image.job_id == jid)
                .where(Image.is_deleted == False)
            ).one()
            
            # Count how many of these are being moved
            moving_count = sum(1 for img in images if img.job_id == jid)
            
            if total_images_count == moving_count:
                # Case 1: All images are moving. Move the job itself.
                job.project_id = req.project_id
                session.add(job)
                job_mapping[jid] = job.id
            else:
                # Case 2: Only some images are moving. Split the job.
                new_job = _clone_job(session, job, req.project_id)
                job_mapping[jid] = new_job.id
    
    for img_id in req.image_ids:
        image = images_by_id.get(img_id)
        if not image:
            failed.append(img_id)
            continue
        
        try:
            old_path = Path(image.path) if image.path else None
            if not old_path or not old_path.exists():
                logger.warning("Image file not found during move", extra={"image_id": img_id, "path": image.path})
                failed.append(img_id)
                continue
            
            # Determine file extension
            ext = old_path.suffix.lower() or ".png"
            
            # Only rename if file already follows the naming convention
            old_filename = old_path.name
            if _matches_naming_convention(old_filename):
                # Generate new filename: project-subfolder-0051.ext
                new_filename = f"{filename_prefix}{next_num:04d}{ext}"
                next_num += 1
            else:
                # Keep original filename, but ensure uniqueness
                new_filename = old_filename
                # Handle collision by appending _1, _2, etc.
                candidate = dest_dir / new_filename
                counter = 1
                while candidate.exists():
                    stem = old_path.stem
                    new_filename = f"{stem}_{counter}{ext}"
                    candidate = dest_dir / new_filename
                    counter += 1
            
            new_path = dest_dir / new_filename
            
            # Move the file
            shutil.move(str(old_path), str(new_path))
            
            # Also move associated .json metadata file if it exists
            old_json = old_path.with_suffix(".json")
            if old_json.exists():
                new_json = new_path.with_suffix(".json")
                shutil.move(str(old_json), str(new_json))
            
            # Update database record
            image.path = str(new_path)
            image.filename = new_filename
            session.add(image)
            
            # Update associated job to the mapped job (either moved or split)
            if image.job_id and image.job_id in job_mapping:
                image.job_id = job_mapping[image.job_id]
            
            new_paths[img_id] = str(new_path)
            moved += 1
            
        except Exception as e:
            logger.exception("Failed to move image", extra={"image_id": img_id, "error": str(e)})
            failed.append(img_id)
    
    try:
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        logger.exception("Failed to commit image move transaction")
        raise HTTPException(status_code=500, detail="Failed to save moved images")
    
    # Refresh cached stats for affected projects (source and destination)
    if moved > 0:
        # Collect source project_ids from original jobs
        source_project_ids: set[int] = set()
        for jid in job_ids:
            job = session.get(Job, jid)
            if job and job.project_id and job.project_id != req.project_id:
                source_project_ids.add(job.project_id)
        
        # Refresh stats for all affected projects
        all_affected_projects = source_project_ids | {req.project_id}
        for project_id in all_affected_projects:
            try:
                refresh_project_stats(session, project_id)
            except Exception:
                logger.exception("Failed to refresh project stats", extra={"project_id": project_id})
        try:
            session.commit()
        except Exception:
            session.rollback()
    
    logger.info(
        "Moved images to project",
        extra={
            "project_id": req.project_id,
            "project_slug": project.slug,
            "moved": moved,
            "failed": len(failed),
        }
    )
    
    return MoveImagesResult(moved=moved, failed=failed, new_paths=new_paths)


@router.post("/cleanup")
def cleanup_images(req: CleanupRequest, session: Session = Depends(get_session)):
    """
    Delete all non-kept images, optionally scoped to a specific project and/or folder.
    
    IMPORTANT: If project_id or folder is specified, cleanup is SCOPED to only those images.
    This prevents accidental deletion of images from unrelated projects.
    """
    # Start with base query - keep job join so orphaned images can be path-matched.
    query = (
        select(Image, Job)
        .join(Job, Image.job_id == Job.id, isouter=True)
        .where(Image.is_deleted == False)
    )
    # Backwards compatible behavior: when keep_image_ids is omitted, only delete non-kept images.
    # When keep_image_ids is provided (even an empty list), delete everything in-scope except the provided IDs.
    if req.keep_image_ids is None:
        query = query.where(Image.is_kept == False)

    path_index = None
    if req.project_id is not None:
        query = query.where(or_(Job.project_id == req.project_id, Job.project_id == None))
        project = session.get(Project, req.project_id)
        if project:
            engines = session.exec(select(Engine)).all()
            path_index = build_project_path_index(engines=engines, projects=[project])
    
    if req.job_id:
        query = query.where(Image.job_id == req.job_id)

    # Execute query and filter by folder/project in Python (path-based, not DB column)
    rows = session.exec(query).all()
    images_to_delete: List[Image] = []
    for img, job in rows:
        if req.project_id is None:
            images_to_delete.append(img)
            continue

        path_project_id = path_index.match_project_id(img.path) if path_index and img.path else None
        if path_project_id is not None:
            resolved_project_id = path_project_id
        elif not path_index or not path_index.roots:
            resolved_project_id = job.project_id if job else None
        else:
            resolved_project_id = job.project_id if job else None

        if resolved_project_id == req.project_id:
            images_to_delete.append(img)
    
    # If folder is specified, further filter images by exact parent folder match
    if req.folder:
        filtered_images = []
        for img in images_to_delete:
            if img.path:
                path_normalized = img.path.replace("\\", "/")
                path_segments = path_normalized.split("/")
                if len(path_segments) >= 2:
                    parent_folder = path_segments[-2]
                    if parent_folder.lower() == req.folder.lower():
                        filtered_images.append(img)
        images_to_delete = filtered_images
        logger.info(
            f"Cleanup scoped to project_id={req.project_id}, folder='{req.folder}': {len(images_to_delete)} images to delete"
        )

    if req.keep_image_ids is not None:
        keep_set = {int(img_id) for img_id in (req.keep_image_ids or []) if img_id is not None}
        if keep_set:
            images_to_delete = [img for img in images_to_delete if img.id not in keep_set]

    count = 0
    deleted_files = 0
    file_errors: List[int] = []
    now = datetime.utcnow()
    for img in images_to_delete:
        if not img or not img.id:
            continue

        file_deleted_or_missing = False
        if img.path and isinstance(img.path, str) and os.path.exists(img.path):
            try:
                _purge_thumbnail_cache_for_path(img.path)
                os.remove(img.path)
                deleted_files += 1
                file_deleted_or_missing = True

                # Also delete associated .json metadata file if it exists
                json_path = os.path.splitext(img.path)[0] + ".json"
                if os.path.exists(json_path):
                    os.remove(json_path)
            except OSError:
                # If we can't delete the file, don't soft-delete the DB record; otherwise
                # read_gallery's auto-resync may revive it on refresh.
                logger.exception("Failed to delete file", extra={"path": img.path, "image_id": img.id})
                try:
                    if os.path.exists(img.path):
                        file_errors.append(int(img.id))
                        continue
                    file_deleted_or_missing = True
                except Exception:
                    file_errors.append(int(img.id))
                    continue
        else:
            # File already missing; keep DB consistent by soft-deleting the record.
            file_deleted_or_missing = True

        if not file_deleted_or_missing:
            continue

        # Soft delete: set flag instead of removing from DB
        img.is_deleted = True
        img.deleted_at = now
        img.file_exists = False
        session.add(img)
        count += 1

    try:
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        logger.exception("Failed to commit cleanup transaction")
        raise HTTPException(status_code=500, detail="Failed to cleanup gallery")

    return {
        "status": "cleaned",
        "count": count,
        "files_deleted": deleted_files,
        "file_errors": file_errors,
        "soft_delete": True,
    }


class ResyncResult(BaseModel):
    """Result of resync operation."""
    found: int
    already_in_db: int
    imported: int
    updated: int
    relinked: int
    errors: int
    scanned_folders: List[str]


@router.post("/resync", response_model=ResyncResult)
def resync_images_from_disk(session: Session = Depends(get_session)):
    """
    Scan project directories for images that exist on disk but are missing from the database.
    
    This is useful after database rollback or corruption recovery when files exist
    on disk but their database entries were lost.
    
    Scans all project directories under the configured sweet_tea output paths.
    """
    from pathlib import Path as PathlibPath

    IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"}
    MEDIA_EXTENSIONS = set(IMAGE_EXTENSIONS) | set(VIDEO_EXTENSIONS)
    MIN_IMAGE_BYTES = 10 * 1024

    engines = session.exec(select(Engine)).all()
    projects = session.exec(select(Project)).all()
    project_slugs = [p.slug for p in projects if getattr(p, "slug", None)]

    scanned_folders: List[str] = []
    roots_to_scan: List[PathlibPath] = []
    seen_roots: set[str] = set()

    def add_root(root: PathlibPath) -> None:
        try:
            if not root or not root.exists():
                return
        except Exception:
            return

        normalized = _normalize_fs_path(str(root))
        if not normalized or normalized in seen_roots:
            return
        seen_roots.add(normalized)
        roots_to_scan.append(root)
        scanned_folders.append(str(root))

    for eng in engines:
        slugs_for_engine: set[str] = {slug for slug in project_slugs if slug}
        if eng.output_dir:
            sweet_tea_dir = settings.get_sweet_tea_dir_from_engine_path(eng.output_dir)
            add_root(sweet_tea_dir)
            try:
                if sweet_tea_dir and sweet_tea_dir.exists():
                    for child in sweet_tea_dir.iterdir():
                        if child.is_dir() and child.name:
                            slugs_for_engine.add(child.name)
            except Exception:
                pass

        # Discover project slugs from input_dir too (new structure: input/<project>/<subfolder>)
        if eng.input_dir:
            base = PathlibPath(eng.input_dir)
            try:
                if base.exists():
                    for child in base.iterdir():
                        if child.is_dir() and child.name:
                            slugs_for_engine.add(child.name)
            except Exception:
                pass

        # Scan project-specific subtrees under input_dir
        if eng.input_dir and slugs_for_engine:
            base = PathlibPath(eng.input_dir)
            for slug in sorted(slugs_for_engine):
                add_root(base / slug)

    if not roots_to_scan:
        return ResyncResult(
            found=0,
            already_in_db=0,
            imported=0,
            updated=0,
            relinked=0,
            errors=0,
            scanned_folders=[],
        )

    existing_by_norm_path: Dict[str, List[int]] = {}
    try:
        existing_rows = session.exec(select(Image.id, Image.path)).all()
        for row in existing_rows:
            try:
                image_id, image_path = row
            except Exception:
                continue
            if not image_id or not image_path:
                continue
            key = _normalize_fs_path(str(image_path))
            if not key:
                continue
            existing_by_norm_path.setdefault(key, []).append(int(image_id))
    except Exception:
        existing_by_norm_path = {}

    # Build a rename/move index for missing images, keyed by thumbnail aHash.
    missing_by_ahash: Dict[str, List[Dict[str, Any]]] = {}
    try:
        candidates = session.exec(
            select(Image)
            .where(Image.trash_path == None)  # noqa: E711
            .where(or_(Image.file_exists == False, Image.is_deleted == True))  # noqa: E712
        ).all()
        for img in candidates:
            if not img or not img.id or not img.path:
                continue
            if os.path.exists(img.path):
                continue
            if not img.thumbnail_data:
                continue
            ahash = _ahash_for_thumbnail_bytes(img.thumbnail_data)
            if not ahash:
                continue
            missing_by_ahash.setdefault(ahash, []).append(
                {"id": img.id, "job_id": img.job_id, "width": img.width, "height": img.height}
            )
    except Exception:
        missing_by_ahash = {}

    def iter_media_files(root: PathlibPath):
        skip_dir_names = {".trash", ".cache", ".thumbnails", "thumbnails", "__pycache__", "masks", "mask"}
        for dirpath, dirnames, filenames in os.walk(root):
            # Prune directory traversal early
            try:
                dirnames[:] = [d for d in dirnames if d and d.lower() not in skip_dir_names]
            except Exception:
                pass

            for filename in filenames:
                try:
                    candidate = PathlibPath(dirpath) / filename
                    if not candidate.is_file():
                        continue
                    if candidate.suffix.lower() not in MEDIA_EXTENSIONS:
                        continue
                    if _is_skipped_media_path(Path(str(candidate))):
                        continue

                    # Skip very small images (likely thumbnails or cache artifacts)
                    if candidate.suffix.lower() not in VIDEO_EXTENSIONS:
                        try:
                            if candidate.stat().st_size < MIN_IMAGE_BYTES:
                                continue
                        except Exception:
                            continue

                    yield candidate
                except Exception:
                    continue

    found = 0
    already_in_db = 0
    imported = 0
    updated = 0
    relinked = 0
    errors = 0
    fts_enabled = _fts_available(session)

    for root in roots_to_scan:
        for media_path in iter_media_files(root):
            found += 1

            try:
                path_str = str(media_path)
                norm_path = _normalize_fs_path(path_str)
                file_ext = media_path.suffix.lower().lstrip(".")
                if file_ext == "jpeg":
                    file_ext = "jpg"

                try:
                    mtime = datetime.fromtimestamp(media_path.stat().st_mtime)
                except Exception:
                    mtime = datetime.utcnow()

                # If already present by path, optionally backfill metadata/thumbnails/flags.
                if norm_path in existing_by_norm_path:
                    already_in_db += 1
                    for image_id in existing_by_norm_path.get(norm_path, []):
                        img = session.get(Image, image_id)
                        if not img:
                            continue

                        record_changed = False

                        if img.path != path_str:
                            img.path = path_str
                            record_changed = True
                        if img.filename != media_path.name:
                            img.filename = media_path.name
                            record_changed = True
                        if img.format != file_ext:
                            img.format = file_ext
                            record_changed = True

                        if img.file_exists is not True:
                            img.file_exists = True
                            record_changed = True

                        # If this was auto-soft-deleted due to missing file, revive it.
                        if img.is_deleted and not img.trash_path:
                            img.is_deleted = False
                            img.deleted_at = None
                            record_changed = True

                        file_metadata: Optional[Dict[str, Any]] = None
                        meta_dict = _coerce_json_dict(img.extra_metadata)
                        active_prompt = meta_dict.get("active_prompt")
                        gen_params = meta_dict.get("generation_params")
                        needs_meta_backfill = (
                            not isinstance(active_prompt, dict)
                            or (isinstance(active_prompt, dict) and not active_prompt.get("positive_text") and not active_prompt.get("negative_text"))
                            or not isinstance(gen_params, dict)
                            or (isinstance(gen_params, dict) and not gen_params)
                            or any(k in meta_dict for k in ("positive_prompt", "negative_prompt", "params"))
                        )
                        if img.thumbnail_data is None or img.width is None or img.height is None or needs_meta_backfill:
                            file_metadata = _extract_metadata_from_file(path_str)

                        # Backfill thumbnails/dimensions for images (videos rely on path-thumbnail endpoint).
                        if media_path.suffix.lower() not in VIDEO_EXTENSIONS:
                            if img.thumbnail_data is None or img.width is None or img.height is None:
                                thumb_data, w, h = _create_inline_thumbnail(path_str)
                                if thumb_data and img.thumbnail_data is None:
                                    img.thumbnail_data = thumb_data
                                    record_changed = True
                                if w and img.width is None:
                                    img.width = w
                                    record_changed = True
                                if h and img.height is None:
                                    img.height = h
                                    record_changed = True

                        merged_meta, meta_changed = _merge_resync_extra_metadata(
                            img.extra_metadata, file_metadata=file_metadata, mtime=mtime
                        )
                        if meta_changed and merged_meta is not None:
                            img.extra_metadata = merged_meta
                            record_changed = True

                        if record_changed:
                            session.add(img)
                            updated += 1
                            if fts_enabled and img.id:
                                search_text = build_search_text_from_image(img)
                                update_gallery_fts(session, img.id, search_text)

                    continue

                # Not found by path. Try to relink renamed/moved files via thumbnail hash.
                file_metadata = _extract_metadata_from_file(path_str)
                job_id_hint = None
                if file_metadata and isinstance(file_metadata.get("parameters"), dict):
                    job_id_hint = _safe_int(file_metadata["parameters"].get("job_id"))

                relink_match: Optional[Dict[str, Any]] = None
                ahash = None
                if media_path.suffix.lower() not in VIDEO_EXTENSIONS:
                    ahash = _ahash_for_image_path(path_str)
                if ahash and ahash in missing_by_ahash:
                    candidates = list(missing_by_ahash.get(ahash) or [])
                    if job_id_hint is not None:
                        job_filtered = [c for c in candidates if c.get("job_id") == job_id_hint]
                        if job_filtered:
                            candidates = job_filtered

                    if len(candidates) > 1:
                        try:
                            with PILImage.open(path_str) as probe:
                                w, h = probe.size
                        except Exception:
                            w, h = None, None
                        if w and h:
                            wh_filtered = [
                                c
                                for c in candidates
                                if (c.get("width") in (None, w) and c.get("height") in (None, h))
                            ]
                            if wh_filtered:
                                candidates = wh_filtered

                    if len(candidates) == 1:
                        relink_match = candidates[0]

                if relink_match:
                    img = session.get(Image, relink_match["id"])
                    if img:
                        img.path = path_str
                        img.filename = media_path.name
                        img.format = file_ext
                        img.file_exists = True
                        if img.is_deleted and not img.trash_path:
                            img.is_deleted = False
                            img.deleted_at = None

                        # Backfill metadata and thumbnail if needed.
                        merged_meta, meta_changed = _merge_resync_extra_metadata(
                            img.extra_metadata, file_metadata=file_metadata, mtime=mtime
                        )
                        if meta_changed and merged_meta is not None:
                            img.extra_metadata = merged_meta

                        if media_path.suffix.lower() not in VIDEO_EXTENSIONS:
                            if img.thumbnail_data is None or img.width is None or img.height is None:
                                thumb_data, w, h = _create_inline_thumbnail(path_str)
                                if thumb_data and img.thumbnail_data is None:
                                    img.thumbnail_data = thumb_data
                                if w and img.width is None:
                                    img.width = w
                                if h and img.height is None:
                                    img.height = h

                        session.add(img)
                        updated += 1
                        relinked += 1
                        if fts_enabled and img.id:
                            search_text = build_search_text_from_image(img)
                            update_gallery_fts(session, img.id, search_text)

                        # Mark as present for the remainder of this run.
                        if norm_path:
                            existing_by_norm_path.setdefault(norm_path, []).append(img.id)

                        # Remove used candidate to avoid double matches.
                        if ahash and ahash in missing_by_ahash:
                            remaining = [c for c in missing_by_ahash.get(ahash, []) if c.get("id") != img.id]
                            if remaining:
                                missing_by_ahash[ahash] = remaining
                            else:
                                missing_by_ahash.pop(ahash, None)

                        continue

                # Import new orphaned image/video
                parameters = file_metadata.get("parameters") if isinstance(file_metadata, dict) else {}
                parameters = parameters if isinstance(parameters, dict) else {}
                source = file_metadata.get("source") if isinstance(file_metadata, dict) else "none"

                job_id_to_set = -1
                if job_id_hint is not None and session.get(Job, job_id_hint):
                    job_id_to_set = job_id_hint

                extra_metadata = _build_resync_extra_metadata(
                    prompt=file_metadata.get("prompt") if file_metadata else None,
                    negative_prompt=file_metadata.get("negative_prompt") if file_metadata else None,
                    parameters=parameters,
                    source=str(source or "none"),
                    mtime=mtime,
                    recovered=True,
                )

                thumb_data = None
                width = None
                height = None
                if media_path.suffix.lower() not in VIDEO_EXTENSIONS:
                    thumb_data, width, height = _create_inline_thumbnail(path_str)

                new_image = Image(
                    job_id=job_id_to_set,
                    path=path_str,
                    filename=media_path.name,
                    format=file_ext,
                    width=width,
                    height=height,
                    file_exists=True,
                    thumbnail_data=thumb_data,
                    created_at=mtime,
                    extra_metadata=extra_metadata,
                )
                session.add(new_image)
                session.flush()
                imported += 1

                if new_image.id:
                    existing_by_norm_path.setdefault(norm_path, []).append(new_image.id)
                    if fts_enabled:
                        search_text = build_search_text_from_image(new_image)
                        update_gallery_fts(session, new_image.id, search_text)

            except Exception as e:
                logger.exception("Error importing recovered image", extra={"path": str(media_path), "error": str(e)})
                errors += 1

    try:
        session.commit()
        logger.info(
            "Resync completed",
            extra={
                "found": found,
                "already_in_db": already_in_db,
                "imported": imported,
                "updated": updated,
                "relinked": relinked,
                "errors": errors,
                "folders": scanned_folders,
            },
        )
    except SQLAlchemyError:
        session.rollback()
        logger.exception("Failed to commit resync transaction")
        raise HTTPException(status_code=500, detail="Failed to save resynced images")

    return ResyncResult(
        found=found,
        already_in_db=already_in_db,
        imported=imported,
        updated=updated,
        relinked=relinked,
        errors=errors,
        scanned_folders=scanned_folders,
    )


# ----------------------------------------------------------------

@router.get("/image/path/thumbnail")
def serve_thumbnail_by_path(
    path: str,
    max_px: int = Query(THUMBNAIL_DEFAULT_PX, ge=THUMBNAIL_MIN_PX, le=THUMBNAIL_MAX_PX),
    session: Session = Depends(get_session),
):
    actual_path = _resolve_media_path(path, session)
    if not actual_path or not os.path.exists(actual_path):
        _log_resolution_failure(path, session)
        logger.warning("Thumbnail: Missing file", extra={"path": path})
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    ext = os.path.splitext(actual_path)[1].lower()
    is_video = ext in VIDEO_EXTENSIONS

    try:
        stat = os.stat(actual_path)
        cache_key = f"{actual_path}:{stat.st_mtime_ns}:{stat.st_size}:{max_px}:{'video' if is_video else 'image'}"
    except OSError:
        cache_key = f"{actual_path}:{max_px}:{'video' if is_video else 'image'}"

    cache_dir = _thumbnail_cache_dir()
    _maybe_prune_thumbnail_cache()
    cache_name = hashlib.sha1(cache_key.encode("utf-8")).hexdigest()
    cache_path = cache_dir / f"{cache_name}.jpg"

    headers = {"Cache-Control": "public, max-age=86400, immutable"}
    fallback_headers = {"Cache-Control": "public, max-age=60"}
    if cache_path.exists():
        try:
            if cache_path.stat().st_size > 0:
                return FileResponse(str(cache_path), media_type="image/jpeg", headers=headers)
        except OSError:
            pass

    if is_video:
        thumb_bytes = _create_video_poster_bytes(actual_path, max_px)
        if not thumb_bytes:
            ffmpeg_resolved = shutil.which("ffmpeg") or getattr(settings, "FFMPEG_PATH", None)
            logger.info(
                "Thumbnail: video poster unavailable, returning placeholder",
                extra={"path": actual_path, "ffmpeg": ffmpeg_resolved},
            )
            placeholder = _build_placeholder_svg("video", max_px)
            return Response(content=placeholder, media_type="image/svg+xml", headers=fallback_headers)
    else:
        thumb_bytes = _create_image_thumbnail_bytes(actual_path, max_px)
        if not thumb_bytes:
            placeholder = _build_placeholder_svg("image", max_px)
            return Response(content=placeholder, media_type="image/svg+xml", headers=fallback_headers)

    try:
        cache_path.write_bytes(thumb_bytes)
    except Exception as exc:
        logger.debug("Failed to write thumbnail cache", extra={"path": str(cache_path), "error": str(exc)})

    return Response(content=thumb_bytes, media_type="image/jpeg", headers=headers)


@router.get("/image/{image_id}/thumbnail")
def serve_thumbnail_by_id(
    image_id: int,
    max_px: int = Query(THUMBNAIL_DEFAULT_PX, ge=THUMBNAIL_MIN_PX, le=THUMBNAIL_MAX_PX),
    session: Session = Depends(get_session),
):
    """
    Serve a thumbnail for an image by its database ID.
    Uses the same caching mechanism as path-based thumbnails.
    """
    image = session.get(Image, image_id)
    if not image or image.is_deleted:
        raise HTTPException(status_code=404, detail="Image not found")
    
    if not image.path or not os.path.exists(image.path):
        raise HTTPException(status_code=404, detail="Image file not found")
    
    # Delegate to the path-based logic
    return serve_thumbnail_by_path(image.path, max_px, session)


@router.get("/image/path")
def serve_image_by_path(path: str, session: Session = Depends(get_session)):
    actual_path = _resolve_media_path(path, session)
    if actual_path and os.path.exists(actual_path):
        headers = {"Cache-Control": "public, max-age=300"}
        return FileResponse(actual_path, media_type=_guess_media_type(actual_path), headers=headers)

    logger.warning("Serve Path: Missing file", extra={"path": path})
    raise HTTPException(status_code=404, detail=f"File not found: {path}")


class DeleteByPathRequest(BaseModel):
    path: str


@router.delete("/image/path/delete")
def delete_image_by_path(req: DeleteByPathRequest, session: Session = Depends(get_session)):
    """
    Delete an image by its file path.
    
    This endpoint is used when the image doesn't have a valid database ID
    (e.g., images from ProjectGallery that are loaded from disk).
    """
    path = req.path
    
    # Resolve the actual file path (shared logic with serve_image_by_path and thumbnails)
    actual_path = _resolve_media_path(path, session)
    if not actual_path or not os.path.exists(actual_path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    
    # Try to find matching image in database and soft-delete it
    image = session.exec(
        select(Image).where(Image.path == actual_path).order_by(Image.created_at.desc())
    ).first()
    
    if not image:
        # Also try the original path in case it's stored differently
        image = session.exec(
            select(Image).where(Image.path == path).order_by(Image.created_at.desc())
        ).first()
    
    # Delete the file from disk
    try:
        # Purge any cached thumbnails for this image before deletion
        _purge_thumbnail_cache_for_path(actual_path)
        
        os.remove(actual_path)
        # Also delete associated .json metadata file if it exists
        json_path = os.path.splitext(actual_path)[0] + ".json"
        if os.path.exists(json_path):
            os.remove(json_path)
        logger.info("Deleted image file", extra={"path": actual_path})
    except OSError as e:
        logger.exception("Failed to delete file", extra={"path": actual_path})
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {e}")
    
    # Soft delete in database if found
    if image:
        image.is_deleted = True
        image.deleted_at = datetime.utcnow()
        session.add(image)
        session.commit()
        logger.info("Soft-deleted image from database", extra={"image_id": image.id, "path": actual_path})
    
    return {"deleted": True, "path": actual_path, "db_updated": image is not None}


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
    return FileResponse(image.path, media_type=_guess_media_type(image.path))


@router.get("/image/path/metadata")
def get_image_metadata_by_path(path: str, session: Session = Depends(get_session)):
    """
    Read metadata directly from a PNG file.
    
    Returns ComfyUI workflow/prompt data and Sweet Tea provenance if embedded.
    Falls back to database extra_metadata if PNG metadata is not available.
    """
    # Resolve the actual file path
    actual_path = _resolve_media_path(path, session)
    if not actual_path or not os.path.exists(actual_path):
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

            # Comment fields (PNG text chunks, JPEG comment segments, EXIF XPComment/UserComment)
            try:
                comment_text = None
                for key in ("comment", "Comment", "Description", "parameters", "Parameters"):
                    if key in info and info.get(key):
                        comment_text = _decode_xp_comment(info.get(key))
                        if comment_text:
                            break

                exif = None
                try:
                    exif = img.getexif()
                except Exception:
                    exif = None

                if not comment_text and exif:
                    # XPComment tag ID is 0x9C9C (40092)
                    # Check by tag ID first since ExifTags.TAGS may not include XPComment
                    XP_COMMENT_TAG = 0x9C9C  # 40092
                    if XP_COMMENT_TAG in exif:
                        comment_text = _decode_xp_comment(exif[XP_COMMENT_TAG])

                    if not comment_text:
                        # Fallback to name-based lookup
                        for tag_id, value in exif.items():
                            tag_name = ExifTags.TAGS.get(tag_id, tag_id)
                            if str(tag_name).lower() in {"xpcomment", "usercomment", "comment"}:
                                comment_text = _decode_xp_comment(value)
                                if comment_text:
                                    break

                if comment_text:
                    parsed_comment = _extract_prompts_from_comment_blob(comment_text)
                    if parsed_comment.get("prompt") and not result["prompt"]:
                        result["prompt"] = parsed_comment.get("prompt")
                    if parsed_comment.get("negative_prompt") and not result["negative_prompt"]:
                        result["negative_prompt"] = parsed_comment.get("negative_prompt")
                    if isinstance(parsed_comment.get("parameters"), dict) and parsed_comment.get("parameters"):
                        result["parameters"].update(parsed_comment.get("parameters") or {})
                    if parsed_comment.get("prompt") or parsed_comment.get("negative_prompt") or parsed_comment.get("parameters"):
                        result["source"] = result["source"] if result["source"] != "none" else "comment"
            except Exception:
                pass
            
            # Try Sweet Tea provenance first (our custom format)
            if "sweet_tea_provenance" in info:
                try:
                    provenance = json.loads(info["sweet_tea_provenance"])
                    result["prompt"] = result["prompt"] or provenance.get("positive_prompt")
                    result["negative_prompt"] = result["negative_prompt"] or provenance.get("negative_prompt")
                    result["parameters"] = {
                        k: v for k, v in provenance.items()
                        if k not in ["positive_prompt", "negative_prompt", "models", "params"]
                        and v is not None
                    }
                    # Include flattened params
                    if "params" in provenance and isinstance(provenance["params"], dict):
                        result["parameters"].update(provenance["params"])
                    result["source"] = "sweet_tea"
                    _attach_job_prompt_rehydration(result, session, path=path, actual_path=actual_path)
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
        logger.warning("Failed to read image metadata", extra={"path": path, "error": str(e)})
    
    # If PIL couldn't extract prompts (e.g., for videos), try reading sidecar JSON
    # Videos and some image formats store metadata in a .json file alongside the media
    if result["source"] == "none" or not result["prompt"]:
        sidecar_path = os.path.splitext(actual_path)[0] + ".json"
        if os.path.exists(sidecar_path):
            try:
                with open(sidecar_path, "r", encoding="utf-8") as sf:
                    sidecar_data = json.load(sf)
                    if isinstance(sidecar_data, dict):
                        result["prompt"] = result["prompt"] or sidecar_data.get("positive_prompt")
                        result["negative_prompt"] = result["negative_prompt"] or sidecar_data.get("negative_prompt")
                        # Include flattened params
                        if "params" in sidecar_data and isinstance(sidecar_data["params"], dict):
                            result["parameters"].update(sidecar_data["params"])
                        else:
                            # Include non-prompt fields as parameters
                            for k, v in sidecar_data.items():
                                if k not in ["positive_prompt", "negative_prompt", "params"] and v is not None and not isinstance(v, (dict, list)):
                                    result["parameters"][k] = v
                        if result["prompt"] or result["negative_prompt"]:
                            result["source"] = "sidecar_json"
            except Exception as sidecar_err:
                logger.debug("Failed to read sidecar JSON", extra={"path": sidecar_path, "error": str(sidecar_err)})
    
    # Fallback: try to find in database by path (most recent first)
    # Try both the original path and the resolved actual_path for better matching
    image = session.exec(
        select(Image).where(Image.path == path).order_by(Image.created_at.desc())
    ).first()
    if not image and actual_path and actual_path != path:
        # Try with the resolved actual_path (may differ in slash style or resolution)
        image = session.exec(
            select(Image).where(Image.path == actual_path).order_by(Image.created_at.desc())
        ).first()
    if image and image.extra_metadata:
        metadata = image.extra_metadata if isinstance(image.extra_metadata, dict) else {}
        if isinstance(image.extra_metadata, str):
            try:
                metadata = json.loads(image.extra_metadata)
            except json.JSONDecodeError:
                metadata = {}
        
        active_prompt = metadata.get("active_prompt", {})
        result["prompt"] = result["prompt"] or active_prompt.get("positive_text")
        result["negative_prompt"] = result["negative_prompt"] or active_prompt.get("negative_text")
        if result["prompt"] or result["negative_prompt"]:
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
                if not result["prompt"]:
                    result["prompt"] = params.get("prompt") or params.get("positive") or params.get("text_positive")
                if not result["negative_prompt"]:
                    result["negative_prompt"] = params.get("negative_prompt") or params.get("negative") or params.get("text_negative")
                if result["prompt"] or result["negative_prompt"]:
                    result["source"] = "database"
        
        # Include workflow_template_id from the job (critical for regenerate to switch to correct pipe)
        if image.job_id:
            job = session.get(Job, image.job_id)
            if job and job.workflow_template_id:
                result["parameters"]["workflow_template_id"] = job.workflow_template_id
            # Include Sweet Tea prompt rehydration snapshot if present on the job params.
            # This is stored in the DB (job.input_params) but intentionally omitted from embedded media metadata.
            if job and job.input_params:
                params = job.input_params if isinstance(job.input_params, dict) else {}
                rehydration = params.get("__st_prompt_rehydration")
                if rehydration:
                    result["parameters"]["__st_prompt_rehydration"] = rehydration
    
    return result


class DownloadRequest(BaseModel):
    image_ids: List[int]


@router.post("/download")
def download_images(req: DownloadRequest, session: Session = Depends(get_session)):
    """
    Create a zip file containing multiple images and return it as a streaming response.
    For a single image, returns the image directly without zipping.
    """
    if not req.image_ids:
        raise HTTPException(status_code=400, detail="No image IDs provided")
    
    # Look up images from database
    images = session.exec(
        select(Image).where(Image.id.in_(req.image_ids)).where(Image.is_deleted == False)
    ).all()
    
    if not images:
        raise HTTPException(status_code=404, detail="No images found")
    
    # Filter to only existing files
    valid_images = []
    for img in images:
        if img.path and os.path.exists(img.path):
            valid_images.append(img)
    
    if not valid_images:
        raise HTTPException(status_code=404, detail="No image files found on disk")
    
    # Single image - return directly without zipping
    if len(valid_images) == 1:
        img = valid_images[0]
        return FileResponse(
            img.path,
            media_type=_guess_media_type(img.path),
            filename=os.path.basename(img.path)
        )
    
    # Multiple images - create zip
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        used_names = set()
        for img in valid_images:
            # Always use the actual filename from the file path - this is the source of truth
            # img.filename may be stale if the file was renamed on disk or if save nodes use custom naming
            filename = os.path.basename(img.path)
            # Handle duplicate filenames
            base_name = filename
            counter = 1
            while filename in used_names:
                name_parts = os.path.splitext(base_name)
                filename = f"{name_parts[0]}_{counter}{name_parts[1]}"
                counter += 1
            used_names.add(filename)
            
            zf.write(img.path, arcname=filename)
    
    zip_buffer.seek(0)
    
    # Generate zip filename based on timestamp
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    zip_filename = f"gallery_export_{timestamp}.zip"
    
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={zip_filename}"}
    )
