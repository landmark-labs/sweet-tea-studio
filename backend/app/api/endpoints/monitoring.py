from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, List
from pathlib import Path
import json
import os
import psutil
import threading
import time

from app.services.monitoring import monitor
from app.services.comfy_watchdog import watchdog
from app.core.websockets import manager
from app.services.job_processor import get_sequence_cache_stats


router = APIRouter()
_client_log_lock = threading.Lock()
_client_log_dir = Path(__file__).resolve().parents[3] / "logs"
_client_log_path = _client_log_dir / "client_diagnostics.jsonl"
_client_log_max_mb = float(os.getenv("SWEET_TEA_CLIENT_LOG_MAX_MB", "20"))
_client_log_enabled = os.getenv("SWEET_TEA_CLIENT_LOG_ENABLED", "true").lower() not in ("0", "false", "no")


class ClientLogPayload(BaseModel):
    session_id: str
    entries: List[dict]


def _process_diagnostics() -> dict:
    proc = psutil.Process(os.getpid())
    mem = proc.memory_info()
    open_fds = None
    try:
        open_fds = proc.num_fds()
    except AttributeError:
        try:
            open_fds = proc.num_handles()
        except AttributeError:
            open_fds = None

    return {
        "pid": proc.pid,
        "rss_mb": round(mem.rss / 1024 / 1024, 2),
        "vms_mb": round(mem.vms / 1024 / 1024, 2),
        "threads": proc.num_threads(),
        "open_fds": open_fds,
    }


def _rotate_client_log_if_needed() -> None:
    if not _client_log_path.exists():
        return
    max_bytes = int(_client_log_max_mb * 1024 * 1024)
    try:
        size = _client_log_path.stat().st_size
    except OSError:
        return
    if size < max_bytes:
        return

    timestamp = time.strftime("%Y%m%d-%H%M%S")
    rotated = _client_log_path.with_name(f"client_diagnostics-{timestamp}.jsonl")
    try:
        _client_log_path.rename(rotated)
    except OSError:
        return


@router.get("/metrics")
def read_metrics():
    return monitor.get_metrics()


@router.get("/system")
def get_system_metrics():
    """Get system metrics (CPU, memory, GPU, disk) - works without ComfyUI."""
    return monitor.get_metrics()


@router.get("/health")
def get_engine_health() -> List[dict]:
    """Get health status of all engines (ComfyUI connections)."""
    # Use watchdog's get_status method which returns properly formatted health info
    health_list = watchdog.get_status()
    
    # If no engines registered yet, return a default entry
    if not health_list:
        # Check if any engines are in state
        any_healthy = any(s.healthy for s in watchdog.state.values()) if watchdog.state else False
        health_list.append({
            "engine_id": 1,
            "engine_name": "ComfyUI",
            "healthy": any_healthy,
            "last_error": None,
            "last_checked_at": None,
            "next_check_in": 5,
        })
    
    return health_list


@router.get("/diagnostics")
def get_diagnostics():
    return {
        "process": _process_diagnostics(),
        "websockets": manager.get_stats(),
        "sequence_cache": get_sequence_cache_stats(),
    }


@router.post("/client-logs")
def log_client_diagnostics(payload: ClientLogPayload):
    if not _client_log_enabled:
        raise HTTPException(status_code=403, detail="Client diagnostics disabled")

    if not payload.entries:
        return {"status": "ok", "received": 0}

    entries = payload.entries[:200]
    _client_log_dir.mkdir(parents=True, exist_ok=True)

    with _client_log_lock:
        _rotate_client_log_if_needed()
        with open(_client_log_path, "a", encoding="utf-8") as handle:
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                entry.setdefault("session_id", payload.session_id)
                handle.write(json.dumps(entry, ensure_ascii=True, separators=(",", ":")) + "\n")

    return {"status": "ok", "received": len(entries)}


@router.get("/status/summary")
def get_status_summary():
    """Get summary status including engine health and job counts."""
    from sqlmodel import Session, select, func
    from app.db.engine import engine
    from app.models.job import Job
    from datetime import datetime, timedelta
    from app.services.comfy_launcher import comfy_launcher
    
    with Session(engine) as session:
        # Count jobs by status
        jobs_queued = session.exec(
            select(func.count(Job.id)).where(Job.status == "queued")
        ).one() or 0
        
        jobs_running = session.exec(
            select(func.count(Job.id)).where(Job.status.in_(["running", "processing"]))
        ).one() or 0
        
        # Jobs completed in last 24 hours
        yesterday = datetime.utcnow() - timedelta(hours=24)
        jobs_completed_24h = session.exec(
            select(func.count(Job.id)).where(
                Job.status == "completed",
                Job.created_at >= yesterday
            )
        ).one() or 0
    
    # Get ComfyUI launcher status
    launcher_status = comfy_launcher.get_status()
    
    # Count healthy engines from watchdog
    healthy_count = sum(1 for s in watchdog.state.values() if s.healthy) if watchdog.state else 0
    any_connected = healthy_count > 0
    
    # Determine engine state
    if any_connected:
        engine_state = "ok"
        engine_detail = "connected"
    elif launcher_status.get("running"):
        engine_state = "warn"
        engine_detail = "starting..."
    else:
        engine_state = "error"
        engine_detail = "disconnected"
    
    # Build response matching StatusBar.tsx expected structure
    return {
        "engine": {
            "state": engine_state,
            "detail": engine_detail,
            "is_connected": any_connected,
            "is_process_running": launcher_status.get("running", False),
            "can_launch": launcher_status.get("available", False),
            "comfy_path": launcher_status.get("comfy_path"),
            "launcher_error": launcher_status.get("error"),
            "launcher_cooldown": launcher_status.get("cooldown"),
            "pid": launcher_status.get("pid"),
        },
        "queue": {
            "state": "warn" if jobs_queued > 5 else "ok",
            "detail": f"{jobs_queued} pending" if jobs_queued else "idle",
            "pending_jobs": jobs_queued,
            "oldest_job_age_s": 0,
        },
        "io": {
            "state": "ok",
            "detail": "ready",
        },
        "models": {
            "state": "ok",
            "detail": "all present",
            "missing_models": 0,
        },
    }


@router.get("/versions")
def get_versions():
    """Get version information from the connected ComfyUI instance."""
    from sqlmodel import Session, select
    from app.db.engine import engine
    from app.models.engine import Engine as EngineModel
    from app.core.comfy_client import ComfyClient, ComfyConnectionError
    
    # Try to get version info from the first active engine
    with Session(engine) as session:
        active_engine = session.exec(
            select(EngineModel).where(EngineModel.is_active == True)
        ).first()
    
    if not active_engine:
        return {
            "comfyui_version": None,
            "pytorch_version": None,
            "cuda_version": None,
            "python_version": None,
            "connected": False,
            "error": "No active engine configured"
        }
    
    try:
        client = ComfyClient(active_engine)
        stats = client.get_system_stats()
        
        # Parse the system stats response
        # ComfyUI /system_stats returns: {"system": {..., "comfyui_version": "...", ...}, "devices": [...]}
        system_info = stats.get("system", {})
        devices = stats.get("devices", [])
        
        cuda_version = None
        if devices:
            # Get CUDA version from first device if available
            first_device = devices[0] if devices else {}
            cuda_version = first_device.get("cuda", first_device.get("cuda_version"))
        
        return {
            "comfyui_version": system_info.get("comfyui_version"),
            "pytorch_version": system_info.get("torch_version") or system_info.get("pytorch_version"),
            "cuda_version": cuda_version,
            "python_version": system_info.get("python_version", "").split()[0],
            "connected": True,
            "error": None
        }
    except ComfyConnectionError as e:
        return {
            "comfyui_version": None,
            "pytorch_version": None,
            "cuda_version": None,
            "python_version": None,
            "connected": False,
            "error": str(e)
        }


@router.get("/comfyui/status")
def get_comfyui_status():
    """Get status of the managed ComfyUI process."""
    from app.services.comfy_launcher import comfy_launcher

    return comfy_launcher.get_status()


@router.post("/comfyui/start")
async def start_comfyui():
    """Start the ComfyUI process."""
    from app.services.comfy_launcher import comfy_launcher
    
    result = await comfy_launcher.launch()
    return result


@router.post("/comfyui/stop")
async def stop_comfyui():
    """Stop the ComfyUI process."""
    from app.services.comfy_launcher import comfy_launcher

    result = await comfy_launcher.stop()
    return result


@router.get("/comfyui/logs")
def get_comfyui_logs(lines: int = 200):
    """Get console logs from the managed ComfyUI process."""
    from app.services.comfy_launcher import comfy_launcher
    return {"logs": comfy_launcher.get_logs(lines)}


class FreeMemoryRequest(BaseModel):
    unload_models: bool = False
    free_memory: bool = False


@router.post("/free-memory")
def free_memory(request: FreeMemoryRequest):
    """
    Free GPU VRAM by unloading models.
    
    - unload_models: Unload models from VRAM
    - free_memory: Free all cached memory (VRAM + RAM)
    """
    from sqlmodel import Session, select
    from app.db.engine import engine
    from app.models.engine import Engine as EngineModel
    from app.core.comfy_client import ComfyClient, ComfyConnectionError
    
    # Get the first active engine
    with Session(engine) as session:
        active_engine = session.exec(
            select(EngineModel).where(EngineModel.is_active == True)
        ).first()
    
    if not active_engine:
        raise HTTPException(status_code=503, detail="No active ComfyUI engine configured")
    
    try:
        client = ComfyClient(active_engine)
        success = client.free_memory(
            unload_models=request.unload_models,
            free_memory=request.free_memory
        )
        return {"success": success}
    except ComfyConnectionError as e:
        raise HTTPException(status_code=503, detail=str(e))

