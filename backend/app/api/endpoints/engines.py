from datetime import datetime
import time
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.db.engine import engine as db_engine
from app.models.engine import Engine, EngineCreate, EngineRead, EngineUpdate
from app.services.comfy_watchdog import watchdog
from app.services.comfy_launcher import comfy_launcher

from app.core.comfy_client import ComfyClient

router = APIRouter()


class EngineHealth(BaseModel):
    engine_id: int
    engine_name: Optional[str]
    healthy: bool
    last_error: Optional[str]
    last_checked_at: Optional[datetime]
    next_check_in: int


class LaunchConfig(BaseModel):
    """ComfyUI launch configuration."""
    path: Optional[str] = None
    python_path: Optional[str] = None
    args: List[str] = Field(default_factory=list)
    port: int = 8188
    is_available: bool = False
    detection_method: str = ""


class LaunchConfigUpdate(BaseModel):
    path: Optional[str] = None
    args: Optional[str] = None


@router.post("/", response_model=EngineRead)
def create_engine(engine_in: EngineCreate):
    with Session(db_engine) as session:
        db_obj = Engine.from_orm(engine_in)
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

@router.get("/", response_model=List[EngineRead])
def read_engines(skip: int = 0, limit: int = 100):
    with Session(db_engine) as session:
        statement = select(Engine).offset(skip).limit(limit)
        results = session.exec(statement).all()
        return results

@router.get("/health", response_model=List[EngineHealth])
def read_engine_health():
    with Session(db_engine) as session:
        engines = session.exec(select(Engine).where(Engine.is_active == True)).all()

    results: List[EngineHealth] = []
    for engine in engines:
        state = watchdog.state.get(engine.id)
        if not state:
            state = watchdog._check_engine(engine)

        last_checked_at = (
            datetime.fromtimestamp(state.last_checked_wall) if state.last_checked_wall else None
        )
        results.append(
            EngineHealth(
                engine_id=engine.id,
                engine_name=engine.name,
                healthy=state.healthy,
                last_error=state.last_error,
                last_checked_at=last_checked_at,
                next_check_in=max(int(state.next_check - time.monotonic()), 0),
            )
        )

    return results


@router.get("/{engine_id}", response_model=EngineRead)
def read_engine(engine_id: int):
    with Session(db_engine) as session:
        engine = session.get(Engine, engine_id)
        if not engine:
            raise HTTPException(status_code=404, detail="Engine not found")
        return engine


@router.patch("/{engine_id}", response_model=EngineRead)
def update_engine(engine_id: int, engine_update: EngineUpdate):
    """
    Update engine configuration.
    
    Allows updating any engine field including output_dir and input_dir.
    This is how users configure ComfyUI paths after initial setup.
    """
    with Session(db_engine) as session:
        engine = session.get(Engine, engine_id)
        if not engine:
            raise HTTPException(status_code=404, detail="Engine not found")
        
        # Update only provided fields
        update_data = engine_update.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(engine, field, value)
        
        session.add(engine)
        session.commit()
        session.refresh(engine)
        return engine


# Also support PUT for environments where PATCH might be blocked
@router.put("/{engine_id}", response_model=EngineRead)
def update_engine_put(engine_id: int, engine_update: EngineUpdate):
    """Alternative to PATCH for updating engine configuration."""
    return update_engine(engine_id, engine_update)

@router.get("/{engine_id}/object_info")
def read_object_info(engine_id: int):
    with Session(db_engine) as session:
        engine = session.get(Engine, engine_id)
        if not engine:
            raise HTTPException(status_code=404, detail="Engine not found")
        
        client = ComfyClient(engine)
        try:
            return client.get_object_info()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to fetch object info from ComfyUI: {str(e)}")


@router.get("/comfyui/config", response_model=LaunchConfig)
def get_comfyui_config():
    """
    Get ComfyUI launch configuration.
    
    Returns detected ComfyUI paths and whether it can be launched.
    """
    config = comfy_launcher.get_config()
    return LaunchConfig(
        path=config.path,
        python_path=config.python_path,
        args=config.args or [],
        port=config.port,
        is_available=config.is_available,
        detection_method=config.detection_method,
    )


@router.post("/comfyui/config", response_model=LaunchConfig)
def set_comfyui_config(update: LaunchConfigUpdate):
    """Set a user-provided ComfyUI path and optional launch arguments."""
    result = comfy_launcher.set_config(path=update.path, args=update.args)

    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Unable to save config"))

    config = result["config"]

    return LaunchConfig(
        path=config.path,
        python_path=config.python_path,
        args=config.args or [],
        port=config.port,
        is_available=config.is_available,
        detection_method=config.detection_method,
    )


@router.post("/comfyui/launch")
async def launch_comfyui():
    """
    Launch ComfyUI as a subprocess.
    
    Requires ComfyUI to be installed and detectable.
    Returns launch status and process ID if successful.
    """
    result = await comfy_launcher.launch()
    if not result.get("success"):
        raise HTTPException(
            status_code=503,
            detail=result.get("error", "Failed to launch ComfyUI")
        )
    return result


@router.post("/comfyui/stop")
async def stop_comfyui():
    """
    Stop the managed ComfyUI process.

    Only stops ComfyUI if it was started by Sweet Tea Studio.
    """
    result = await comfy_launcher.stop()
    return result


@router.get("/comfyui/status")
def get_comfyui_status():
    """
    Get current ComfyUI process status.

    Returns whether ComfyUI is running and if it can be launched.
    """
    status = comfy_launcher.get_status()
    return {
        "is_running": status.get("running", False),
        "can_launch": status.get("available", False),
        "path": status.get("path"),
        "detection_method": status.get("detection_method"),
        "pid": status.get("pid"),
        "cooldown_remaining": status.get("cooldown_remaining"),
        "last_error": status.get("last_error"),
        "last_action_at": status.get("last_action_at"),
    }
