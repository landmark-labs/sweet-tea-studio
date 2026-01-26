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
from app.services.job_processor import process_job, signal_job_cancel
from app.services.comfy_watchdog import watchdog

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
        
        # Check if engine is online
        watchdog.ensure_engine_ready(engine)
        
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

        previous_status = job.status
        prompt_id = job.comfy_prompt_id
        engine = session.get(Engine, job.engine_id)

        # Signal any in-flight job processor loops to stop ASAP.
        signal_job_cancel(job_id)

        job.status = "cancelled"
        session.add(job)
        session.commit()
        session.refresh(job)
        
        manager.broadcast_sync({"type": "status", "status": "cancelled", "job_id": job_id}, str(job_id))
        manager.close_job_sync(str(job_id))

        # Best-effort: stop the matching prompt in ComfyUI and remove it from the queue.
        # This is critical for batch mode where multiple prompts may already be queued.
        if engine:
            try:
                client = ComfyClient(engine)
                if prompt_id:
                    result = client.cancel_prompt(prompt_id)
                    if not (result.get("deleted") or result.get("interrupted")) and previous_status == "running":
                        # Fallback: if we couldn't confidently match a running prompt, still try a global interrupt.
                        client.interrupt()
                elif previous_status == "running":
                    client.interrupt()
            except Exception as e:
                print(f"Failed to cancel ComfyUI prompt for job {job_id}: {e}")

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
    Sends current job status immediately upon connection to handle race conditions
    where the job may have already completed/failed before the client connected.
    """
    await manager.connect(websocket, job_id)
    
    # Immediately send current job status to handle race condition where job
    # may have already completed/failed before client connected
    try:
        job_id_int = int(job_id)
        with Session(db_engine) as session:
            job = session.get(Job, job_id_int)
            if job and job.status in ["completed", "failed", "cancelled"]:
                # Job already finished - send status immediately
                await websocket.send_json({
                    "type": "status",
                    "status": job.status,
                    "job_id": job_id_int
                })
                if job.status == "failed" and job.error:
                    await websocket.send_json({
                        "type": "error",
                        "message": job.error,
                        "job_id": job_id_int
                    })
    except (ValueError, Exception) as e:
        # Non-integer job_id or DB error - continue normally
        print(f"Warning: Could not check initial job status for {job_id}: {e}")
    
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
            manager.mark_seen(websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket, job_id)

