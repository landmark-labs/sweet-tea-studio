"""
Status API endpoints.
Provides aggregated system status for the status bar.
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Literal, Optional, List
from datetime import datetime
import asyncio

from app.core.comfy_client import ComfyClient
from app.services.comfy_launcher import comfy_launcher


router = APIRouter(prefix="/status", tags=["status"])


class StatusItem(BaseModel):
    """Base status indicator."""
    state: Literal["ok", "warn", "error"]
    detail: str
    last_check_at: Optional[str] = None


class EngineStatus(StatusItem):
    """Engine connection status."""
    is_connected: bool = False  # True when ComfyUI is reachable
    can_launch: bool = False    # True if ComfyUI can be started
    comfy_path: Optional[str] = None  # Detected ComfyUI path


class QueueStatus(StatusItem):
    """Job queue status."""
    pending_jobs: int = 0
    oldest_job_age_s: int = 0


class IOStatus(StatusItem):
    """File I/O status."""
    last_error: Optional[str] = None
    last_error_at: Optional[str] = None


class ModelsStatus(StatusItem):
    """Model availability status."""
    missing_models: int = 0
    missing_model_names: List[str] = []


class StatusSummary(BaseModel):
    """Aggregated system status."""
    engine: EngineStatus
    queue: QueueStatus
    io: IOStatus
    models: ModelsStatus


# In-memory tracking for I/O errors
_io_errors: List[dict] = []
_last_io_error_at: Optional[str] = None


def record_io_error(error: str):
    """Record an I/O error for status tracking."""
    global _last_io_error_at
    _last_io_error_at = datetime.utcnow().isoformat()
    _io_errors.append({"error": error, "at": _last_io_error_at})
    # Keep only last 10 errors
    if len(_io_errors) > 10:
        _io_errors.pop(0)


def clear_io_errors():
    """Clear I/O error history."""
    global _io_errors, _last_io_error_at
    _io_errors = []
    _last_io_error_at = None


async def check_engine_status() -> EngineStatus:
    """Check ComfyUI engine connectivity."""
    # Get launch config to check if we can start ComfyUI
    launch_config = comfy_launcher.get_config()
    
    try:
        client = ComfyClient("http://127.0.0.1:8188")
        # Try to get system stats as health check
        info = await asyncio.to_thread(client.get_system_stats)
        if info:
            return EngineStatus(
                state="ok",
                detail="comfyui connected",
                last_check_at=datetime.utcnow().isoformat(),
                is_connected=True,
                can_launch=launch_config.is_available,
                comfy_path=launch_config.path
            )
        else:
            return EngineStatus(
                state="warn",
                detail="comfyui responded but no stats",
                last_check_at=datetime.utcnow().isoformat(),
                is_connected=True,
                can_launch=launch_config.is_available,
                comfy_path=launch_config.path
            )
    except Exception as e:
        return EngineStatus(
            state="error",
            detail=f"comfyui not running" if launch_config.is_available else f"cannot reach comfyui",
            last_check_at=datetime.utcnow().isoformat(),
            is_connected=False,
            can_launch=launch_config.is_available,
            comfy_path=launch_config.path
        )


def get_queue_status() -> QueueStatus:
    """Get current job queue status."""
    # TODO: Integrate with actual job queue
    # For now, return placeholder
    return QueueStatus(
        state="ok",
        detail="no pending jobs",
        pending_jobs=0,
        oldest_job_age_s=0
    )


def get_io_status() -> IOStatus:
    """Get file I/O status."""
    if not _io_errors:
        return IOStatus(
            state="ok",
            detail="all writes successful"
        )
    
    recent_errors = [e for e in _io_errors if e["at"] > (datetime.utcnow().isoformat()[:19])]
    if len(recent_errors) > 2:
        return IOStatus(
            state="error",
            detail=f"{len(recent_errors)} recent write errors",
            last_error=_io_errors[-1]["error"] if _io_errors else None,
            last_error_at=_last_io_error_at
        )
    elif recent_errors:
        return IOStatus(
            state="warn",
            detail="some recent write issues",
            last_error=_io_errors[-1]["error"] if _io_errors else None,
            last_error_at=_last_io_error_at
        )
    
    return IOStatus(
        state="ok",
        detail="all writes successful"
    )


def get_models_status() -> ModelsStatus:
    """Get model availability status."""
    # TODO: Integrate with model checking logic
    # For now, return placeholder
    return ModelsStatus(
        state="ok",
        detail="all models present",
        missing_models=0,
        missing_model_names=[]
    )


@router.get("/summary", response_model=StatusSummary)
async def get_status_summary():
    """
    Get aggregated status of all system components.
    
    Returns status for:
    - engine: ComfyUI connectivity
    - queue: Job queue status
    - io: File I/O health
    - models: Model availability
    
    Each component has a state (ok/warn/error) and detail message.
    """
    engine_status = await check_engine_status()
    
    return StatusSummary(
        engine=engine_status,
        queue=get_queue_status(),
        io=get_io_status(),
        models=get_models_status()
    )


@router.get("/engine")
async def get_engine_status_detail():
    """Get detailed engine status."""
    return await check_engine_status()


@router.get("/queue")
def get_queue_status_detail():
    """Get detailed queue status."""
    return get_queue_status()


@router.get("/io")
def get_io_status_detail():
    """Get detailed I/O status with error history."""
    status = get_io_status()
    return {
        **status.model_dump(),
        "recent_errors": _io_errors[-5:] if _io_errors else []
    }


@router.get("/models")
def get_models_status_detail():
    """Get detailed models status."""
    return get_models_status()
