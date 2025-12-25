"""Models filesystem endpoints."""
import time
from pathlib import Path
from typing import List, Literal, cast

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.services.comfy_launcher import comfy_launcher


router = APIRouter()

# ============= IN-MEMORY CACHE =============
# Cache for fast subsequent loads - scan once, serve from cache
_cache = {
    "directories": {"data": None, "timestamp": 0},
    "installed": {"data": None, "timestamp": 0},
}
_CACHE_TTL = 300  # 5 minutes before auto-refresh


def _get_models_root() -> Path:
    """Resolve the ComfyUI models directory.

    Priority:
    1. Runtime override (set via PUT /directories)
    2. Detected ComfyUI path via the launcher
    3. Explicit COMFYUI_PATH setting
    4. Fallback to ~/.sweet-tea/models
    """
    # Check runtime override first
    global _models_path_override
    if _models_path_override:
        override_path = Path(_models_path_override)
        if override_path.exists():
            return override_path

    config = comfy_launcher.get_config()
    base_paths: List[str] = []

    if config.path:
        base_paths.append(config.path)

    if settings.COMFYUI_PATH and settings.COMFYUI_PATH not in base_paths:
        base_paths.append(settings.COMFYUI_PATH)

    for base in base_paths:
        models_dir = Path(base) / "models"
        if models_dir.exists():
            return models_dir

    fallback = settings.ROOT_DIR / "models"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


# Module-level override for models directory path (runtime-only)
_models_path_override: str | None = None

# Register the models root getter and import download_manager (after _get_models_root is defined)
from app.services.download_manager import download_manager, set_models_root_getter
set_models_root_getter(_get_models_root)


@router.get("/directories")
def list_model_directories(refresh: bool = False):
    """List subfolders under the models directory (cached for speed)."""
    global _cache
    now = time.time()
    
    # Return cached data if valid and not forcing refresh
    if not refresh and _cache["directories"]["data"] is not None:
        if now - _cache["directories"]["timestamp"] < _CACHE_TTL:
            return _cache["directories"]["data"]
    
    root_dir = _get_models_root()

    if not root_dir.exists():
        raise HTTPException(status_code=404, detail="models directory not found")

    folders = []
    for entry in sorted(root_dir.iterdir(), key=lambda p: p.name.lower()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        folders.append({
            "name": entry.name,
            "path": str(entry),
            "items": [],
        })

    result = {"root": str(root_dir), "folders": folders}
    
    # Cache the result
    _cache["directories"] = {"data": result, "timestamp": now}
    
    return result


@router.get("/directories/{folder_name}")
def get_folder_contents(folder_name: str):
    """Get contents of a specific model folder (lazy-loaded)."""
    root_dir = _get_models_root()
    folder_path = root_dir / folder_name
    
    if not folder_path.exists() or not folder_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Folder not found: {folder_name}")
    
    items = []
    try:
        for child in sorted(folder_path.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
            if child.name.startswith("."):
                continue
            items.append({
                "name": child.name,
                "path": str(child),
                "type": cast(Literal["file", "directory"], "directory" if child.is_dir() else "file"),
            })
    except Exception:
        items = []
    
    return {"name": folder_name, "path": str(folder_path), "items": items}


# Module-level override for models directory path (runtime-only)
_models_path_override: str | None = None


def set_models_path_override(path: str | None) -> None:
    """Set or clear a runtime override for the models directory."""
    global _models_path_override
    _models_path_override = path


def get_models_path_override() -> str | None:
    """Get the current runtime override for models path."""
    return _models_path_override


@router.put("/directories")
def update_models_directory(payload: dict):
    """Update the models directory path at runtime.
    
    Accepts: {"path": "C:/path/to/models"} or {"path": null} to clear.
    """
    new_path = payload.get("path")
    
    if new_path is not None:
        path = Path(new_path)
        if not path.exists():
            raise HTTPException(status_code=400, detail=f"Path does not exist: {new_path}")
        if not path.is_dir():
            raise HTTPException(status_code=400, detail=f"Path is not a directory: {new_path}")
    
    set_models_path_override(new_path)
    
    # Return updated directory listing
    return list_model_directories()


# --- Download Management Endpoints ---

class DownloadRequest(BaseModel):
    """Request body for queuing a download."""
    url: str
    target_folder: str = "checkpoints"


@router.post("/download")
def queue_download(request: DownloadRequest):
    """Queue a new model download.
    
    Automatically detects HuggingFace vs Civitai from URL.
    For Civitai, requires CIVITAI_API_KEY environment variable.
    """
    url = request.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    
    # Validate URL has proper protocol
    if not url.startswith("http://") and not url.startswith("https://"):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")
    
    job_id = download_manager.queue_download(url, request.target_folder)
    return {"job_id": job_id}


@router.get("/downloads")
def list_downloads():
    """List all download jobs with their current status."""
    return download_manager.get_downloads()


@router.delete("/downloads/clear")
def clear_finished_downloads():
    """Clear all completed, failed, and cancelled downloads from the queue."""
    count = download_manager.clear_finished_jobs()
    return {"cleared": count}


@router.delete("/downloads/{job_id}")
def cancel_or_remove_download(job_id: str):
    """Cancel a running download or remove a completed/failed one."""
    # Try to cancel first (for running downloads)
    cancelled = download_manager.cancel_download(job_id)
    if cancelled:
        return {"cancelled": True, "job_id": job_id}
    
    # If can't cancel, try to remove from completed jobs
    removed = download_manager.remove_job(job_id)
    if removed:
        return {"removed": True, "job_id": job_id}
    
    raise HTTPException(status_code=404, detail="Download not found")


# --- Installed Models Endpoint ---

# Common model file extensions
MODEL_EXTENSIONS = {".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".onnx", ".gguf"}


def _format_size(size_bytes: int) -> str:
    """Format file size as human-readable string."""
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


@router.get("/installed")
def list_installed_models(refresh: bool = False):
    """List all installed models (cached for speed). Use ?refresh=true to force re-scan."""
    global _cache
    now = time.time()
    
    # Return cached data if valid and not forcing refresh
    if not refresh and _cache["installed"]["data"] is not None:
        if now - _cache["installed"]["timestamp"] < _CACHE_TTL:
            return _cache["installed"]["data"]
    
    root_dir = _get_models_root()
    
    if not root_dir.exists():
        return []
    
    models = []
    
    # Walk through all subdirectories (one level deep only for speed)
    for folder in root_dir.iterdir():
        if not folder.is_dir() or folder.name.startswith("."):
            continue
        
        kind = folder.name  # e.g., "checkpoints", "loras", "vae"
        
        # Only scan immediate children (not recursive) for speed
        for model_path in folder.iterdir():
            if not model_path.is_file():
                continue
            
            if model_path.suffix.lower() not in MODEL_EXTENSIONS:
                continue
            
            try:
                stat = model_path.stat()
                size_bytes = stat.st_size
            except OSError:
                size_bytes = 0
            
            # Generate a stable ID from the path
            relative_path = model_path.relative_to(root_dir)
            model_id = str(relative_path).replace("\\", "/").replace("/", "_")
            
            models.append({
                "id": model_id,
                "name": model_path.stem,
                "kind": kind,
                "source": "local",
                "path": str(model_path),
                "size_bytes": size_bytes,
                "size_display": _format_size(size_bytes),
                "meta": None,
            })
    
    # Cache the result
    _cache["installed"] = {"data": models, "timestamp": now}
    
    return models

