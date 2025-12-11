from fastapi import APIRouter
from typing import List

from app.services.monitoring import monitor
from app.services.comfy_watchdog import watchdog


router = APIRouter()


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


@router.get("/status/summary")
def get_status_summary():
    """Get summary status including engine health and job counts."""
    from sqlmodel import Session, select, func
    from app.db.engine import engine
    from app.models.job import Job
    from datetime import datetime, timedelta
    
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
    
    # Count healthy engines
    healthy_count = sum(1 for s in watchdog.state.values() if s.healthy) if watchdog.state else 0
    
    return {
        "engines_total": max(len(watchdog.state), 1),
        "engines_healthy": healthy_count,
        "jobs_queued": jobs_queued,
        "jobs_running": jobs_running,
        "jobs_completed_24h": jobs_completed_24h,
        "system": monitor.get_metrics(),
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

