import os
import shutil
from fastapi import APIRouter, HTTPException, BackgroundTasks
from typing import List
from app.models.job import Job, JobCreate, JobRead
from app.models.project import Project
from app.models.workflow import WorkflowTemplate
from app.models.engine import Engine

# ===== DIAGNOSTIC MODE TOGGLE =====
# Set to True to enable detailed ComfyUI communication logging
# Logs go to: backend/logs/comfy_diagnostics.log, sent_graphs/, ws_messages/
DIAGNOSTIC_MODE = True

if DIAGNOSTIC_MODE:
    from app.core.comfy_diagnostics import DiagnosticComfyClient as ComfyClient
    from app.core.comfy_client import ComfyConnectionError, ComfyResponseError
else:
    from app.core.comfy_client import ComfyClient, ComfyConnectionError, ComfyResponseError
# ===================================

from app.services.comfy_watchdog import watchdog
from datetime import datetime
from app.core.websockets import manager
from app.core.config import settings
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
            manager.broadcast_sync({"type": "error", "message": job.error}, str(job_id))
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
            
            # Helper to check schema for bypass indication
            schema = workflow.input_schema or {}
            
            for key in list(working_params.keys()):
                 # Seed Handling
                 if "seed" in key.lower() and str(working_params[key]) == "-1":
                     working_params[key] = random.randint(1, 1125899906842624)
                 
                 # Explicit Backend Bypass Key
                 if key.startswith("__bypass_") and working_params[key] is True:
                     node_id = key.replace("__bypass_", "")
                     bypass_nodes.append(node_id)
                     del working_params[key]
                     continue

                 # Schema-based Bypass Detection (matches Frontend DynamicForm logic)
                 # matches widget="toggle" AND (title starts with "bypass" OR key includes "bypass")
                 if key in schema:
                     field_def = schema[key]
                     widget = field_def.get("widget", "")
                     title = field_def.get("title", "").lower()
                     
                     is_toggle = widget == "toggle"
                     is_bypass_title = title.startswith("bypass") or "bypass" in key.lower()
                     
                     if is_toggle and is_bypass_title and working_params[key] is True:
                         # Try to find target node ID
                         # x_node_id is preferred
                         node_id = str(field_def.get("x_node_id", ""))
                         
                         if node_id:
                             bypass_nodes.append(node_id)
                             del working_params[key]

            # Apply Bypass by GRAFTING connections and REMOVING nodes from graph
            # ComfyUI validates all nodes regardless of mode, so we must remove bypassed nodes entirely
            # Before removing, we rewire connections so data flows through (A → Bypassed → C becomes A → C)
            for node_id in bypass_nodes:
                if node_id in final_graph:
                    bypassed_node = final_graph[node_id]
                    
                    # Step 1: Build pass-through map from bypassed node's inputs
                    # Maps output_slot -> upstream source [source_node_id, source_slot]
                    # Assumes 1:1 mapping: input 0 passes through to output 0, etc.
                    pass_through_map = {}
                    if "inputs" in bypassed_node:
                        slot_index = 0
                        for input_name, input_val in bypassed_node["inputs"].items():
                            if isinstance(input_val, list) and len(input_val) == 2:
                                pass_through_map[slot_index] = input_val
                                slot_index += 1
                    
                    # Step 2: Rewire downstream nodes that reference the bypassed node
                    for other_node_id, other_node in list(final_graph.items()):
                        if other_node_id == node_id:
                            continue
                        if "inputs" in other_node:
                            for inp_name, inp_val in list(other_node["inputs"].items()):
                                if isinstance(inp_val, list) and len(inp_val) == 2:
                                    if str(inp_val[0]) == str(node_id):
                                        output_slot = inp_val[1]
                                        if output_slot in pass_through_map:
                                            # Graft: connect downstream to bypassed node's upstream source
                                            other_node["inputs"][inp_name] = pass_through_map[output_slot]
                                        else:
                                            # No upstream source for this slot, remove the input
                                            del other_node["inputs"][inp_name]
                    
                    # Step 3: Remove the bypassed node from the graph
                    del final_graph[node_id]

            if workflow.node_mapping:
                apply_params_to_graph(final_graph, workflow.node_mapping, working_params)
            
            def on_progress(data):
                try:
                    data['job_id'] = job_id
                    manager.broadcast_sync(data, str(job_id))
                except Exception as e:
                    print(f"WebSocket broadcast failed: {e}")

            # Debug: Dump graph to file
            try:
                import json
                with open("debug_last_graph.json", "w") as f:
                    json.dump(final_graph, f, indent=2)
            except Exception as e:
                print(f"Failed to dump debug graph: {e}")

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

            # Determine Target Directory for saving images
            target_output_dir = None
            
            # If job has a project, use the project's output folder in ComfyUI/sweet_tea/
            if job.project_id:
                # Resolve project directory
                # We need the project slug
                project = session.get(Project, job.project_id)
                if project and engine.output_dir:
                    # Construct path: ComfyUI/sweet_tea/{slug}/output
                    # If engine.output_dir is .../ComfyUI/output, we want .../ComfyUI/sweet_tea/{slug}/output
                    # But cleaner is to use the engine's root if possible. 
                    # For now, let's assume engine.output_dir is reliable.
                    
                    # We want to step out of 'output' if it ends with it, to find 'sweet_tea' sibling?
                    # Or just use a standard convention.
                    # Let's use the logic found earlier or a simple robust path.
                    
                    # Robust: Place inside "sweet_tea/{slug}/output" relative to Comfy Root?
                    # We don't easily know Comfy Root here (only input/output dirs).
                    # But usually output_dir is "ComfyUI/output".
                    output_path = Path(engine.output_dir)
                    if output_path.name == "output":
                        base = output_path.parent
                    else:
                        base = output_path
                        
                    target_output_dir = str(base / "sweet_tea" / project.slug / "output")

                else:
                    # Fallback if no engine output dir configured
                    target_output_dir = job.output_dir
            else:
                target_output_dir = job.output_dir
            
            saved_images = []
            for img_data in images:
                filename = img_data['filename']
                
                # Determine where to save this image
                if target_output_dir:
                    save_dir = target_output_dir
                elif engine.output_dir:
                    save_dir = engine.output_dir
                else:
                    raise ComfyResponseError("No output directory configured.")
                
                os.makedirs(save_dir, exist_ok=True)
                
                # Get image bytes - either from WebSocket stream or HTTP download
                image_bytes = None
                source = img_data.get('source', 'http')
                
                if 'image_bytes' in img_data:
                    # Image came directly from WebSocket (SaveImageWebsocket node)
                    image_bytes = img_data['image_bytes']
                    print(f"Using {len(image_bytes)} bytes from WebSocket stream for {filename}")
                else:
                    # Download the image via HTTP (traditional SaveImage node)
                    img_url = img_data.get('url')
                    if img_url:
                        try:
                            import urllib.request
                            with urllib.request.urlopen(img_url, timeout=30) as response:
                                image_bytes = response.read()
                            print(f"Downloaded {len(image_bytes)} bytes from {img_url}")
                        except Exception as e:
                            print(f"Failed to download image from {img_url}: {e}")
                            # Fallback: try the old filesystem approach
                            base_dir = engine.output_dir
                            subfolder = img_data.get('subfolder', '')
                            src_path = os.path.join(base_dir, subfolder, filename) if subfolder else os.path.join(base_dir, filename)
                            if os.path.exists(src_path):
                                with open(src_path, 'rb') as f:
                                    image_bytes = f.read()
                                print(f"Read {len(image_bytes)} bytes from fallback path {src_path}")
                
                if not image_bytes:
                    print(f"WARNING: Could not get image data for {filename}, skipping")
                    continue
                
                # Process and save the image
                try:
                    import io
                    from PIL import Image as PILImage
                    
                    # Auto-convert PNG to JPG if requested (saves space, per user preference)
                    # Only convert if it's PNG. If it's already JPG/other, keep as is.
                    if filename.lower().endswith(".png"):
                        try:
                            image = PILImage.open(io.BytesIO(image_bytes))
                            # Convert to RGB (remove alpha) for JPEG
                            if image.mode in ("RGBA", "P"):
                                image = image.convert("RGB")
                            
                            # Update filename to .jpg
                            filename = os.path.splitext(filename)[0] + ".jpg"
                            full_path = os.path.join(save_dir, filename)
                            
                            # Save as high-quality JPEG
                            image.save(full_path, "JPEG", quality=95)
                            print(f"Converted and saved JPG: {full_path}")
                            
                            # Update img_data so DB record is correct
                            img_data['filename'] = filename
                            
                        except Exception as conv_e:
                            print(f"JPG conversion failed: {conv_e}. Saving original PNG.")
                            full_path = os.path.join(save_dir, filename)
                            with open(full_path, 'wb') as f:
                                f.write(image_bytes)
                    else:
                        full_path = os.path.join(save_dir, filename)
                        with open(full_path, 'wb') as f:
                            f.write(image_bytes)
                        print(f"Saved: {full_path}")
                        
                except ImportError:
                    # PIL not available - save raw bytes
                    print("PIL not available, saving raw image without conversion")
                    full_path = os.path.join(save_dir, filename)
                    with open(full_path, 'wb') as f:
                        f.write(image_bytes)


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
                # Store ALL generation parameters (every non-bypassed node's params)
                image_metadata["generation_params"] = {
                    k: v for k, v in working_params.items() 
                    if k != "metadata" and not k.startswith("__")
                }

                new_image = Image(
                    job_id=job_id,
                    path=full_path,
                    filename=img_data['filename'],
                    format="png",
                    extra_metadata=image_metadata,
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
            
            # Robust extraction of Prompt fields for Metadata/WS
            # 1. Try standard keys
            pos = working_params.get("prompt") or working_params.get("positive") or working_params.get("positive_prompt") or ""
            neg = working_params.get("negative_prompt") or working_params.get("negative") or ""
            
            # 2. Heuristic fallback for common text node outputs
            if not pos:
                for k, v in working_params.items():
                    k_low = k.lower()
                    if isinstance(v, str) and len(v) > 0 and ("positive" in k_low or "prompt" in k_low) and "neg" not in k_low and "clip" not in k_low:
                         pos = v
                         break
            if not neg:
                for k, v in working_params.items():
                    k_low = k.lower()
                    if isinstance(v, str) and len(v) > 0 and "negative" in k_low:
                         neg = v
                         break

            manager.broadcast_sync({
                "type": "completed", 
                "images": images_payload,
                "job_params": working_params, # Send the actual final params used
                "prompt": pos,
                "negative_prompt": neg
            }, str(job_id))
            print(f"Job {job_id} finished with {len(images)} images.")
            
            # Auto-Save Prompt
            if saved_images:
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
    
    # Send initial status
    try:
        with Session(db_engine) as session:
            # Check if job exists and send current status
            job = session.get(Job, int(job_id))
            if job:
                # If finished/failed already, send that
                if job.status in ["completed", "failed", "cancelled"]:
                    if job.status == "completed":
                        # We might want to send the images too if we missed them
                        # But typically 'completed' type message has images.
                        # For simplicity, just send status and let frontend refresh gallery via on_connect logic or simple polling if needed. 
                        # But wait, frontend feeds relies on "completed" message to show preview.
                        # If we missed it, we missed the preview path.
                        
                        # Re-fetch images
                        images = session.exec(select(Image).where(Image.job_id == int(job_id))).all()
                        images_payload = [
                            {
                                "id": img.id,
                                "job_id": img.job_id,
                                "path": img.path,
                                "filename": img.filename,
                                "created_at": img.created_at.isoformat(),
                                "is_kept": img.is_kept
                            } 
                            for img in images
                        ]
                        await websocket.send_json({"type": "completed", "images": images_payload})
                    
                    elif job.status == "failed":
                        await websocket.send_json({"type": "error", "message": job.error or "Job failed"})
                    
                    elif job.status == "cancelled":
                        await websocket.send_json({"type": "status", "status": "cancelled"})

                # If running
                elif job.status == "running":
                    await websocket.send_json({"type": "executing", "status": "processing"})
                    
    except Exception as e:
        print(f"Error sending initial WS status: {e}")

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
