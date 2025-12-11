"""Models filesystem endpoints."""
from pathlib import Path
from typing import List, Literal, cast

from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.services.comfy_launcher import comfy_launcher


router = APIRouter()


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


@router.get("/directories")
def list_model_directories():
    """List subfolders under the models directory and their immediate contents."""

    root_dir = _get_models_root()

    if not root_dir.exists():
        raise HTTPException(status_code=404, detail="models directory not found")

    folders = []

    for entry in sorted(root_dir.iterdir(), key=lambda p: p.name.lower()):
        if not entry.is_dir() or entry.name.startswith("."):
            continue

        items = []
        try:
            for child in sorted(entry.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
                if child.name.startswith("."):
                    continue

                items.append(
                    {
                        "name": child.name,
                        "path": str(child),
                        "type": cast(Literal["file", "directory"], "directory" if child.is_dir() else "file"),
                    }
                )
        except Exception:
            # Ignore read errors for individual folders
            items = []

        folders.append(
            {
                "name": entry.name,
                "path": str(entry),
                "items": items,
            }
        )

    return {"root": str(root_dir), "folders": folders}


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

