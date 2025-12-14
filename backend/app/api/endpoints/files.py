from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from sqlmodel import Session, select
from app.db.database import get_session
from app.models.engine import Engine
from app.models.project import Project
from app.core.config import settings
import shutil
import os
import uuid
from typing import Optional

router = APIRouter()

@router.post("/upload")
def upload_file(
    file: UploadFile = File(...),
    engine_id: Optional[int] = Form(None),
    project_slug: Optional[str] = Form(None),
    session: Session = Depends(get_session)
):
    """
    Upload a file to ComfyUI's input directory.
    
    If project_slug is provided, saves to /ComfyUI/input/<project>/ for organization.
    Returns the filename suitable for LoadImage nodes (uses relative path for project uploads).
    """
    # Get engine
    engine = None
    if engine_id:
        engine = session.get(Engine, engine_id)
    
    if not engine:
        # Fallback to default engine
        engine = session.exec(select(Engine).where(Engine.name == "Local ComfyUI")).first()
    
    if not engine or not engine.input_dir:
        raise HTTPException(status_code=400, detail="No valid input directory found for engine")

    # Determine target directory based on project
    if project_slug:
        # New structure: /ComfyUI/input/<project>/
        target_dir = settings.get_project_input_dir_in_comfy(engine.input_dir, project_slug)
        # Ensure the project input directory exists
        target_dir.mkdir(parents=True, exist_ok=True)
    else:
        # Legacy: root input directory
        target_dir = engine.input_dir
        os.makedirs(target_dir, exist_ok=True)

    # Generate filename with timestamp prefix for temporal sorting
    from datetime import datetime
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"{timestamp}_{file.filename}"
    file_path = os.path.join(target_dir, filename)

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    # Return ComfyUI-compatible filename
    # For project uploads, LoadImage needs: "<project>/<filename>"
    if project_slug:
        comfy_filename = f"{project_slug}/{filename}"
    else:
        comfy_filename = filename

    return {"filename": comfy_filename, "path": file_path}

@router.get("/tree")
def get_file_tree(
    engine_id: Optional[int] = None,
    project_id: Optional[int] = None,
    path: str = "",  # Relative path to scan
    session: Session = Depends(get_session)
):
    """
    Get file tree for input/output directories.
    
    If project_id is provided, returns the project folder inside ComfyUI/sweet_tea/ as root.
    Otherwise, returns the engine's input/output directories.
    """
    # Get the engine first
    if engine_id:
        engine = session.get(Engine, engine_id)
        if not engine and engine_id:
            pass  # Fallback silently
    else:
        engine = None

    if not engine:
        engine = session.exec(select(Engine).where(Engine.name == "Local ComfyUI")).first()

    if not engine:
        raise HTTPException(status_code=404, detail="No engine configuration found")

    # If project_id is provided, return project folder as root
    if project_id and not path:
        project = session.get(Project, project_id)
        if project and engine.output_dir:
            project_dir = settings.get_project_dir_in_comfy(engine.output_dir, project.slug)
            
            # Ensure directories exist
            if not project_dir.exists():
                settings.ensure_sweet_tea_project_dirs(
                    engine.output_dir,
                    project.slug,
                    subfolders=project.config_json.get("folders", ["input", "output", "masks"]) if project.config_json else ["input", "output", "masks"]
                )
            
            # Return project subfolders as roots
            folders = project.config_json.get("folders", ["input", "output", "masks"]) if project.config_json else ["input", "output", "masks"]
            return [
                {
                    "name": folder,
                    "type": "directory",
                    "path": str(project_dir / folder),
                    "is_root": True
                }
                for folder in folders
                if (project_dir / folder).exists()
            ]

    # Default behavior: engine input/output directories
    base_dirs = []
    if engine.input_dir:
        base_dirs.append({"name": "Inputs", "path": engine.input_dir, "type": "directory"})
    if engine.output_dir:
        base_dirs.append({"name": "Outputs", "path": engine.output_dir, "type": "directory"})

    # If asking for root
    if not path:
        return [{"name": d["name"], "type": "directory", "path": d["path"], "is_root": True} for d in base_dirs]

    # Check if path is valid
    if not os.path.isdir(path):
        # It might be a file or non-existent
        return []

    items = []
    try:
        with os.scandir(path) as it:
            for entry in it:
                if entry.name.startswith('.'): continue
                
                item = {
                    "name": entry.name,
                    "path": entry.path,
                    "type": "directory" if entry.is_dir() else "file"
                }
                items.append(item)
    except Exception as e:
        print(f"Error scanning {path}: {e}")
        return []

    # Sort: Directories first, then files
    items.sort(key=lambda x: (x["type"] != "directory", x["name"].lower()))
    return items
