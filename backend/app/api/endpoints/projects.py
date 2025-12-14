"""
Projects API endpoints.
Manages project creation, listing, and run organization.
"""
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select, SQLModel
from typing import List, Optional
from datetime import datetime
import re

from sqlalchemy import func
from app.db.engine import engine
from app.models.project import Project, ProjectCreate, ProjectRead
from app.models.job import Job
from app.models.image import Image
from app.models.engine import Engine
from app.core.config import settings


router = APIRouter()


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
    # 1. Fetch Projects
    query = select(Project)
    if not include_archived:
        query = query.where(Project.archived_at == None)
    
    projects = session.exec(query.order_by(Project.created_at.desc())).all()
    
    # 2. Fetch Stats
    # We'll do this in Python for simplicity/compat for now, 
    # though SQL group_by would be more performant for huge datasets.
    # Given the likely scale, this is acceptable and cleaner to read.
    
    # Count images per project (via Job)
    # Project -> Job -> Image
    # Or just count jobs? Creating a job is activity.
    # User asked for "number of images".
    
    # Let's get image counts grouped by project_id
    # SELECT job.project_id, COUNT(image.id) FROM image JOIN job ON image.job_id = job.id GROUP BY job.project_id
    
    stats_query = (
        select(Job.project_id, func.count(Image.id), func.max(Job.created_at))
        .join(Image, Job.id == Image.job_id)
        .where(Image.is_deleted == False)  # Exclude soft-deleted
        .group_by(Job.project_id)
    )
    results = session.exec(stats_query).all()
    
    stats_map = {row[0]: {"count": row[1], "last": row[2]} for row in results if row[0] is not None}
    
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


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project_id: int, session: Session = Depends(get_session)):
    """Get a specific project by ID."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    # Stats
    count = session.exec(
        select(func.count(Image.id))
        .join(Job, Image.job_id == Job.id)
        .where(Job.project_id == project_id)
        .where(Image.is_deleted == False)  # Exclude soft-deleted
    ).one()
    
    last = session.exec(
        select(func.max(Job.created_at))
        .where(Job.project_id == project_id)
    ).one()
    
    return ProjectRead(
        **project.dict(),
        image_count=count or 0,
        last_activity=last or project.updated_at
    )


@router.post("", response_model=ProjectRead)
def create_project(data: ProjectCreate, session: Session = Depends(get_session)):
    """
    Create a new project.
    
    If slug is not provided, it will be auto-generated from the name.
    Project directories are created inside ComfyUI/sweet_tea/{project_slug}/.
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
    
    # Get active engine to find ComfyUI path
    active_engine = session.exec(select(Engine).where(Engine.is_active == True)).first()
    
    if active_engine and active_engine.output_dir:
        # Create project directories inside ComfyUI/sweet_tea/
        settings.ensure_sweet_tea_project_dirs(
            active_engine.output_dir, 
            slug, 
            subfolders=default_folders
        )
    else:
        # Fallback to legacy location if no engine configured
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
    """Add a new output folder to the project."""
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
    
    # Create directory in ComfyUI/sweet_tea/ if engine available
    active_engine = session.exec(select(Engine).where(Engine.is_active == True)).first()
    if active_engine and active_engine.output_dir:
        settings.ensure_sweet_tea_project_dirs(
            active_engine.output_dir, 
            project.slug, 
            subfolders=[folder_name]
        )
    else:
        settings.ensure_project_dirs(project.slug, subfolders=[folder_name])
    
    # Return with empty stats as we just modified it (or could refetch stats)
    # Refetching stats logic reused to keep consistency
    count = session.exec(
        select(func.count(Image.id))
        .join(Job, Image.job_id == Job.id)
        .where(Job.project_id == project_id)
        .where(Image.is_deleted == False)  # Exclude soft-deleted
    ).one()
    
    return ProjectRead(
        **project.dict(), 
        image_count=count or 0, 
        last_activity=project.updated_at
    )


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


@router.get("/{project_id}/folders/{folder_name}/images", response_model=List[FolderImage])
def list_project_folder_images(
    project_id: int,
    folder_name: str,
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
    config = project.config_json or {"folders": ["inputs", "output", "masks"]}
    folders = config.get("folders", [])
    if folder_name not in folders:
        raise HTTPException(status_code=404, detail=f"Folder '{folder_name}' not found in project")
    
    # Resolve path: Check active engine first
    active_engine = session.exec(select(Engine).where(Engine.is_active == True)).first()
    
    if active_engine and active_engine.output_dir:
        # Use ComfyUI/sweet_tea location
        folder_path = settings.get_project_dir_in_comfy(active_engine.output_dir, project.slug) / folder_name
    else:
        # Fallback to local storage
        folder_path = settings.get_project_dir(project.slug) / folder_name
    
    if not folder_path.exists():
        return []
    
    # Supported image extensions
    image_extensions = {".png", ".jpg", ".jpeg", ".webp"}
    
    # Get paths of soft-deleted images to exclude from results
    deleted_paths = set(
        row[0] for row in session.exec(
            select(Image.path).where(Image.is_deleted == True)
        ).all() if row
    )
    
    images = []
    try:
        for entry in os.scandir(folder_path):
            if entry.is_file():
                ext = os.path.splitext(entry.name)[1].lower()
                if ext in image_extensions:
                    # Skip soft-deleted images
                    if entry.path in deleted_paths:
                        continue
                    stat = entry.stat()
                    images.append({
                        "path": entry.path,
                        "filename": entry.name,
                        "mtime": dt.fromtimestamp(stat.st_mtime).isoformat()
                    })
    except Exception as e:
        print(f"Error scanning folder {folder_path}: {e}")
        return []
    
    # Sort by modification time, newest first
    images.sort(key=lambda x: x["mtime"], reverse=True)
    
    return images
