from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from sqlmodel import Session, select
from app.db.database import get_session
from app.models.engine import Engine
from app.models.project import Project
from app.core.config import settings
from app.services.media_paths import infer_project_slug_from_path, get_project_roots
import mimetypes
import os
from typing import Optional
from pathlib import Path

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


def _infer_project_slug_from_path(path: Path, engine: Optional[Engine]) -> Optional[str]:
    engines = [engine] if engine else []
    return infer_project_slug_from_path(path, engines)


def _ensure_unique_path(target_dir: Path, filename: str) -> Path:
    safe_name = os.path.basename(filename).strip() or "mask.png"
    stem, suffix = os.path.splitext(safe_name)
    suffix = suffix or ".png"

    candidate = target_dir / f"{stem}{suffix}"
    if not candidate.exists():
        return candidate

    counter = 1
    while True:
        candidate = target_dir / f"{stem}_{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


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


@router.post("/save-mask")
def save_mask(
    file: UploadFile = File(...),
    source_path: str = Form(...),
    engine_id: Optional[int] = Form(None),
    session: Session = Depends(get_session),
):
    """
    Save a mask PNG derived from an existing image.

    Default behavior matches ComfyUI-style workflows:
    - If the source image belongs to a non-drafts project, save into that project's "masks" folder.
    - If the source image is in drafts (or project cannot be inferred), save alongside the source image.

    Returns absolute path plus (when applicable) a ComfyUI input-relative filename.
    """
    # Get engine (for resolving comfy paths / computing relative input filename)
    engine = None
    if engine_id:
        engine = session.get(Engine, engine_id)

    if not engine:
        engine = session.exec(select(Engine).where(Engine.name == "Local ComfyUI")).first()

    if not engine:
        engine = session.exec(select(Engine).where(Engine.is_active == True)).first()

    # Resolve source image path (accepts absolute or input-relative strings)
    resolved_source: Optional[str] = None
    try:
        from app.api.endpoints.gallery import _resolve_media_path  # Local import to avoid heavy module init

        resolved_source = _resolve_media_path(source_path, session)
    except Exception:
        resolved_source = None

    source_candidate = (resolved_source or source_path).strip().strip('"').strip("'")
    source_file = Path(source_candidate)
    if not source_file.exists():
        raise HTTPException(status_code=404, detail=f"Source image not found: {source_path}")
    if not source_file.is_file():
        raise HTTPException(status_code=400, detail="Source path is not a file")

    # Decide where to save
    project_slug = _infer_project_slug_from_path(source_file, engine)
    saved_to = "same_folder"
    target_dir = source_file.parent

    if project_slug and project_slug != "drafts":
        saved_to = "project_masks"
        if engine and engine.input_dir:
            target_dir = settings.get_project_input_dir_in_comfy(engine.input_dir, project_slug) / "masks"
        elif engine and engine.output_dir:
            target_dir = settings.get_project_dir_in_comfy(engine.output_dir, project_slug) / "masks"
        else:
            target_dir = settings.get_project_dir(project_slug) / "masks"

    target_dir.mkdir(parents=True, exist_ok=True)

    # Validate + normalize filename
    safe_name = os.path.basename(file.filename) if file.filename else "mask.png"
    safe_name = safe_name.strip().strip('"').strip("'") or "mask.png"
    if not safe_name.lower().endswith(".png"):
        safe_name = f"{os.path.splitext(safe_name)[0]}.png"

    mime_type = _resolve_mime_type(file, safe_name)
    _validate_upload(safe_name, mime_type)

    target_path = _ensure_unique_path(target_dir, safe_name)

    try:
        bytes_written = 0
        with open(target_path, "wb") as buffer:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="File exceeds the maximum upload size.")
                buffer.write(chunk)
    except HTTPException:
        if target_path.exists():
            try:
                target_path.unlink()
            except Exception:
                pass
        raise
    except Exception as e:
        if target_path.exists():
            try:
                target_path.unlink()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Failed to save mask: {str(e)}")
    finally:
        try:
            file.file.close()
        except Exception:
            pass

    # Compute ComfyUI input-relative path if saved under input dir
    comfy_filename: Optional[str] = None
    if engine and engine.input_dir:
        try:
            rel = target_path.relative_to(Path(engine.input_dir))
            comfy_filename = str(rel).replace("\\", "/")
        except ValueError:
            comfy_filename = None

    project_id: Optional[int] = None
    if project_slug:
        project = session.exec(select(Project).where(Project.slug == project_slug)).first()
        if project and project.id is not None:
            project_id = project.id

    return {
        "filename": target_path.name,
        "path": str(target_path),
        "comfy_filename": comfy_filename,
        "saved_to": saved_to,
        "project_slug": project_slug,
        "project_id": project_id,
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
    
    If project_id is provided, returns the project folder roots (input + legacy output if present).
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

    # If project_id is provided, return project folder roots.
    if project_id and not path:
        project = session.get(Project, project_id)
        if project:
            folders = project.config_json.get("folders", ["input", "output", "masks"]) if project.config_json else ["input", "output", "masks"]
            roots = get_project_roots(engine=engine, project_slug=project.slug)
            if not roots:
                return []

            input_root = Path(engine.input_dir) / project.slug if engine and engine.input_dir else None
            legacy_root = settings.get_project_dir_in_comfy(engine.output_dir, project.slug) if engine and engine.output_dir else None
            local_root = settings.get_project_dir(project.slug)

            if len(roots) == 1:
                root_dir = roots[0]
                return [
                    {
                        "name": folder,
                        "type": "directory",
                        "path": str(root_dir / folder),
                        "is_root": True,
                    }
                    for folder in folders
                    if (root_dir / folder).exists()
                ]

            labeled_roots = []
            for root_dir in roots:
                label = "project"
                if input_root and root_dir == input_root:
                    label = "project (input)"
                elif legacy_root and root_dir == legacy_root:
                    label = "project (legacy output)"
                elif root_dir == local_root:
                    label = "project (local)"
                labeled_roots.append(
                    {
                        "name": label,
                        "type": "directory",
                        "path": str(root_dir),
                        "is_root": True,
                    }
                )
            return labeled_roots

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


@router.post("/copy-to-input")
def copy_to_input(
    source_path: str = Form(...),
    project_slug: Optional[str] = Form(None),
    subfolder: Optional[str] = Form(None),
    engine_id: Optional[int] = Form(None),
    session: Session = Depends(get_session)
):
    """
    Copy an existing file on disk to ComfyUI's input directory.
    
    This is used when dragging images from output folders to LoadImage nodes,
    to avoid HTTP re-upload which would add timestamp prefixes.
    
    If the file is already in the input directory, returns the existing path.
    """
    import shutil
    from pathlib import Path
    
    # Get engine
    engine = None
    if engine_id:
        engine = session.get(Engine, engine_id)
    
    if not engine:
        engine = session.exec(select(Engine).where(Engine.name == "Local ComfyUI")).first()
    
    if not engine or not engine.input_dir:
        raise HTTPException(status_code=400, detail="No valid input directory found for engine")
    
    source = Path(source_path)
    if not source.exists():
        raise HTTPException(status_code=404, detail="Source file not found")
    
    if not source.is_file():
        raise HTTPException(status_code=400, detail="Source path is not a file")
    
    # Check file extension
    ext = source.suffix.lower()
    if ext not in ALLOWED_UPLOAD_EXT:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    
    # Check if already in input directory
    input_dir = Path(engine.input_dir)
    try:
        source.relative_to(input_dir)
        # Already in input dir - return the relative path
        rel_path = str(source.relative_to(input_dir)).replace("\\", "/")
        return {"filename": rel_path, "path": str(source), "already_exists": True}
    except ValueError:
        pass  # Not in input dir, need to copy
    
    # Determine target directory
    if project_slug:
        project_input_dir = settings.get_project_input_dir_in_comfy(engine.input_dir, project_slug)
        if subfolder:
            target_dir = project_input_dir / subfolder
        else:
            target_dir = project_input_dir
        target_dir.mkdir(parents=True, exist_ok=True)
    else:
        target_dir = input_dir
        target_dir.mkdir(parents=True, exist_ok=True)
    
    # Use original filename (no timestamp prefix)
    filename = source.name
    target_path = target_dir / filename
    
    # Handle filename collision
    if target_path.exists():
        # If identical file (same size), reuse it
        if target_path.stat().st_size == source.stat().st_size:
            # Files are likely the same, use existing
            pass
        else:
            # Different file with same name - add counter
            stem = source.stem
            suffix = source.suffix
            counter = 1
            while target_path.exists():
                filename = f"{stem}_{counter}{suffix}"
                target_path = target_dir / filename
                counter += 1
    
    # Copy the file (if not already exists at target)
    if not target_path.exists():
        try:
            shutil.copy2(source, target_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to copy file: {str(e)}")
    
    # Return ComfyUI-compatible filename
    if project_slug:
        if subfolder:
            comfy_filename = f"{project_slug}/{subfolder}/{filename}"
        else:
            comfy_filename = f"{project_slug}/{filename}"
    else:
        comfy_filename = filename
    
    return {
        "filename": comfy_filename,
        "path": str(target_path),
        "already_exists": False
    }

