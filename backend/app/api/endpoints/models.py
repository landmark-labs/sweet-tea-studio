"""
Models API endpoints.
Provides model discovery, metadata parsing, and download functionality.
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional, Literal
from pathlib import Path
import os
import json
import hashlib
from datetime import datetime

router = APIRouter(prefix="/models", tags=["models"])


# Model types supported
ModelType = Literal["checkpoint", "lora", "vae", "controlnet", "upscaler", "embedding", "clip", "vlm"]


class InstalledModel(BaseModel):
    """Represents an installed model file."""
    id: str
    name: str
    filename: str
    kind: ModelType
    path: str  # Relative path from ComfyUI root
    size_bytes: int
    size_display: str
    source: Optional[str] = None  # 'civitai', 'huggingface', 'manual'
    checksum: Optional[str] = None
    meta: Optional[dict] = None  # Parsed metadata
    last_modified: Optional[str] = None


class DownloadRequest(BaseModel):
    """Request to download a model."""
    url: str
    target_folder: ModelType
    filename: Optional[str] = None


class DownloadStatus(BaseModel):
    """Status of a download job."""
    job_id: str
    status: Literal["queued", "downloading", "completed", "failed"]
    progress: float  # 0-100
    speed: Optional[str] = None
    eta: Optional[str] = None
    error: Optional[str] = None


# ComfyUI model folder mappings
MODEL_FOLDERS = {
    "checkpoint": ["checkpoints"],
    "lora": ["loras"],
    "vae": ["vae"],
    "controlnet": ["controlnet"],
    "upscaler": ["upscale_models", "upscalers"],
    "embedding": ["embeddings"],
    "clip": ["clip"],
    "vlm": ["LLM", "vlm"],
}

# Track active downloads (in-memory for now)
_active_downloads: dict[str, DownloadStatus] = {}


def get_comfy_models_path() -> Optional[Path]:
    """Get the ComfyUI models directory path."""
    # Try common locations
    possible_paths = [
        Path(os.environ.get("COMFYUI_PATH", "")) / "models",
        Path.home() / "ComfyUI" / "models",
        Path("C:/Users/jkoti/sd/Data/Packages/ComfyUI/models"),
        Path("/workspace/ComfyUI/models"),
    ]
    
    for p in possible_paths:
        if p.exists():
            return p
    
    return None


def format_size(size_bytes: int) -> str:
    """Format bytes as human-readable size."""
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"


def parse_civitai_info(info_path: Path) -> Optional[dict]:
    """Parse a .civitai.info metadata file."""
    try:
        with open(info_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {
            "source": "civitai",
            "model_id": data.get("modelId"),
            "version_id": data.get("id"),
            "name": data.get("name"),
            "description": data.get("description"),
            "base_model": data.get("baseModel"),
            "trained_words": data.get("trainedWords", []),
        }
    except Exception:
        return None


def calculate_partial_hash(filepath: Path, chunk_size: int = 1024 * 1024) -> str:
    """Calculate a partial hash for quick identification (first 1MB)."""
    try:
        hasher = hashlib.sha256()
        with open(filepath, "rb") as f:
            chunk = f.read(chunk_size)
            hasher.update(chunk)
        return hasher.hexdigest()[:16]  # First 16 chars
    except Exception:
        return ""


def discover_models_in_folder(models_path: Path, kind: ModelType, folders: List[str]) -> List[InstalledModel]:
    """Discover models in specified folders."""
    models = []
    
    for folder_name in folders:
        folder_path = models_path / folder_name
        if not folder_path.exists():
            continue
        
        # Walk through all files recursively
        for filepath in folder_path.rglob("*"):
            if not filepath.is_file():
                continue
            
            # Check for model file extensions
            ext = filepath.suffix.lower()
            if ext not in [".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf"]:
                continue
            
            try:
                stat = filepath.stat()
                rel_path = filepath.relative_to(models_path)
                
                # Look for metadata files
                civitai_info_path = filepath.with_suffix(filepath.suffix + ".civitai.info")
                meta = None
                source = "manual"
                
                if civitai_info_path.exists():
                    meta = parse_civitai_info(civitai_info_path)
                    if meta:
                        source = "civitai"
                
                # Check for HuggingFace marker
                if "huggingface" in str(filepath).lower() or (filepath.parent / "config.json").exists():
                    source = "huggingface"
                
                model = InstalledModel(
                    id=f"{kind}-{calculate_partial_hash(filepath)}",
                    name=meta.get("name") if meta else filepath.stem,
                    filename=filepath.name,
                    kind=kind,
                    path=str(rel_path),
                    size_bytes=stat.st_size,
                    size_display=format_size(stat.st_size),
                    source=source,
                    checksum=calculate_partial_hash(filepath),
                    meta=meta,
                    last_modified=datetime.fromtimestamp(stat.st_mtime).isoformat(),
                )
                models.append(model)
            except Exception as e:
                print(f"Error processing {filepath}: {e}")
                continue
    
    return models


@router.get("/installed", response_model=List[InstalledModel])
def get_installed_models(kind: Optional[ModelType] = None):
    """
    Get all installed models from ComfyUI model directories.
    
    Optionally filter by model type (checkpoint, lora, vae, etc.).
    Parses .civitai.info metadata when available.
    """
    models_path = get_comfy_models_path()
    if not models_path:
        raise HTTPException(
            status_code=503,
            detail="ComfyUI models directory not found"
        )
    
    all_models: List[InstalledModel] = []
    
    for model_type, folders in MODEL_FOLDERS.items():
        if kind and model_type != kind:
            continue
        all_models.extend(discover_models_in_folder(models_path, model_type, folders))
    
    # Sort by name
    all_models.sort(key=lambda m: m.name.lower())
    
    return all_models


@router.get("/installed/{model_id}")
def get_model_details(model_id: str):
    """Get detailed information about a specific model."""
    models = get_installed_models()
    for model in models:
        if model.id == model_id:
            return model
    raise HTTPException(status_code=404, detail="Model not found")


@router.get("/folders")
def get_model_folders():
    """Get the model folder structure and available types."""
    models_path = get_comfy_models_path()
    if not models_path:
        return {"error": "ComfyUI models directory not found", "folders": []}
    
    folders = []
    for kind, folder_names in MODEL_FOLDERS.items():
        for folder_name in folder_names:
            folder_path = models_path / folder_name
            folders.append({
                "kind": kind,
                "name": folder_name,
                "path": str(folder_path),
                "exists": folder_path.exists(),
                "writable": folder_path.exists() and os.access(folder_path, os.W_OK),
            })
    
    return {
        "models_path": str(models_path),
        "folders": folders
    }


@router.post("/download")
def start_download(request: DownloadRequest, background_tasks: BackgroundTasks):
    """
    Queue a model download.
    
    Supports Hugging Face and Civitai URLs.
    Downloads are processed in the background.
    """
    import uuid
    
    job_id = str(uuid.uuid4())[:8]
    
    # Create download status
    status = DownloadStatus(
        job_id=job_id,
        status="queued",
        progress=0,
    )
    _active_downloads[job_id] = status
    
    # Queue the download task
    background_tasks.add_task(
        execute_download,
        job_id=job_id,
        url=request.url,
        target_folder=request.target_folder,
        filename=request.filename,
    )
    
    return {"job_id": job_id, "status": "queued"}


@router.get("/download/{job_id}")
def get_download_status(job_id: str):
    """Get the status of a download job."""
    if job_id not in _active_downloads:
        raise HTTPException(status_code=404, detail="Download job not found")
    return _active_downloads[job_id]


@router.get("/downloads")
def list_downloads():
    """List all active and recent downloads."""
    return list(_active_downloads.values())


async def execute_download(job_id: str, url: str, target_folder: str, filename: Optional[str]):
    """Execute a model download (background task)."""
    import subprocess
    import re
    
    status = _active_downloads.get(job_id)
    if not status:
        return
    
    try:
        status.status = "downloading"
        
        models_path = get_comfy_models_path()
        if not models_path:
            status.status = "failed"
            status.error = "ComfyUI models directory not found"
            return
        
        # Determine target directory
        folders = MODEL_FOLDERS.get(target_folder, [target_folder])
        target_dir = models_path / folders[0]
        target_dir.mkdir(parents=True, exist_ok=True)
        
        # Determine filename from URL if not provided
        if not filename:
            filename = url.split("/")[-1].split("?")[0]
            if not filename or "." not in filename:
                filename = f"model_{job_id}.safetensors"
        
        target_path = target_dir / filename
        
        # Use aria2c for fast downloading if available
        try:
            result = subprocess.run(
                ["aria2c", "--help"],
                capture_output=True,
                timeout=5,
            )
            use_aria2 = result.returncode == 0
        except Exception:
            use_aria2 = False
        
        if use_aria2:
            # Use aria2c for multi-connection download
            cmd = [
                "aria2c",
                "-x", "16",  # 16 connections
                "-s", "16",  # 16 splits
                "-d", str(target_dir),
                "-o", filename,
                url,
            ]
        else:
            # Fall back to curl
            cmd = [
                "curl",
                "-L",  # Follow redirects
                "-o", str(target_path),
                url,
            ]
        
        # Execute download
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        process.wait()
        
        if process.returncode == 0 and target_path.exists():
            status.status = "completed"
            status.progress = 100
        else:
            status.status = "failed"
            status.error = "Download failed"
    
    except Exception as e:
        status.status = "failed"
        status.error = str(e)
