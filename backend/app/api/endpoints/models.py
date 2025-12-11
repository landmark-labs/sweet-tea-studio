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
    1. Detected ComfyUI path via the launcher
    2. Explicit COMFYUI_PATH setting
    3. Fallback to ~/.sweet-tea/models
    """

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

