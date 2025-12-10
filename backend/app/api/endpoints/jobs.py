import os
import shutil
from fastapi import APIRouter, HTTPException, BackgroundTasks
from typing import List
from app.models.job import Job, JobCreate, JobRead
from app.models.workflow import WorkflowTemplate
from app.models.engine import Engine
from app.core.comfy_client import ComfyClient, ComfyConnectionError, ComfyResponseError
from app.services.comfy_watchdog import watchdog
from datetime import datetime
from app.core.websockets import manager
import copy
import asyncio
import random
import hashlib
from fastapi import WebSocket, WebSocketDisconnect
from sqlmodel import Session, select
from app.db.engine import engine as db_engine
from app.models.image import Image
from app.models.prompt import Prompt

router = APIRouter()

def apply_params_to_graph(graph: dict, mapping: dict, params: dict):
    for param_name, value in params.items():
        if param_name in mapping:
            target = mapping[param_name]
            node_id = target["node_id"]
            field_path = target["field"].split(".")
            
            if node_id in graph:
                current = graph[node_id]
                for part in field_path[:-1]:
                    current = current.get(part, {})
                current[field_path[-1]] = value

def process_job(job_id: int):
    with Session(db_engine) as session:
        # Re-fetch objects within session
        job = session.get(Job, job_id)
        if not job:
            return
        
        # We need engine and workflow too. 
        # Ideally we stored engine_id. 
        engine = session.get(Engine, job.engine_id)
        
        # Workflow - fetch from DB
        workflow = session.get(WorkflowTemplate, job.workflow_template_id)
        
        if not engine or not workflow:
            job.status = "failed"
            job.error = "Engine or Workflow not found during execution"
            session.commit()
            return

        try:
            job.status = "running"
            job.started_at = datetime.utcnow()
            session.add(job)
            session.commit()
            
            manager.broadcast_sync({"type": "status", "status": "running", "job_id": job_id}, str(job_id))
            
            client = ComfyClient(engine)
            final_graph = copy.deepcopy(workflow.graph_json)
            
            working_params = job.input_params.copy()
            
            # Handle random seed (-1 or "-1") for ANY parameter named like "seed"
            # This handles "seed", "seed (KSampler)", "noise_seed", etc.
            bypass_nodes = []
            for key in list(working_params.keys()):
                 if "seed" in key.lower() and str(working_params[key]) == "-1":
                     working_params[key] = random.randint(1, 1125899906842624)
                 
                 # Handle Bypassing
                 if key.startswith("__bypass_") and working_params[key] is True:
                     node_id = key.replace("__bypass_", "")
                     bypass_nodes.append(node_id)
                     # We remove it so it doesn't try to map to anything (though apply_params_to_graph handles missing keys fine)
                     del working_params[key]

            # Apply Bypass Mode (4 = Bypass in ComfyUI)
            for node_id in bypass_nodes:
                if node_id in final_graph:
                    final_graph[node_id]["mode"] = 4

            if workflow.node_mapping:
                apply_params_to_graph(final_graph, workflow.node_mapping, working_params)
            
            def on_progress(data):
                try:
                    data['job_id'] = job_id
                    manager.broadcast_sync(data, str(job_id))
                except Exception as e:
                    print(f"WebSocket broadcast failed: {e}")

            # Race Condition Fix: Connect BEFORE queuing to catch fast/cached execution events
            client.connect()
            prompt_id = client.queue_prompt(final_graph)
            job.comfy_prompt_id = prompt_id
            session.add(job)
            session.commit()
            
            manager.broadcast_sync({"type": "started", "prompt_id": prompt_id}, str(job_id))
            
            images = client.get_images(prompt_id, progress_callback=on_progress)
            
            job.status = "completed"
            job.completed_at = datetime.utcnow()
            session.add(job)

            target_output_dir = job.output_dir or engine.output_dir
            saved_images = []
            for img_data in images:
                base_dir = engine.output_dir
                if not base_dir:
                    raise ComfyResponseError("Engine output directory is not configured.")
                subfolder = img_data.get('subfolder')
                filename = img_data['filename']

                # Original path from Comfy
                full_path = os.path.join(base_dir, subfolder, filename) if subfolder else os.path.join(base_dir, filename)

                # If a custom target directory is set, move the file there
                if target_output_dir and target_output_dir != base_dir:
                    dest_dir = os.path.join(target_output_dir, subfolder) if subfolder else target_output_dir
                    os.makedirs(dest_dir, exist_ok=True)
                    dest_path = os.path.join(dest_dir, filename)
                    try:
                        shutil.copy2(full_path, dest_path)
                        full_path = dest_path
                    except FileNotFoundError:
                        print(f"Generated file missing on disk: {full_path}")
                    except OSError as e:
                        print(f"Failed to move generated file to target directory: {e}")

                # Build prompt history metadata so the latest prompt is always surfaced while retaining provenance
                # Normalize any prior history that may have come through the workflow
                incoming_metadata = working_params.get("metadata", {})
                if isinstance(incoming_metadata, str):
                    try:
                        import json
                        incoming_metadata = json.loads(incoming_metadata)
                    except Exception:
                        incoming_metadata = {}

                raw_history = incoming_metadata.get("prompt_history", [])
                prompt_history = raw_history if isinstance(raw_history, list) else []

                latest_prompt = {
                    "stage": 0,
                    "positive_text": working_params.get("prompt"),
                    "negative_text": working_params.get("negative_prompt"),
                    "timestamp": datetime.utcnow().isoformat(),
                    "source": "workflow",
                }

                stacked_history = [latest_prompt]
                for idx, entry in enumerate(prompt_history):
                    if isinstance(entry, dict):
                        stacked = entry.copy()
                        stacked.setdefault("stage", idx + 1)
                        stacked_history.append(stacked)

                image_metadata = incoming_metadata.copy()
                image_metadata["active_prompt"] = latest_prompt
                image_metadata["prompt_history"] = stacked_history

                new_image = Image(
                    job_id=job_id,
                    path=full_path,
                    filename=img_data['filename'],
                    format="png",
                    metadata=image_metadata,
                    is_kept=False
                )
                session.add(new_image)
                saved_images.append(new_image)
            
            session.commit() # Commit images and job completion
            
            # Refresh images to get IDs
            for img in saved_images:
                session.refresh(img)
                
            # Broadcast saved images (converted to dict)
            # We use jsonable_encoder or manual list
            images_payload = [
                {
                    "id": img.id,
                    "job_id": img.job_id,
                    "path": img.path,
                    "filename": img.filename,
                    "created_at": img.created_at.isoformat(),
                    "is_kept": img.is_kept
                } 
                for img in saved_images
            ]
            
            manager.broadcast_sync({"type": "completed", "images": images_payload}, str(job_id))
            print(f"Job {job_id} finished with {len(images)} images.")
            
            # Auto-Save Prompt
            if saved_images:
                pos = working_params.get("prompt", "")
                neg = working_params.get("negative_prompt", "")
                content_str = f"{pos}|{neg}".encode('utf-8')
                content_hash = hashlib.md5(content_str).hexdigest()
                
                # Check DB for existing
                stmt = select(Prompt).where(Prompt.content_hash == content_hash)
                existing_prompt = session.exec(stmt).first()
                
                final_prompt_id = None
                
                if existing_prompt:
                    existing_prompt.updated_at = datetime.utcnow()
                    session.add(existing_prompt) 
                    final_prompt_id = existing_prompt.id
                else:
                    new_prompt = Prompt(
                        workflow_id=workflow.id,
                        name=f"Auto-Saved: {pos[:30]}..." if pos else f"Auto-Saved #{job_id}",
                        description=f"Automatically saved from Job {job_id}",
                        positive_text=pos,
                        negative_text=neg,
                        content_hash=content_hash,
                        parameters=working_params,
                        preview_image_path=saved_images[0].path,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    session.add(new_prompt)
                    session.commit()
                    session.refresh(new_prompt)
                    final_prompt_id = new_prompt.id
                    print(f"Auto-saved new prompt: {new_prompt.name} (Hash: {content_hash})")
                
                if final_prompt_id:
                    job.prompt_id = final_prompt_id
                    session.add(job)
                    session.commit()
            
        except ComfyConnectionError as e:
            job.status = "failed"
            job.error = str(e)
            session.add(job)
            session.commit()
            manager.broadcast_sync({"type": "error", "message": str(e)}, str(job_id))
            print(f"Job {job_id} connection failed: {e}")

        except Exception as e:
            job.status = "failed"
            job.error = str(e)
            session.add(job)
            session.commit()
            manager.broadcast_sync({"type": "error", "message": str(e)}, str(job_id))
            print(f"Job {job_id} failed: {e}")

@router.post("/", response_model=JobRead)
def create_job(job_in: JobCreate, background_tasks: BackgroundTasks):
    with Session(db_engine) as session:
        # Validate Engine (DB)
        engine = session.get(Engine, job_in.engine_id)
        if not engine:
            raise HTTPException(status_code=404, detail="Engine not found")

        try:
            watchdog.ensure_engine_ready(engine)
        except ComfyConnectionError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        # Validate Workflow (DB)
        workflow = session.get(WorkflowTemplate, job_in.workflow_template_id)
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow template not found")
        
        job = Job.from_orm(job_in)
        session.add(job)
        session.commit()
        session.refresh(job)
        
        background_tasks.add_task(process_job, job.id)
        
        return job

@router.websocket("/{job_id}/ws")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    await manager.connect(websocket, job_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, job_id)

@router.post("/{job_id}/cancel")
async def cancel_job(job_id: int):
    with Session(db_engine) as session:
        job = session.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        
        job.status = "cancelled"
        job.completed_at = datetime.utcnow()
        session.add(job)
        session.commit()
        
        engine = session.get(Engine, job.engine_id)
        if engine:
            client = ComfyClient(engine)
            client.interrupt()
        
        await manager.broadcast({"type": "status", "status": "cancelled", "job_id": job.id}, str(job.id))
        return {"status": "cancelled"}

@router.get("/", response_model=List[JobRead])
def read_jobs(skip: int = 0, limit: int = 100):
    with Session(db_engine) as session:
        return session.exec(select(Job).offset(skip).limit(limit)).all()

@router.get("/{job_id}", response_model=JobRead)
def read_job(job_id: int):
    with Session(db_engine) as session:
         job = session.get(Job, job_id)
         if not job:
             raise HTTPException(status_code=404, detail="Job not found")
         return job
