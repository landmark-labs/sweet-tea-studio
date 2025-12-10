"""
Projects API endpoints.
Manages project creation, listing, and run organization.
"""
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select
from typing import List, Optional
from datetime import datetime
import re

from app.db.engine import engine
from app.models.project import Project, ProjectCreate, ProjectRead
from app.models.job import Job
from app.core.config import settings


router = APIRouter(prefix="/projects", tags=["projects"])


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


@router.get("/", response_model=List[ProjectRead])
def list_projects(
    include_archived: bool = False,
    session: Session = Depends(get_session)
):
    """
    List all projects.
    
    By default, excludes archived projects. Set include_archived=true to see all.
    The 'drafts' project is always included as the default project.
    """
    query = select(Project)
    if not include_archived:
        query = query.where(Project.archived_at == None)
    
    projects = session.exec(query.order_by(Project.created_at.desc())).all()
    return projects


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project_id: int, session: Session = Depends(get_session)):
    """Get a specific project by ID."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.post("/", response_model=ProjectRead)
def create_project(data: ProjectCreate, session: Session = Depends(get_session)):
    """
    Create a new project.
    
    If slug is not provided, it will be auto-generated from the name.
    Project directories are automatically created on disk.
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
    
    # Create project record
    project = Project(
        name=data.name,
        slug=slug,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    
    # Create project directories on disk
    settings.ensure_project_dirs(slug)
    
    return project


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
