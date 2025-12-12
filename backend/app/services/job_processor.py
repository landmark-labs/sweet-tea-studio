"""
Job Processor Service

Handles the execution of generation jobs:
- Parameter application to workflow graphs
- Node bypass logic
- ComfyUI WebSocket communication
- Image saving and metadata embedding
- Auto-saving prompts

Future considerations:
- Video generation support (VideoJob)
"""

import os
import shutil
import copy
import asyncio
import random
import hashlib
import json
from pathlib import Path
from datetime import datetime
from typing import List, Optional

from sqlmodel import Session, select
from app.models.job import Job
from app.models.project import Project
from app.models.workflow import WorkflowTemplate
from app.models.engine import Engine
from app.models.image import Image
from app.models.prompt import Prompt
from app.db.engine import engine as db_engine
from app.core.websockets import manager
from app.services.comfy_watchdog import watchdog

# ===== DIAGNOSTIC MODE TOGGLE =====
DIAGNOSTIC_MODE = True

if DIAGNOSTIC_MODE:
    from app.core.comfy_diagnostics import DiagnosticComfyClient as ComfyClient
    from app.core.comfy_client import ComfyConnectionError, ComfyResponseError
else:
    from app.core.comfy_client import ComfyClient, ComfyConnectionError, ComfyResponseError
# ===================================

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
                if project:
                    # Construct path: ComfyUI/sweet_tea/{slug}/output
                    # Find ComfyUI root from either output_dir or input_dir
                    comfy_root = None
                    
                    # Try output_dir first
                    if engine.output_dir:
                        output_path = Path(engine.output_dir)
                        if output_path.name in ("output", "input"):
                            comfy_root = output_path.parent
                        else:
                            comfy_root = output_path
                    
                    # Fallback to input_dir if output_dir didn't work
                    if not comfy_root and engine.input_dir:
                        input_path = Path(engine.input_dir)
                        if input_path.name in ("output", "input"):
                            comfy_root = input_path.parent
                        else:
                            comfy_root = input_path
                    
                    if comfy_root:
                        # Use user-selected folder from job.output_dir, default to "output" if not specified
                        folder_name = job.output_dir if job.output_dir else "output"
                        target_output_dir = str(comfy_root / "sweet_tea" / project.slug / folder_name)
                    else:
                        target_output_dir = job.output_dir
                else:
                    target_output_dir = job.output_dir
            else:
                target_output_dir = job.output_dir
            
            saved_images = []
            
            # Extract positive/negative prompts ONCE before the loop
            # Check working_params for common prompt keys, then fall back to CLIPTextEncode nodes
            pos_embed = working_params.get("prompt") or working_params.get("positive") or working_params.get("positive_prompt") or ""
            neg_embed = working_params.get("negative_prompt") or working_params.get("negative") or ""
            
            if not pos_embed or not neg_embed:
                clip_nodes = []
                for node_id, node_data in final_graph.items():
                    if node_data.get("class_type") == "CLIPTextEncode":
                        text = node_data.get("inputs", {}).get("text", "")
                        if isinstance(text, str) and text.strip():
                            clip_nodes.append({
                                "node_id": node_id,
                                "text": text,
                                "title": node_data.get("_meta", {}).get("title", "")
                            })
                
                for cn in clip_nodes:
                    title_lower = cn["title"].lower()
                    text = cn["text"]
                    if ("negative" in title_lower or "neg" in title_lower) and not neg_embed:
                        neg_embed = text
                    elif not pos_embed:
                        pos_embed = text
                
                # Fallback: first two CLIPTextEncode nodes
                if not pos_embed and len(clip_nodes) >= 1:
                    pos_embed = clip_nodes[0]["text"]
                if not neg_embed and len(clip_nodes) >= 2:
                    neg_embed = clip_nodes[1]["text"]
            
            # Determine the base filename prefix from project slug (if available)
            filename_prefix = project.slug if 'project' in dir() and project else f"gen_{job_id}"
            
            # Find the next available sequence number by checking existing files
            next_seq = 1
            if target_output_dir and os.path.exists(target_output_dir):
                import re
                existing_files = os.listdir(target_output_dir)
                pattern = re.compile(rf"^{re.escape(filename_prefix)}_(\d+)\.(jpg|jpeg|png)$", re.IGNORECASE)
                for f in existing_files:
                    match = pattern.match(f)
                    if match:
                        num = int(match.group(1))
                        if num >= next_seq:
                            next_seq = num + 1
            
            for idx, img_data in enumerate(images):
                # Generate sequential filename: project-slug_0001.jpg
                seq_num = next_seq + idx
                original_ext = img_data['filename'].rsplit('.', 1)[-1].lower() if '.' in img_data['filename'] else 'jpg'
                filename = f"{filename_prefix}_{seq_num:04d}.{original_ext}"
                
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
                    # Image came directly from WebSocket
                    image_bytes = img_data['image_bytes']
                else:
                    # Download via HTTP
                    img_url = img_data.get('url')
                    if img_url:
                        try:
                            import urllib.request
                            with urllib.request.urlopen(img_url, timeout=30) as response:
                                image_bytes = response.read()
                        except Exception as e:
                            print(f"Failed to download image from {img_url}: {e}")
                            # Fallback: try the old filesystem approach
                            base_dir = engine.output_dir
                            subfolder = img_data.get('subfolder', '')
                            src_path = os.path.join(base_dir, subfolder, filename) if subfolder else os.path.join(base_dir, filename)
                            if os.path.exists(src_path):
                                with open(src_path, 'rb') as f:
                                    image_bytes = f.read()
                
                if not image_bytes:
                    continue
                
                # Process and save the image
                try:
                    import io
                    from PIL import Image as PILImage
                    
                    # Auto-convert PNG to JPG if requested
                    if filename.lower().endswith(".png"):
                        try:
                            image = PILImage.open(io.BytesIO(image_bytes))
                            if image.mode in ("RGBA", "P"):
                                image = image.convert("RGB")
                            
                            filename = os.path.splitext(filename)[0] + ".jpg"
                            full_path = os.path.join(save_dir, filename)
                            image.save(full_path, "JPEG", quality=95)
                            
                            img_data['filename'] = filename
                            
                        except Exception as conv_e:
                            full_path = os.path.join(save_dir, filename)
                            with open(full_path, 'wb') as f:
                                f.write(image_bytes)
                    else:
                        full_path = os.path.join(save_dir, filename)
                        with open(full_path, 'wb') as f:
                            f.write(image_bytes)
                    
                    # Embed provenance metadata
                    provenance_data = {
                        "positive_prompt": pos_embed,
                        "negative_prompt": neg_embed,
                        "workflow_id": workflow.id,
                        "workflow_name": workflow.name if hasattr(workflow, 'name') else None,
                        "job_id": job_id,
                        "timestamp": datetime.utcnow().isoformat(),
                        "params": {k: v for k, v in working_params.items() if k != "metadata" and not k.startswith("__")}
                    }
                    
                    try:
                        import json
                        provenance_json = json.dumps(provenance_data, ensure_ascii=False)
                        
                        with PILImage.open(full_path) as img_embed:
                            fmt = (img_embed.format or "").upper()
                            if fmt in ("JPEG", "JPG"):
                                # Try EXIF UserComment
                                try:
                                    import piexif
                                    exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}}
                                    user_comment = piexif.helper.UserComment.dump(provenance_json, encoding="unicode")
                                    exif_dict["Exif"][piexif.ExifIFD.UserComment] = user_comment
                                    exif_dict["0th"][piexif.ImageIFD.ImageDescription] = provenance_json.encode("utf-8")
                                    exif_bytes = piexif.dump(exif_dict)
                                    img_embed.save(full_path, "JPEG", quality=95, exif=exif_bytes)
                                except ImportError:
                                    img_embed.save(full_path, "JPEG", quality=95, comment=provenance_json.encode("utf-8"))
                                    
                                    # Also save a sidecar JSON file
                                    sidecar_path = full_path.rsplit(".", 1)[0] + ".json"
                                    with open(sidecar_path, "w", encoding="utf-8") as sf:
                                        sf.write(provenance_json)
                                    
                            elif fmt == "PNG":
                                from PIL import PngImagePlugin
                                png_info = PngImagePlugin.PngInfo()
                                png_info.add_text("Comment", provenance_json)
                                png_info.add_text("Description", provenance_json)
                                img_embed.save(full_path, pnginfo=png_info)
                    except Exception as embed_err:
                        print(f"Failed to embed metadata: {embed_err}")
                        
                except ImportError:
                    # PIL not available
                    full_path = os.path.join(save_dir, filename)
                    with open(full_path, 'wb') as f:
                        f.write(image_bytes)


                # Build prompt history metadata
                incoming_metadata = working_params.get("metadata", {})
                if isinstance(incoming_metadata, str):
                    try:
                        incoming_metadata = json.loads(incoming_metadata)
                    except Exception:
                        incoming_metadata = {}

                raw_history = incoming_metadata.get("prompt_history", [])
                prompt_history = raw_history if isinstance(raw_history, list) else []

                latest_prompt = {
                    "stage": 0,
                    "positive_text": pos_embed,
                    "negative_text": neg_embed,
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
            
            session.commit()
            
            for img in saved_images:
                session.refresh(img)
                
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
            
            manager.broadcast_sync({
                "type": "completed", 
                "images": images_payload,
                "job_params": working_params,
                "prompt": pos_embed,
                "negative_prompt": neg_embed
            }, str(job_id))
            
            # Auto-Save Prompt
            if saved_images:
                content_str = f"{pos_embed}|{neg_embed}".encode('utf-8')
                content_hash = hashlib.md5(content_str).hexdigest()
                
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
                        name=f"Auto-Saved: {pos_embed[:30]}..." if pos_embed else f"Auto-Saved #{job_id}",
                        description=f"Automatically saved from Job {job_id}",
                        positive_text=pos_embed,
                        negative_text=neg_embed,
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

        except Exception as e:
            job.status = "failed"
            job.error = str(e)
            session.add(job)
            session.commit()
            manager.broadcast_sync({"type": "error", "message": str(e)}, str(job_id))
