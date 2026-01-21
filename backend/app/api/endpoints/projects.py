"""
Projects API endpoints.
Manages project creation, listing, and run organization.
"""
from fastapi import APIRouter, HTTPException, Depends, Query, Response, Request
from sqlmodel import Session, select, SQLModel
from typing import List, Optional
from datetime import datetime
from collections import OrderedDict
import os
import hashlib
import re
import threading
import time

from app.db.engine import engine
from app.models.project import Project, ProjectCreate, ProjectRead
from app.models.job import Job
from app.models.image import Image
from app.models.engine import Engine
from app.core.config import settings
from app.services import app_settings
from app.services.media_paths import (
    build_project_path_index,
    get_project_folder_paths,
    normalize_fs_path,
)
from app.services.media_sync import maybe_resync_media_index


router = APIRouter()

_image_dim_cache: "OrderedDict[str, tuple[float, Optional[int], Optional[int]]]" = OrderedDict()
_image_dim_cache_lock = threading.Lock()

_folder_image_cache: "OrderedDict[str, tuple[float, str, List[dict]]]" = OrderedDict()
_folder_image_cache_lock = threading.Lock()


def _get_setting_int(key: str, fallback: int) -> int:
    value = app_settings.get_setting_typed(key, fallback)
    if value is None:
        return fallback
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return fallback


def _get_setting_float(key: str, fallback: float) -> float:
    value = app_settings.get_setting_typed(key, fallback)
    if value is None:
        return fallback
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _get_image_dim_cache_max() -> int:
    return max(0, _get_setting_int("image_dim_cache_max", 2000))


def _get_folder_cache_max() -> int:
    return max(0, _get_setting_int("project_folder_cache_max", 32))


def _get_folder_cache_ttl_s() -> float:
    return max(0.0, _get_setting_float("project_folder_cache_ttl_s", 2.5))


def _folder_cache_get(cache_key: str, signature: str) -> Optional[List[dict]]:
    ttl_s = _get_folder_cache_ttl_s()
    if ttl_s <= 0:
        return None
    now = time.time()
    with _folder_image_cache_lock:
        entry = _folder_image_cache.get(cache_key)
        if not entry:
            return None
        cached_at, cached_signature, cached_images = entry
        if cached_signature != signature:
            return None
        if now - cached_at > ttl_s:
            return None
        _folder_image_cache.move_to_end(cache_key)
        return cached_images


def _folder_cache_set(cache_key: str, signature: str, images: List[dict]) -> None:
    ttl_s = _get_folder_cache_ttl_s()
    max_entries = _get_folder_cache_max()
    if ttl_s <= 0 or max_entries <= 0:
        return
    with _folder_image_cache_lock:
        _folder_image_cache[cache_key] = (time.time(), signature, images)
        _folder_image_cache.move_to_end(cache_key)
        while len(_folder_image_cache) > max_entries:
            _folder_image_cache.popitem(last=False)


def _get_cached_dimensions(path: str, mtime: float) -> tuple[Optional[int], Optional[int], bool]:
    with _image_dim_cache_lock:
        entry = _image_dim_cache.get(path)
        if entry and entry[0] == mtime:
            _image_dim_cache.move_to_end(path)
            return entry[1], entry[2], True
    return None, None, False


def _set_cached_dimensions(path: str, mtime: float, width: Optional[int], height: Optional[int]) -> None:
    max_entries = _get_image_dim_cache_max()
    if max_entries <= 0:
        return
    with _image_dim_cache_lock:
        _image_dim_cache[path] = (mtime, width, height)
        _image_dim_cache.move_to_end(path)
        while len(_image_dim_cache) > max_entries:
            _image_dim_cache.popitem(last=False)


def get_session():
    """Dependency to get a database session."""
    with Session(engine) as session:
        yield session


def slugify(text: str) -> str:
    """Convert text to a URL-safe slug."""
    # Convert to lowercase
    text = text.lower()
    # Replace spaces and special chars with hyphens
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    # Remove leading/trailing hyphens
    text = text.strip('-')
    return text or "untitled"


def _collect_project_image_stats(session: Session, projects: List[Project]) -> dict[int, dict[str, Optional[datetime] | int]]:
    if not projects:
        return {}

    engines = session.exec(select(Engine)).all()
    path_index = build_project_path_index(engines=engines, projects=projects)

    stats: dict[int, dict[str, Optional[datetime] | int]] = {
        int(p.id): {"count": 0, "last": None} for p in projects if p.id is not None
    }

    needs_commit = False
    rows = session.exec(
        select(Image, Job)
        .join(Job, Image.job_id == Job.id, isouter=True)
        .where(Image.is_deleted == False)
    ).all()

    now = datetime.utcnow()
    for img, job in rows:
        if not img or img.id is None:
            continue

        file_exists = img.file_exists
        if file_exists is None:
            if img.path and isinstance(img.path, str):
                file_exists = os.path.exists(img.path)
            else:
                file_exists = False
            img.file_exists = file_exists
            if not file_exists:
                img.is_deleted = True
                img.deleted_at = now
            session.add(img)
            needs_commit = True

        if not file_exists or img.is_deleted:
            continue

        project_id = None
        path_project_id = path_index.match_project_id(img.path) if img.path else None
        if path_project_id is not None:
            project_id = path_project_id
        elif not path_index.roots:
            if job and job.project_id is not None:
                project_id = job.project_id

        if project_id is None or project_id not in stats:
            continue

        stats_entry = stats[project_id]
        stats_entry["count"] = int(stats_entry.get("count") or 0) + 1

        candidate = job.created_at if job and job.created_at else img.created_at
        last = stats_entry.get("last")
        if last is None or (candidate and candidate > last):
            stats_entry["last"] = candidate

    if needs_commit:
        try:
            session.commit()
        except Exception:
            session.rollback()

    return stats


@router.get("", response_model=List[ProjectRead])
def list_projects(
    include_archived: bool = False,
    session: Session = Depends(get_session)
):
    """
    List all projects with basic stats (image count, last activity).
    
    By default, excludes archived projects. Set include_archived=true to see all.
    The 'drafts' project is always included as the default project.
    """
    maybe_resync_media_index(session)

    # 1. Fetch Projects
    query = select(Project)
    if not include_archived:
        query = query.where(Project.archived_at == None)
    
    projects = session.exec(query.order_by(Project.display_order, Project.id)).all()
    
    stats_map = _collect_project_image_stats(session, projects)
    
    # 3. Merge
    project_reads = []
    for p in projects:
        s = stats_map.get(p.id, {"count": 0, "last": None})
        
        # Fallback to project updated_at if no job activity
        last_activity = s["last"] or p.updated_at
        
        project_reads.append(
            ProjectRead(
                **p.dict(),
                image_count=s["count"],
                last_activity=last_activity
            )
        )
        
    return project_reads


class ProjectReorderItem(SQLModel):
    """Schema for reordering a single project."""
    id: int
    display_order: int


@router.patch("/reorder")
def reorder_projects(
    items: List[ProjectReorderItem],
    session: Session = Depends(get_session)
):
    """Bulk update display_order for multiple projects."""
    for item in items:
        project = session.get(Project, item.id)
        if project:
            project.display_order = item.display_order
            session.add(project)
    session.commit()
    return {"ok": True, "updated": len(items)}


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project_id: int, session: Session = Depends(get_session)):
    """Get a specific project by ID."""
    maybe_resync_media_index(session)
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    stats_map = _collect_project_image_stats(session, [project])
    stats = stats_map.get(project.id, {"count": 0, "last": None})
    count = stats.get("count") or 0
    last = stats.get("last")
    
    return ProjectRead(
        **project.dict(),
        image_count=count,
        last_activity=last or project.updated_at
    )


@router.post("", response_model=ProjectRead)
def create_project(data: ProjectCreate, session: Session = Depends(get_session)):
    """
    Create a new project.
    
    If slug is not provided, it will be auto-generated from the name.
    
    Directory structure:
    - Input folders (input, masks, custom): /ComfyUI/input/<project>/
    - Output folder: /ComfyUI/input/<project>/output/ (legacy outputs may exist in /ComfyUI/sweet_tea/<project>/output/)
    """
    # Generate slug if not provided
    slug = data.slug if data.slug else slugify(data.name)
    
    # Check for duplicate slug
    existing = session.exec(select(Project).where(Project.slug == slug)).first()
    if existing:
        raise HTTPException(
            status_code=400, 
            detail=f"Project with slug '{slug}' already exists"
        )
    
    # Default config with folders
    # "output" is special - stored separately in sweet_tea, but listed here for UI
    default_folders = ["input", "output", "masks"]
    config = {
        "folders": default_folders
    }
    
    # Create project record
    project = Project(
        name=data.name,
        slug=slug,
        config_json=config,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    
    # Get active engine to find ComfyUI paths
    active_engine = session.exec(select(Engine).where(Engine.is_active == True)).first()
    
    if active_engine and active_engine.output_dir and active_engine.input_dir:
        # Use NEW structure: inputs in /ComfyUI/input/, outputs in /ComfyUI/sweet_tea/
        input_subfolders = [f for f in default_folders if f != "output"]
        settings.ensure_project_dirs_new_structure(
            active_engine.input_dir,
            active_engine.output_dir, 
            slug, 
            input_subfolders=input_subfolders
        )
    elif active_engine and active_engine.output_dir:
        # Fallback to legacy structure if input_dir not configured
        settings.ensure_sweet_tea_project_dirs(
            active_engine.output_dir, 
            slug, 
            subfolders=default_folders
        )
    else:
        # Fallback to local storage if no engine configured
        settings.ensure_project_dirs(slug, subfolders=default_folders)
    
    return ProjectRead(**project.dict(), image_count=0, last_activity=project.updated_at)


class FolderCreate(SQLModel):
    folder_name: str


@router.post("/{project_id}/folders", response_model=ProjectRead)
def add_project_folder(
    project_id: int,
    data: FolderCreate,
    session: Session = Depends(get_session)
):
    """
    Add a new folder to the project.
    
    Non-output folders are created in /ComfyUI/input/<project>/.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    folder_name = slugify(data.folder_name)
    if not folder_name:
        raise HTTPException(status_code=400, detail="Invalid folder name")
        
    config = project.config_json or {"folders": ["input", "output", "masks"]}
    folders = list(config.get("folders", []))  # Create a new list copy
    
    if folder_name in folders:
        raise HTTPException(status_code=400, detail="Folder already exists")
        
    folders.append(folder_name)
    # Create a NEW dict to trigger SQLAlchemy change detection
    project.config_json = {**config, "folders": folders}
    project.updated_at = datetime.utcnow()
    
    session.add(project)
    session.commit()
    session.refresh(project)
    
    # Create directory using new structure
    active_engine = session.exec(select(Engine).where(Engine.is_active == True)).first()
    
    if active_engine and active_engine.input_dir and folder_name != "output":
        # New folders (except output) go in /ComfyUI/input/<project>/
        project_input_dir = settings.get_project_input_dir_in_comfy(
            active_engine.input_dir, project.slug
        )
        project_input_dir.mkdir(parents=True, exist_ok=True)
        (project_input_dir / folder_name).mkdir(exist_ok=True)
    elif active_engine and active_engine.output_dir:
        # Fallback to legacy sweet_tea location
        settings.ensure_sweet_tea_project_dirs(
            active_engine.output_dir, 
            project.slug, 
            subfolders=[folder_name]
        )
    else:
        settings.ensure_project_dirs(project.slug, subfolders=[folder_name])
    
    stats_map = _collect_project_image_stats(session, [project])
    stats = stats_map.get(project.id, {"count": 0, "last": None})
    return ProjectRead(
        **project.dict(),
        image_count=stats.get("count") or 0,
        last_activity=stats.get("last") or project.updated_at,
    )


@router.delete("/{project_id}/folders/{folder_name}", response_model=ProjectRead)
def delete_project_folder(
    project_id: int,
    folder_name: str,
    session: Session = Depends(get_session)
):
    """
    Delete an empty subfolder from a project.
    
    Only allows deletion if folder is empty and not reserved (input, output, masks).
    """
    import logging
    logger = logging.getLogger(__name__)
    
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    reserved_folders = {"input", "output", "masks"}
    if folder_name in reserved_folders:
        raise HTTPException(status_code=400, detail=f"Cannot delete reserved folder '{folder_name}'")
    
    config = project.config_json or {"folders": ["input", "output", "masks"]}
    folders = list(config.get("folders", []))
    
    if folder_name not in folders:
        raise HTTPException(status_code=404, detail=f"Folder '{folder_name}' not found in project")
    
    active_engine = session.exec(select(Engine).where(Engine.is_active == True)).first()
    folder_path = None
    
    if active_engine and active_engine.input_dir and folder_name != "output":
        folder_path = settings.get_project_input_dir_in_comfy(active_engine.input_dir, project.slug) / folder_name
    
    if not folder_path or not folder_path.exists():
        if active_engine and active_engine.output_dir:
            legacy_path = settings.get_project_dir_in_comfy(active_engine.output_dir, project.slug) / folder_name
            if legacy_path.exists():
                folder_path = legacy_path
    
    if not folder_path or not folder_path.exists():
        local_path = settings.get_project_dir(project.slug) / folder_name
        if local_path.exists():
            folder_path = local_path
    
    if folder_path and folder_path.exists():
        try:
            contents = list(folder_path.iterdir())
            if contents:
                raise HTTPException(status_code=400, detail=f"Cannot delete non-empty folder '{folder_name}'. It contains {len(contents)} item(s).")
            folder_path.rmdir()
            logger.info(f"[Projects] Deleted empty folder: {folder_path}")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"[Projects] Failed to delete folder {folder_path}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to delete folder: {str(e)}")
    
    folders.remove(folder_name)
    project.config_json = {**config, "folders": folders}
    project.updated_at = datetime.utcnow()
    
    session.add(project)
    session.commit()
    session.refresh(project)
    
    stats_map = _collect_project_image_stats(session, [project])
    stats = stats_map.get(project.id, {"count": 0, "last": None})
    return ProjectRead(
        **project.dict(),
        image_count=stats.get("count") or 0,
        last_activity=stats.get("last") or project.updated_at,
    )


@router.delete("/{project_id}/folders/{folder_name}/trash")
def empty_folder_trash(
    project_id: int,
    folder_name: str,
    session: Session = Depends(get_session)
):
    """
    Permanently delete all files in the .trash subfolder for a project folder.
    
    This cannot be undone. All files in the trash folder will be permanently removed.
    """
    import shutil
    import logging
    logger = logging.getLogger(__name__)
    
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Resolve folder paths using the shared logic (input + legacy + local)
    active_engine = session.exec(select(Engine).where(Engine.is_active == True)).first()
    folder_paths = get_project_folder_paths(
        engine=active_engine,
        project_slug=project.slug,
        folder_name=folder_name,
    )

    if not folder_paths:
        raise HTTPException(status_code=404, detail=f"Folder '{folder_name}' not found")

    deleted_count = 0
    errors = []

    for folder_path in folder_paths:
        trash_path = folder_path / ".trash"
        if not trash_path.exists():
            continue

        try:
            for item in trash_path.iterdir():
                try:
                    if item.is_file():
                        item.unlink()
                        deleted_count += 1
                    elif item.is_dir():
                        shutil.rmtree(item)
                        deleted_count += 1
                except Exception as e:
                    logger.error(f"Failed to delete {item}: {e}")
                    errors.append(str(item.name))
        except Exception as e:
            logger.error(f"Failed to iterate trash folder: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to empty trash: {str(e)}")

    if deleted_count == 0 and not errors:
        return {"deleted": 0, "message": "No trash folder exists"}
    if errors:
        return {"deleted": deleted_count, "errors": errors}
    return {"deleted": deleted_count}



@router.patch("/{project_id}", response_model=ProjectRead)
def update_project(
    project_id: int,
    name: Optional[str] = None,
    config_json: Optional[dict] = None,
    session: Session = Depends(get_session)
):
    """Update a project's name or config."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if name is not None:
        project.name = name
    if config_json is not None:
        project.config_json = config_json
    
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.post("/{project_id}/archive", response_model=ProjectRead)
def archive_project(project_id: int, session: Session = Depends(get_session)):
    """Archive a project (soft delete)."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if project.slug == "drafts":
        raise HTTPException(status_code=400, detail="Cannot archive the drafts project")
    
    project.archived_at = datetime.utcnow()
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.post("/{project_id}/unarchive", response_model=ProjectRead)
def unarchive_project(project_id: int, session: Session = Depends(get_session)):
    """Restore an archived project."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    project.archived_at = None
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    return project



class FolderReorderRequest(SQLModel):
    """Schema for reordering project folders."""
    folders: List[str]


@router.patch("/{project_id}/folders/reorder")
def reorder_project_folders(
    project_id: int,
    req: FolderReorderRequest,
    session: Session = Depends(get_session)
):
    """Update folder order in project config_json."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    config = project.config_json or {"folders": ["input", "output", "masks"]}
    config["folders"] = req.folders
    project.config_json = config
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    return {"ok": True}


@router.post("/{project_id}/convert-runs")
def convert_runs_to_project(
    project_id: int,
    run_ids: List[int],
    session: Session = Depends(get_session)
):
    """
    Move runs from drafts to a specific project.
    
    This updates the run records and moves the associated files
    from the drafts folder to the project folder.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Ensure project directories exist
    settings.ensure_project_dirs(project.slug)
    
    # TODO: Implement file moving logic
    # For each run:
    # 1. Update project_id in run record
    # 2. Move files from drafts/<type> to <project_slug>/<type>
    # 3. Update output paths in db
    # 4. Create hardlink/copy in outputs_all/
    
    moved_count = len(run_ids)  # Placeholder
    
    return {
        "moved": moved_count,
        "project_id": project_id,
        "project_name": project.name,
        "project_slug": project.slug
    }


@router.post("/{project_id}/adopt-jobs")
def adopt_jobs_into_project(
    project_id: int,
    job_ids: List[int],
    session: Session = Depends(get_session)
):
    """
    Attach existing jobs (and their gallery images) to a project.

    This is primarily used to convert draft/unassigned generations into
    a real project after the fact by simply updating the job's project_id.
    """
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not job_ids:
        return {"updated": 0, "project_id": project_id}

    jobs = session.exec(select(Job).where(Job.id.in_(job_ids))).all()

    updated = 0
    for job in jobs:
        # Only retarget unassigned jobs to avoid clobbering existing project data
        if job.project_id is None:
            job.project_id = project_id
            session.add(job)
            updated += 1

    session.commit()

    return {
        "updated": updated,
        "project_id": project_id,
        "project_name": project.name,
        "project_slug": project.slug,
    }


class FolderImage(SQLModel):
    """Schema for an image file in a project folder."""
    path: str
    filename: str
    mtime: str
    width: Optional[int] = None
    height: Optional[int] = None


@router.get("/{project_id}/folders/{folder_name}/images", response_model=List[FolderImage])
def list_project_folder_images(
    project_id: int,
    folder_name: str,
    include_dimensions: bool = Query(True),
    dimensions_source: str = Query("auto"),
    request: Request = None,
    response: Response = None,
    session: Session = Depends(get_session)
):
    """
    List all image files in a project's subfolder.
    
    Returns images sorted by modification time (newest first).
    Supported formats: .png, .jpg, .jpeg, .webp
    """
    import os
    from datetime import datetime as dt
    
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Validate folder exists in project config
    # Validate folder exists in project config
    config = project.config_json or {}
    folders = config.get("folders")
    if folders is None:
        folders = ["input", "output", "masks"]  # Default if missing
        
    if folder_name not in folders and not (project.slug == "drafts" and folder_name == "output"):
        raise HTTPException(status_code=404, detail=f"Folder '{folder_name}' not found in project")
    
    # Resolve folder paths based on engine configuration (input + legacy output + local fallback)
    active_engine = session.exec(select(Engine).where(Engine.is_active == True)).first()
    folder_paths = get_project_folder_paths(
        engine=active_engine,
        project_slug=project.slug,
        folder_name=folder_name,
    )
    
    # Debug: log path resolution
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"[ProjectGallery] project={project.slug}, folder={folder_name}")
    logger.info(f"[ProjectGallery] active_engine={active_engine.name if active_engine else 'None'}")
    if active_engine:
        logger.info(f"[ProjectGallery] input_dir='{active_engine.input_dir}', output_dir='{active_engine.output_dir}'")
    logger.info(f"[ProjectGallery] folder_paths={[str(p) for p in folder_paths]}")

    if not folder_paths:
        return []

    dimensions_source = (dimensions_source or "auto").lower()
    if dimensions_source not in {"auto", "db", "file"}:
        dimensions_source = "auto"

    cache_key_parts = [
        str(project_id),
        folder_name,
        "dims" if include_dimensions else "nodims",
        dimensions_source,
    ]
    signature_parts = [
        f"dims:{int(include_dimensions)}",
        f"source:{dimensions_source}",
    ]
    for path in folder_paths:
        norm_path = normalize_fs_path(str(path))
        cache_key_parts.append(norm_path)
        try:
            stat = path.stat()
            signature_parts.append(f"{norm_path}:{stat.st_mtime_ns}")
        except Exception:
            signature_parts.append(f"{norm_path}:missing")

    cache_key = "|".join(cache_key_parts)
    signature = "|".join(signature_parts)
    etag = hashlib.sha1(signature.encode("utf-8")).hexdigest()
    etag_header = f"\"{etag}\""

    if request is not None:
        if_none_match = request.headers.get("if-none-match") or ""
        if if_none_match.strip() == etag_header or if_none_match.strip().strip("\"") == etag:
            if response is not None:
                response.headers["ETag"] = etag_header
            return Response(status_code=304, headers={"ETag": etag_header})

    cached = _folder_cache_get(cache_key, signature)
    if cached is not None:
        if response is not None:
            response.headers["ETag"] = etag_header
        return cached
    
    # Supported media extensions
    image_extensions = {".png", ".jpg", ".jpeg", ".webp"}
    video_extensions = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".mpg", ".mpeg"}
    
    # Get paths of soft-deleted images to exclude from results
    deleted_paths = set()
    for row in session.exec(select(Image.path).where(Image.is_deleted == True)).all():
        if not row:
            continue
        path_value = row[0]
        if not path_value:
            continue
        deleted_paths.add(normalize_fs_path(str(path_value)))
    
    images = []
    entry_records: List[tuple[dict, str, float]] = []
    try:
        use_file_dims = include_dimensions and dimensions_source in {"auto", "file"}
        PILImage = None
        if use_file_dims:
            from PIL import Image as PILImage  # type: ignore
        
        for folder_path in folder_paths:
            for entry in os.scandir(folder_path):
                if entry.is_file():
                    ext = os.path.splitext(entry.name)[1].lower()
                    if ext in image_extensions or ext in video_extensions:
                        # Skip soft-deleted images (normalize to handle path case/slash drift)
                        if normalize_fs_path(entry.path) in deleted_paths:
                            continue
                        stat = entry.stat()
                        record = {
                            "path": entry.path,
                            "filename": entry.name,
                            "mtime": dt.fromtimestamp(stat.st_mtime).isoformat(),
                            "width": None,
                            "height": None,
                        }
                        entry_records.append((record, ext, stat.st_mtime))
                        images.append(record)
    except Exception as e:
        print(f"Error scanning folder {folder_path}: {e}")
        return []

    if include_dimensions and images:
        path_to_dims: dict[str, tuple[Optional[int], Optional[int]]] = {}
        paths = [record["path"] for record in images]
        chunk_size = 900
        for i in range(0, len(paths), chunk_size):
            chunk = paths[i:i + chunk_size]
            rows = session.exec(
                select(Image.path, Image.width, Image.height).where(Image.path.in_(chunk))
            ).all()
            for row in rows:
                try:
                    img_path, width, height = row
                except Exception:
                    continue
                if img_path:
                    path_to_dims[str(img_path)] = (width, height)

        for record, ext, stat_mtime in entry_records:
            dims = path_to_dims.get(record["path"])
            if dims:
                width, height = dims
                if width is not None and height is not None:
                    record["width"] = width
                    record["height"] = height

            if record["width"] is None and include_dimensions and dimensions_source in {"auto", "file"} and PILImage is not None:
                if ext in image_extensions:
                    cached_width, cached_height, cached = _get_cached_dimensions(record["path"], stat_mtime)
                    if cached:
                        record["width"] = cached_width
                        record["height"] = cached_height
                    else:
                        try:
                            with PILImage.open(record["path"]) as img:
                                record["width"], record["height"] = img.size
                        except Exception:
                            pass
                        _set_cached_dimensions(record["path"], stat_mtime, record["width"], record["height"])
    
    # Sort by modification time, newest first
    images.sort(key=lambda x: x["mtime"], reverse=True)
    _folder_cache_set(cache_key, signature, images)
    if response is not None:
        response.headers["ETag"] = etag_header

    return images


class FolderImageDeleteRequest(SQLModel):
    """Request schema for deleting folder images."""
    paths: List[str]


@router.post("/{project_id}/folders/{folder_name}/delete-images")
def delete_folder_images(
    project_id: int,
    folder_name: str,
    req: FolderImageDeleteRequest,
    session: Session = Depends(get_session)
):
    """
    Delete image files from a project folder.
    
    Permanently removes the files from disk. This is irreversible.
    """
    import os
    
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Validate folder exists in project config
    # Validate folder exists in project config
    config = project.config_json or {}
    folders = config.get("folders")
    if folders is None:
        folders = ["input", "output", "masks"]
        
    if folder_name not in folders and not (project.slug == "drafts" and folder_name == "output"):
        raise HTTPException(status_code=404, detail=f"Folder '{folder_name}' not found in project")
    
    # Resolve folder paths for validation
    active_engine = session.exec(select(Engine).where(Engine.is_active == True)).first()
    folder_paths = get_project_folder_paths(
        engine=active_engine,
        project_slug=project.slug,
        folder_name=folder_name,
    )
    if not folder_paths:
        raise HTTPException(status_code=404, detail=f"Folder '{folder_name}' not found")
    
    deleted = 0
    errors = []
    soft_deleted_count = 0
    
    folder_abses = [normalize_fs_path(os.path.abspath(str(path))) for path in folder_paths]

    def _is_within_allowed_folder(abs_path: str) -> bool:
        normalized = normalize_fs_path(abs_path)
        for root in folder_abses:
            if not root:
                continue
            if normalized == root or normalized.startswith(root + os.sep):
                return True
        return False

    # Local import to avoid heavy module init at import time
    from app.api.endpoints.gallery import _purge_thumbnail_cache_for_path  # noqa: WPS433

    for path in req.paths:
        # Security: validate path is within the expected folder
        try:
            abs_path = os.path.abspath(path)
            if _is_within_allowed_folder(abs_path):
                if os.path.exists(abs_path):
                    _purge_thumbnail_cache_for_path(abs_path)
                    os.remove(abs_path)
                    deleted += 1
                    
                    # Also remove .json sidecar if exists
                    json_path = os.path.splitext(abs_path)[0] + ".json"
                    if os.path.exists(json_path):
                        os.remove(json_path)
                    
                    # Soft-delete the corresponding Image record in the database
                    # This prevents "Missing File" artifacts in the gallery
                    db_image = session.exec(
                        select(Image).where(Image.path == abs_path)
                    ).first()
                    if db_image:
                        db_image.is_deleted = True
                        db_image.deleted_at = datetime.utcnow()
                        session.add(db_image)
                        soft_deleted_count += 1
                else:
                    errors.append(f"File not found: {path}")
            else:
                errors.append(f"Access denied: {path}")
        except Exception as e:
            errors.append(f"Failed to delete {path}: {str(e)}")
    
    # Commit all soft-delete changes
    if soft_deleted_count > 0:
        session.commit()
    
    return {
        "deleted": deleted,
        "errors": errors,
        "soft_deleted": soft_deleted_count
    }
