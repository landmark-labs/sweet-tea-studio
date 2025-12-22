"""
Jobs API Endpoints

This module handles the core generation job lifecycle:
1. JOB CREATION (POST /jobs/)
2. WEBSOCKET (GET /jobs/{job_id}/ws)
3. JOB CONTROL (Cancel, List, Read)

Execution logic is delegated to app.services.job_processor.
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect
from sqlmodel import Session, select

from app.models.job import Job, JobCreate, JobRead
from app.models.project import Project
from app.models.workflow import WorkflowTemplate
from app.models.engine import Engine
from app.db.engine import engine as db_engine
from app.core.websockets import manager
from app.services.job_processor import process_job

# ===== DIAGNOSTIC MODE TOGGLE =====
DIAGNOSTIC_MODE = True

if DIAGNOSTIC_MODE:
    from app.core.comfy_diagnostics import DiagnosticComfyClient as ComfyClient
    from app.core.comfy_client import ComfyConnectionError
else:
    from app.core.comfy_client import ComfyClient, ComfyConnectionError
# ===================================

router = APIRouter()


@router.post("/", response_model=JobRead)
def create_job(job_data: JobCreate, background_tasks: BackgroundTasks):
    """
    Create a new generation job.
    - Validates Engine and Workflow availability
    - Creates Job record
    - Queues process_job in background
    """
    with Session(db_engine) as session:
        # Validate Engine
        engine = session.get(Engine, job_data.engine_id)
        if not engine:
            raise HTTPException(status_code=404, detail="Engine not found")
        
        # Validate Workflow
        workflow = session.get(WorkflowTemplate, job_data.workflow_template_id)
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")

        # Create Job Record
        job = Job.from_orm(job_data)
        job.status = "queued"
        session.add(job)
        session.commit()
        session.refresh(job)

        # Queue Execution
        background_tasks.add_task(process_job, job.id)
        
        return job


@router.post("/{job_id}/cancel", response_model=JobRead)
def cancel_job(job_id: int):
    """
    Cancel a running or queued job.
    If running, attempts to interrupt ComfyUI.
    """
    with Session(db_engine) as session:
        job = session.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        if job.status in ["completed", "failed", "cancelled"]:
            return job

        # If running, try to interrupt via ComfyClient
        if job.status == "running":
            engine = session.get(Engine, job.engine_id)
            if engine:
                client = ComfyClient(engine)
                try:
                    client.interrupt()
                except Exception as e:
                    print(f"Failed to interrupt job {job_id}: {e}")

        job.status = "cancelled"
        session.add(job)
        session.commit()
        session.refresh(job)
        
        manager.broadcast_sync({"type": "status", "status": "cancelled", "job_id": job_id}, str(job_id))
        manager.close_job_sync(str(job_id))
        return job


@router.get("/", response_model=List[JobRead])
def read_jobs(skip: int = 0, limit: int = 100, project_id: Optional[int] = None):
    with Session(db_engine) as session:
        query = select(Job).order_by(Job.created_at.desc())
        if project_id:
            query = query.where(Job.project_id == project_id)
        return session.exec(query.offset(skip).limit(limit)).all()


@router.get("/{job_id}", response_model=JobRead)
def read_job(job_id: int):
    with Session(db_engine) as session:
        job = session.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return job


@router.websocket("/{job_id}/ws")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    """
    Real-time status updates for a specific job.
    """
    await manager.connect(websocket, job_id)
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
            manager.mark_seen(websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket, job_id)
