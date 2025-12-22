from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from sqlmodel import Session, select
from app.db.database import get_session
from app.models.engine import Engine
from app.models.project import Project
from app.core.config import settings
import mimetypes
import os
from typing import Optional

router = APIRouter()

DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024
try:
    MAX_UPLOAD_BYTES = int(os.getenv("SWEET_TEA_UPLOAD_MAX_BYTES", str(DEFAULT_MAX_UPLOAD_BYTES)))
except ValueError:
    MAX_UPLOAD_BYTES = DEFAULT_MAX_UPLOAD_BYTES

ALLOWED_IMAGE_MIME = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
}
ALLOWED_VIDEO_MIME = {
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-matroska",
    "video/x-msvideo",
}
ALLOWED_UPLOAD_MIME = ALLOWED_IMAGE_MIME | ALLOWED_VIDEO_MIME
ALLOWED_UPLOAD_EXT = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".bmp",
    ".tif",
    ".tiff",
    ".mp4",
    ".webm",
    ".mov",
    ".mkv",
    ".avi",
}


def _resolve_mime_type(file: UploadFile, filename: str) -> str:
    content_type = (file.content_type or "").lower().strip()
    if content_type:
        return content_type
    guessed = mimetypes.guess_type(filename)[0]
    return (guessed or "application/octet-stream").lower()


def _validate_upload(filename: str, mime_type: str) -> None:
    ext = os.path.splitext(filename)[1].lower()
    allowed_by_ext = ext in ALLOWED_UPLOAD_EXT
    allowed_by_mime = mime_type in ALLOWED_UPLOAD_MIME
    if not allowed_by_ext and not allowed_by_mime:
        raise HTTPException(status_code=400, detail="Unsupported file type.")

@router.post("/upload")
def upload_file(
    file: UploadFile = File(...),
    engine_id: Optional[int] = Form(None),
    project_slug: Optional[str] = Form(None),
    subfolder: Optional[str] = Form(None),  # e.g., "input", "masks", "transform"
    session: Session = Depends(get_session)
):
    """
    Upload a file to ComfyUI's input directory.
    
    If project_slug is provided, saves to /ComfyUI/input/<project>/ for organization.
    If subfolder is also provided, saves to /ComfyUI/input/<project>/<subfolder>/.
    
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

    # Determine target directory based on project and subfolder
    if project_slug:
        # New structure: /ComfyUI/input/<project>/
        project_input_dir = settings.get_project_input_dir_in_comfy(engine.input_dir, project_slug)
        
        if subfolder:
            # With subfolder: /ComfyUI/input/<project>/<subfolder>/
            target_dir = project_input_dir / subfolder
        else:
            # No subfolder: /ComfyUI/input/<project>/
            target_dir = project_input_dir
            
        # Ensure the directory exists
        target_dir.mkdir(parents=True, exist_ok=True)
    else:
        # Legacy: root input directory
        target_dir = engine.input_dir
        os.makedirs(target_dir, exist_ok=True)

    # Generate filename with timestamp prefix for temporal sorting
    from datetime import datetime
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_name = os.path.basename(file.filename) if file.filename else "upload"
    filename = f"{timestamp}_{safe_name}"
    file_path = os.path.join(target_dir, filename)

    try:
        mime_type = _resolve_mime_type(file, safe_name)
        _validate_upload(safe_name, mime_type)

        bytes_written = 0
        with open(file_path, "wb") as buffer:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="File exceeds the maximum upload size.")
                buffer.write(chunk)
    except HTTPException:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
    finally:
        try:
            file.file.close()
        except Exception:
            pass

    # Return ComfyUI-compatible filename
    # For project uploads, LoadImage needs: "<project>/<subfolder>/<filename>" or "<project>/<filename>"
    if project_slug:
        if subfolder:
            comfy_filename = f"{project_slug}/{subfolder}/{filename}"
        else:
            comfy_filename = f"{project_slug}/{filename}"
    else:
        comfy_filename = filename

    return {
        "filename": comfy_filename,
        "path": file_path,
        "mime_type": mime_type,
        "size_bytes": bytes_written,
    }

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
