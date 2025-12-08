from fastapi import APIRouter, HTTPException, BackgroundTasks
from typing import List
from app.models.job import Job, JobCreate, JobRead
from app.models.workflow import WorkflowTemplate
from app.models.engine import Engine
from app.core.comfy_client import ComfyClient, ComfyConnectionError, ComfyResponseError
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
            
            asyncio.run(manager.broadcast({"type": "status", "status": "running", "job_id": job_id}, str(job_id)))
            
            client = ComfyClient(engine)
            final_graph = copy.deepcopy(workflow.graph_json)
            
            working_params = job.input_params.copy()
            if working_params.get("seed") == -1:
                working_params["seed"] = random.randint(1, 1125899906842624)
                
            if workflow.node_mapping:
                apply_params_to_graph(final_graph, workflow.node_mapping, working_params)
            
            def on_progress(data):
                try:
                    data['job_id'] = job_id
                    asyncio.run(manager.broadcast(data, str(job_id)))
                except Exception as e:
                    print(f"WebSocket broadcast failed: {e}")

            prompt_id = client.queue_prompt(final_graph)
            job.comfy_prompt_id = prompt_id
            session.add(job)
            session.commit()
            
            asyncio.run(manager.broadcast({"type": "started", "prompt_id": prompt_id}, str(job_id)))
            
            images = client.get_images(prompt_id, progress_callback=on_progress)
            
            job.status = "completed"
            job.completed_at = datetime.utcnow()
            session.add(job)
            
            asyncio.run(manager.broadcast({"type": "completed", "images": images}, str(job_id)))
            
            saved_image_paths = []
            for img_data in images:
                full_path = f"{engine.output_dir}\\{img_data['subfolder']}\\{img_data['filename']}" if img_data.get('subfolder') else f"{engine.output_dir}\\{img_data['filename']}"
                
                new_image = Image(
                    job_id=job_id,
                    path=full_path,
                    filename=img_data['filename'],
                    format="png"
                )
                session.add(new_image)
                saved_image_paths.append(full_path)
            
            session.commit() # Commit images and job completion
            print(f"Job {job_id} finished with {len(images)} images.")
            
            # Auto-Save Prompt
            if saved_image_paths:
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
                        preview_image_path=saved_image_paths[0],
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
            asyncio.run(manager.broadcast({"type": "error", "message": str(e)}, str(job_id)))
            print(f"Job {job_id} connection failed: {e}")

        except Exception as e:
            job.status = "failed"
            job.error = str(e)
            session.add(job)
            session.commit()
            asyncio.run(manager.broadcast({"type": "error", "message": str(e)}, str(job_id)))
            print(f"Job {job_id} failed: {e}")

@router.post("/", response_model=JobRead)
def create_job(job_in: JobCreate, background_tasks: BackgroundTasks):
    with Session(db_engine) as session:
        # Validate Engine (DB)
        engine = session.get(Engine, job_in.engine_id)
        if not engine:
            raise HTTPException(status_code=404, detail="Engine not found")

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
