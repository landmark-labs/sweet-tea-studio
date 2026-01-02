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
import re
import threading
import time
from pathlib import Path
from datetime import datetime
from typing import List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

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
from app.services.gallery_search import build_search_text, update_gallery_fts

# ===== DIAGNOSTIC MODE TOGGLE =====
DIAGNOSTIC_MODE = False
PREVIEW_DEBUG = os.getenv("SWEET_TEA_PREVIEW_DEBUG", "").lower() in ("1", "true", "yes")
DUMP_GRAPH = os.getenv("SWEET_TEA_DUMP_GRAPH", "").lower() in ("1", "true", "yes")

if DIAGNOSTIC_MODE:
    from app.core.comfy_diagnostics import DiagnosticComfyClient as ComfyClient
    from app.core.comfy_client import ComfyConnectionError, ComfyResponseError
else:
    from app.core.comfy_client import ComfyClient, ComfyConnectionError, ComfyResponseError
# ===================================

_sequence_cache: dict[str, dict[str, float | int]] = {}
_sequence_lock = threading.Lock()
_sequence_pattern_cache: dict[str, dict[str, object]] = {}
_sequence_cache_last_prune = 0.0
_sequence_cache_max = int(os.getenv("SWEET_TEA_SEQ_CACHE_MAX", "512"))
_sequence_pattern_cache_max = int(os.getenv("SWEET_TEA_SEQ_PATTERN_CACHE_MAX", "512"))
_sequence_cache_ttl_s = int(os.getenv("SWEET_TEA_SEQ_CACHE_TTL_S", "3600"))
_sequence_cache_prune_interval_s = int(os.getenv("SWEET_TEA_SEQ_CACHE_PRUNE_INTERVAL_S", "60"))


def _prune_sequence_caches(now: float) -> None:
    global _sequence_cache_last_prune
    if now - _sequence_cache_last_prune < _sequence_cache_prune_interval_s:
        return

    _sequence_cache_last_prune = now

    def prune(cache: dict[str, dict[str, object]], max_items: int) -> None:
        expired = [
            key for key, entry in cache.items()
            if now - float(entry.get("last_used", now)) > _sequence_cache_ttl_s
        ]
        for key in expired:
            cache.pop(key, None)

        if len(cache) <= max_items:
            return

        ordered = sorted(
            cache.items(),
            key=lambda item: float(item[1].get("last_used", now)),
        )
        for key, _entry in ordered[: max(0, len(cache) - max_items)]:
            cache.pop(key, None)

    prune(_sequence_cache, _sequence_cache_max)
    prune(_sequence_pattern_cache, _sequence_pattern_cache_max)


def get_sequence_cache_stats() -> dict:
    with _sequence_lock:
        now = time.time()
        def stats(cache: dict[str, dict[str, object]]) -> dict:
            if not cache:
                return {"count": 0, "oldest_age_s": None, "newest_age_s": None}
            ages = [now - float(entry.get("last_used", now)) for entry in cache.values()]
            return {
                "count": len(cache),
                "oldest_age_s": int(max(ages)),
                "newest_age_s": int(min(ages)),
            }

        return {
            "sequence_cache": stats(_sequence_cache),
            "pattern_cache": stats(_sequence_pattern_cache),
        }


def _get_next_sequence_start(session: Session, filename_prefix: str, reserve: int) -> int:
    """
    Quickly determine the next sequence number for a filename prefix.
    Uses the Image table (latest 100 rows) and an in-memory cache to avoid
    slow directory scans when folders contain thousands of files.
    """
    if reserve <= 0:
        return 0

    with _sequence_lock:
        now = time.time()
        _prune_sequence_caches(now)

        cached = _sequence_cache.get(filename_prefix)
        if cached is not None:
            start = int(cached.get("next", 0))
            cached["next"] = start + reserve
            cached["last_used"] = now
            return start

        pattern_entry = _sequence_pattern_cache.get(filename_prefix)
        if pattern_entry is None:
            pattern = re.compile(
                rf"^{re.escape(filename_prefix)}-(\d+)\.(jpg|jpeg|png|webp|gif|mp4|webm|mov|mkv|avi)$",
                re.IGNORECASE
            )
            _sequence_pattern_cache[filename_prefix] = {"pattern": pattern, "last_used": now}
        else:
            pattern_entry["last_used"] = now
            pattern = pattern_entry.get("pattern")
            if not pattern:
                pattern = re.compile(
                    rf"^{re.escape(filename_prefix)}-(\d+)\.(jpg|jpeg|png|webp|gif|mp4|webm|mov|mkv|avi)$",
                    re.IGNORECASE
                )
                _sequence_pattern_cache[filename_prefix] = {"pattern": pattern, "last_used": now}

        max_seq = -1
        stmt = (
            select(Image.filename)
            .where(Image.filename.like(f"{filename_prefix}-%"))
            .order_by(Image.created_at.desc())
            .limit(100)
        )
        for row in session.exec(stmt):
            match = pattern.match(row)
            if match:
                max_seq = max(max_seq, int(match.group(1)))
                if max_seq >= 0:
                    break

        start = (max_seq + 1) if max_seq >= 0 else 0
        _sequence_cache[filename_prefix] = {"next": start + reserve, "last_used": now}
        return start

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


def _build_node_mapping_from_schema(schema: dict) -> dict:
    mapping: dict[str, dict[str, str]] = {}
    for key, field_def in schema.items():
        if not isinstance(key, str) or key.startswith("__"):
            continue
        if not isinstance(field_def, dict):
            continue
        node_id = field_def.get("x_node_id")
        if node_id is None:
            continue
        input_name = field_def.get("mock_field")
        if not isinstance(input_name, str) or not input_name.strip():
            input_name = key.split(".")[-1]
        mapping[key] = {
            "node_id": str(node_id),
            "field": f"inputs.{input_name}",
        }
    return mapping


def _coerce_numeric_value(value: object, field_type: str) -> object | None:
    if isinstance(value, bool):
        return None

    if field_type in ("integer", "int"):
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value) if value.is_integer() else None
        if isinstance(value, str):
            text = value.strip()
            if text in ("", "-", ".", "-."):
                return None
            try:
                return int(text)
            except ValueError:
                try:
                    as_float = float(text)
                except ValueError:
                    return None
                return int(as_float) if as_float.is_integer() else None
        return None

    if field_type in ("number", "float"):
        if isinstance(value, (int, float)):
            return value
        if isinstance(value, str):
            text = value.strip()
            if text in ("", "-", ".", "-."):
                return None
            try:
                return float(text)
            except ValueError:
                return None

    return None


def _coerce_params_with_schema(schema: dict, params: dict) -> dict:
    if not isinstance(params, dict):
        return {}

    if not isinstance(schema, dict) or not schema:
        return dict(params)

    coerced = dict(params)
    for key, value in params.items():
        if not isinstance(key, str):
            continue
        field = schema.get(key)
        if not isinstance(field, dict):
            continue
        field_type = str(field.get("type", "")).lower()
        coerced_value = _coerce_numeric_value(value, field_type)
        if coerced_value is not None:
            coerced[key] = coerced_value

    return coerced


def _create_thumbnail(image_path: str, max_px: int = 256, quality: int = 45) -> tuple[bytes | None, int | None, int | None]:
    """
    Generate a compact JPEG thumbnail suitable for inline DB storage.
    Returns (thumbnail_bytes, width, height).
    Typically produces thumbnails of 5-15KB for 256px max dimension.
    """
    import io
    try:
        from PIL import Image as PILImage
        with PILImage.open(image_path) as img:
            width, height = img.size
            img.thumbnail((max_px, max_px))
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality)
            return buf.getvalue(), width, height
    except Exception as e:
        print(f"[Thumbnail] Failed to create thumbnail for {image_path}: {e}")
        return None, None, None


def _process_single_image(
    img_data: dict,
    idx: int,
    save_dir: str,
    filename: str,
    provenance_json: str,
    xp_comment_bytes: bytes,
    engine_output_dir: str | None,
    engine_root_dir: str | None,
    xp_title_bytes: bytes | None = None,
    xp_subject_bytes: bytes | None = None,
) -> tuple[str, str, int] | None:
    """
    Process a single image: download, convert PNG->JPG, save, embed metadata.
    Returns (full_path, final_filename, idx) on success, None on failure.
    This function is thread-safe and designed for parallel execution.
    """
    import io
    import urllib.request
    
    try:
        from PIL import Image as PILImage
        pil_available = True
    except ImportError:
        pil_available = False
    
    # Get image bytes
    image_bytes = None
    if 'image_bytes' in img_data:
        image_bytes = img_data['image_bytes']
    else:
        # Prefer local filesystem reads (ComfyUI usually runs on the same machine/container).
        orig_filename = img_data.get('filename', filename)
        subfolder = img_data.get('subfolder', '')
        img_type = img_data.get('type')  # e.g. "output", "temp"

        base_dir = None
        if engine_root_dir and img_type:
            candidate = os.path.join(engine_root_dir, str(img_type))
            if os.path.isdir(candidate):
                base_dir = candidate
        if not base_dir and engine_output_dir:
            base_dir = engine_output_dir

        if base_dir:
            src_path = os.path.join(base_dir, subfolder, orig_filename) if subfolder else os.path.join(base_dir, orig_filename)
            if os.path.exists(src_path):
                try:
                    with open(src_path, 'rb') as f:
                        image_bytes = f.read()
                except Exception:
                    image_bytes = None

        # Fall back to HTTP fetch (remote ComfyUI or unknown paths).
        if not image_bytes:
            img_url = img_data.get('url')
            if img_url:
                try:
                    with urllib.request.urlopen(img_url, timeout=30) as response:
                        image_bytes = response.read()
                except Exception as e:
                    print(f"Failed to download image from {img_url}: {e}")
    
    if not image_bytes:
        return None

    final_filename = filename
    full_path = os.path.join(save_dir, final_filename)

    # Process and save (single write path)
    if pil_available:
        try:
            image = PILImage.open(io.BytesIO(image_bytes))
            target_format = (image.format or "").upper() or "PNG"

            # Auto-convert PNG to JPG for faster writes and smaller files
            if filename.lower().endswith(".png"):
                if image.mode in ("RGBA", "P"):
                    image = image.convert("RGB")
                final_filename = os.path.splitext(filename)[0] + ".jpg"
                target_format = "JPEG"
                full_path = os.path.join(save_dir, final_filename)
            else:
                full_path = os.path.join(save_dir, final_filename)

            exif_bytes = None
            png_info = None
            sidecar_json: str | None = None

            if target_format in ("JPEG", "JPG"):
                try:
                    import piexif
                    # Check if piexif.helper exists (some versions don't have it)
                    if not hasattr(piexif, 'helper'):
                        raise AttributeError("piexif.helper not available")
                    exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}}

                    # XPTitle (0x9C9B) - Project name
                    if xp_title_bytes:
                        exif_dict["0th"][0x9C9B] = xp_title_bytes

                    # XPSubject (0x9C9F) - Destination folder
                    if xp_subject_bytes:
                        exif_dict["0th"][0x9C9F] = xp_subject_bytes

                    # XPComment (0x9C9C) - Full generation params
                    exif_dict["0th"][0x9C9C] = xp_comment_bytes

                    exif_bytes = piexif.dump(exif_dict)
                except (ImportError, AttributeError):
                    # piexif not available - use Pillow's native EXIF support
                    try:
                        exif_data = image.getexif()

                        # XPTitle (0x9C9B) - Project name
                        if xp_title_bytes:
                            exif_data[0x9C9B] = xp_title_bytes

                        # XPSubject (0x9C9F) - Destination folder
                        if xp_subject_bytes:
                            exif_data[0x9C9F] = xp_subject_bytes

                        # XPComment (0x9C9C) - Full generation params
                        exif_data[0x9C9C] = xp_comment_bytes

                        exif_bytes = exif_data.tobytes()
                    except Exception as pillow_exif_err:
                        print(f"Pillow EXIF failed: {pillow_exif_err}, falling back to sidecar")
                        sidecar_json = provenance_json
                except Exception as embed_err:
                    print(f"Failed to build EXIF: {embed_err}")
            elif target_format == "PNG":
                try:
                    from PIL import PngImagePlugin
                    png_info = PngImagePlugin.PngInfo()
                    png_info.add_text("Comment", provenance_json)
                    png_info.add_text("Description", provenance_json)
                except Exception as embed_err:
                    print(f"Failed to prepare PNG metadata: {embed_err}")
            else:
                # Unsupported formats still get a sidecar to preserve provenance
                sidecar_json = provenance_json

            save_kwargs = {}
            if exif_bytes:
                save_kwargs["exif"] = exif_bytes
            if png_info:
                save_kwargs["pnginfo"] = png_info
            if target_format in ("JPEG", "JPG"):
                save_kwargs["quality"] = 95

            image.save(full_path, target_format, **save_kwargs)

            if sidecar_json:
                sidecar_path = full_path.rsplit(".", 1)[0] + ".json"
                with open(sidecar_path, "w", encoding="utf-8") as sf:
                    sf.write(sidecar_json)

        except Exception as e:
            print(f"PIL processing failed: {e}")
            full_path = os.path.join(save_dir, final_filename)
            with open(full_path, 'wb') as f:
                f.write(image_bytes)
    else:
        full_path = os.path.join(save_dir, final_filename)
        with open(full_path, 'wb') as f:
            f.write(image_bytes)
    
    return (full_path, final_filename, idx)


def _process_single_video(
    video_data: dict,
    idx: int,
    save_dir: str,
    filename: str,
    provenance_json: str,
    engine_output_dir: str | None,
    engine_root_dir: str | None,
) -> tuple[str, str, int] | None:
    """
    Process a single video: copy from ComfyUI output/temp or download via URL.
    Returns (full_path, final_filename, idx) on success, None on failure.
    """
    import urllib.request

    print(f"[Video] Processing video idx={idx}, video_data={video_data}")
    
    orig_filename = os.path.basename(video_data.get("filename") or filename)
    subfolder = video_data.get("subfolder", "")
    video_type = video_data.get("type")  # e.g. "output", "temp"

    print(f"[Video] orig_filename={orig_filename}, subfolder={subfolder}, type={video_type}")
    print(f"[Video] engine_root_dir={engine_root_dir}, engine_output_dir={engine_output_dir}")

    base_dir = None
    if engine_root_dir and video_type:
        candidate = os.path.join(engine_root_dir, str(video_type))
        print(f"[Video] Checking candidate base_dir: {candidate}")
        if os.path.isdir(candidate):
            base_dir = candidate
            print(f"[Video] Using base_dir: {base_dir}")
        else:
            print(f"[Video] Candidate dir does not exist: {candidate}")
    if not base_dir and engine_output_dir:
        base_dir = engine_output_dir
        print(f"[Video] Falling back to engine_output_dir: {base_dir}")

    full_path = os.path.join(save_dir, filename)
    print(f"[Video] Target full_path: {full_path}")
    
    copied_successfully = False

    if base_dir:
        src_path = os.path.join(base_dir, subfolder, orig_filename) if subfolder else os.path.join(base_dir, orig_filename)
        print(f"[Video] Attempting to copy from: {src_path}")
        if os.path.exists(src_path):
            try:
                shutil.copy2(src_path, full_path)
                copied_successfully = True
                print(f"[Video] Successfully copied {src_path} to {full_path}")
            except Exception as e:
                print(f"[Video] Failed to copy {src_path} to {full_path}: {e}")
                return None
        else:
            print(f"[Video] Source file does not exist: {src_path}")

    if not copied_successfully:
        video_url = video_data.get("url")
        print(f"[Video] Attempting URL download: {video_url}")
        if not video_url:
            print(f"[Video] No URL available, cannot retrieve video")
            return None
        try:
            with urllib.request.urlopen(video_url, timeout=60) as response:
                with open(full_path, "wb") as f:
                    f.write(response.read())
            print(f"[Video] Successfully downloaded video to {full_path}")
        except Exception as e:
            print(f"[Video] Failed to download video from {video_url}: {e}")
            return None

    if provenance_json:
        try:
            sidecar_path = full_path.rsplit(".", 1)[0] + ".json"
            with open(sidecar_path, "w", encoding="utf-8") as sf:
                sf.write(provenance_json)
            print(f"[Video] Wrote sidecar to {sidecar_path}")
        except Exception as e:
            print(f"[Video] Failed to write sidecar for {full_path}: {e}")

    return (full_path, filename, idx)

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
            manager.close_job_sync(str(job_id))
            return

        try:
            schema = workflow.input_schema or {}
            working_params = _coerce_params_with_schema(schema, job.input_params or {})
            if working_params != job.input_params:
                job.input_params = working_params

            job.status = "running"
            job.started_at = datetime.utcnow()
            session.add(job)
            session.commit()
            
            manager.broadcast_sync({"type": "status", "status": "running", "job_id": job_id}, str(job_id))
            
            client = ComfyClient(engine)
            final_graph = copy.deepcopy(workflow.graph_json)
            
            # Handle random seed (-1 or "-1") for ANY parameter named like "seed"
            # This handles "seed", "seed (KSampler)", "noise_seed", etc.
            bypass_nodes = []
            
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

            node_mapping = workflow.node_mapping if isinstance(workflow.node_mapping, dict) else {}
            node_mapping = dict(node_mapping) if node_mapping else {}
            schema = workflow.input_schema or {}
            if schema:
                fallback_mapping = _build_node_mapping_from_schema(schema)
                for key, mapping in fallback_mapping.items():
                    node_mapping.setdefault(key, mapping)

            if node_mapping:
                apply_params_to_graph(final_graph, node_mapping, working_params)
            
            def on_progress(data):
                try:
                    if data.get('type') == 'preview':
                        # Log preview to debug missing frames
                        if PREVIEW_DEBUG:
                            print(f"[JobProcessor] Broadcasting preview for job {job_id}. Blob len: {len(data.get('data', {}).get('blob', ''))}")
                    
                    data['job_id'] = job_id
                    manager.broadcast_sync(data, str(job_id))
                except Exception as e:
                    print(f"WebSocket broadcast failed: {e}")

            # Debug: Dump graph to file
            if DUMP_GRAPH:
                try:
                    with open("debug_last_graph.json", "w") as f:
                        json.dump(final_graph, f, indent=2)
                except Exception as e:
                    print(f"Failed to dump debug graph: {e}")

            # Race Condition Fix: Connect BEFORE queuing to catch fast/cached execution events
            # Race Condition Fix: Connect BEFORE queuing to catch fast/cached execution events
            client.connect()
            
            # --- START PRE-CALCULATION OF META/DIRS (Moved from post-execution) ---
            # Determine Target Directory for saving images
            target_output_dir = None
            if job.project_id:
                project = session.get(Project, job.project_id)
                if project:
                    folder_name = job.output_dir if job.output_dir else "output"
                    if folder_name == "output":
                        if engine.output_dir:
                            output_path = Path(engine.output_dir)
                            if output_path.name in ("output", "input"):
                                comfy_root = output_path.parent
                            else:
                                comfy_root = output_path
                            target_output_dir = str(comfy_root / "sweet_tea" / project.slug / "output")
                        else:
                            target_output_dir = job.output_dir
                    else:
                        if engine.input_dir:
                            target_output_dir = str(Path(engine.input_dir) / project.slug / folder_name)
                        else:
                            if engine.output_dir:
                                output_path = Path(engine.output_dir)
                                if output_path.name in ("output", "input"):
                                    comfy_root = output_path.parent
                                else:
                                    comfy_root = output_path
                                target_output_dir = str(comfy_root / "sweet_tea" / project.slug / folder_name)
                            else:
                                target_output_dir = job.output_dir
                else:
                    target_output_dir = job.output_dir
            else:
                target_output_dir = job.output_dir

            # Determine save_dir once
            if target_output_dir:
                save_dir = target_output_dir
            elif engine.output_dir:
                save_dir = engine.output_dir
            else:
                raise ComfyResponseError("No output directory configured.")
            
            # Ensure safe directory
            os.makedirs(save_dir, exist_ok=True)

            # Best-effort ComfyUI root dir
            engine_root_dir: str | None = None
            try:
                base_path = None
                if engine.output_dir:
                    base_path = Path(engine.output_dir)
                elif engine.input_dir:
                    base_path = Path(engine.input_dir)
                if base_path:
                    engine_root_dir = str(base_path.parent if base_path.name in ("output", "input") else base_path)
            except Exception:
                engine_root_dir = None
            
            # Setup Provenance Data
            pos_embed = working_params.get("prompt") or working_params.get("positive") or working_params.get("positive_prompt") or ""
            neg_embed = working_params.get("negative_prompt") or working_params.get("negative") or ""
            
            if not pos_embed or not neg_embed:
                string_literal_values = []
                for key, value in working_params.items():
                    if isinstance(value, str) and value.strip():
                        key_lower = key.lower()
                        if "string_literal" in key_lower or (".string" in key_lower and "lora" not in key_lower):
                            string_literal_values.append({"key": key, "value": value})
                string_literal_values.sort(key=lambda x: x["key"])
                if string_literal_values:
                    if not pos_embed and len(string_literal_values) >= 1:
                        pos_embed = string_literal_values[0]["value"]
                    if not neg_embed and len(string_literal_values) >= 2:
                        neg_embed = string_literal_values[1]["value"]

            if not pos_embed or not neg_embed:
                clip_nodes = []
                for node_id, node_data in final_graph.items():
                    class_type = node_data.get("class_type", "")
                    if class_type == "CLIPTextEncode":
                        text = node_data.get("inputs", {}).get("text", "")
                        if isinstance(text, str) and text.strip():
                            clip_nodes.append({"node_id": node_id, "text": text, "title": node_data.get("_meta", {}).get("title", "")})
                    if "string" in class_type.lower() and "literal" in class_type.lower():
                        text = node_data.get("inputs", {}).get("string", "")
                        if isinstance(text, str) and text.strip():
                            clip_nodes.append({"node_id": node_id, "text": text, "title": node_data.get("_meta", {}).get("title", "")})
                
                for cn in clip_nodes:
                    title_lower = cn["title"].lower()
                    text = cn["text"]
                    if ("negative" in title_lower or "neg" in title_lower) and not neg_embed:
                        neg_embed = text
                    elif not pos_embed:
                        pos_embed = text
                if not pos_embed and len(clip_nodes) >= 1:
                    pos_embed = clip_nodes[0]["text"]
                if not neg_embed and len(clip_nodes) >= 2:
                    neg_embed = clip_nodes[1]["text"]

            folder_name = job.output_dir if job.output_dir else "output"
            # Re-fetch Project if needed (ensure bound to session)
            project_obj = session.get(Project, job.project_id) if job.project_id else None
            filename_prefix = f"{project_obj.slug}-{folder_name}" if project_obj else f"gen_{job_id}"
            
            provenance_data = {
                "positive_prompt": pos_embed,
                "negative_prompt": neg_embed,
                "workflow_id": workflow.id,
                "workflow_name": workflow.name if hasattr(workflow, 'name') else None,
                "job_id": job_id,
                "timestamp": datetime.utcnow().isoformat(),
                "params": {k: v for k, v in working_params.items() if k != "metadata" and not k.startswith("__")}
            }
            provenance_json = json.dumps(provenance_data, ensure_ascii=False)
            xp_comment_bytes = provenance_json.encode("utf-16le") + b"\x00\x00"
            video_provenance = dict(provenance_data)
            video_provenance["media_kind"] = "video"
            video_provenance_json = json.dumps(video_provenance, ensure_ascii=False)
            
            xp_title_bytes: bytes | None = None
            if project_obj and project_obj.name:
                xp_title_bytes = project_obj.name.encode("utf-16le") + b"\x00\x00"

            xp_subject_bytes: bytes | None = None
            if folder_name:
                xp_subject_bytes = str(folder_name).encode("utf-16le") + b"\x00\x00"

            # --- END PRE-CALCULATION ---

            # Callback for streaming
            processed_filenames = set()
            saved_media = []
            
            # Setup image metadata once
            incoming_metadata = working_params.get("metadata", {})
            if isinstance(incoming_metadata, str):
                try:
                    incoming_metadata = json.loads(incoming_metadata)
                except Exception:
                    incoming_metadata = {}
            raw_history = incoming_metadata.get("prompt_history", [])
            prompt_history = raw_history if isinstance(raw_history, list) else []
            latest_prompt = { "stage": 0, "positive_text": pos_embed, "negative_text": neg_embed, "timestamp": datetime.utcnow().isoformat(), "source": "workflow" }
            stacked_history = [latest_prompt]
            for hist_idx, entry in enumerate(prompt_history):
                if isinstance(entry, dict):
                    stacked = entry.copy()
                    stacked.setdefault("stage", hist_idx + 1)
                    stacked_history.append(stacked)
            image_metadata = incoming_metadata.copy()
            image_metadata["active_prompt"] = latest_prompt
            image_metadata["prompt_history"] = stacked_history
            image_metadata["generation_params"] = {k: v for k, v in working_params.items() if k != "metadata" and not k.startswith("__")}
            
            param_width = None
            param_height = None
            if isinstance(working_params, dict):
                param_width = working_params.get("width") or working_params.get("empty_latent_width")
                param_height = working_params.get("height") or working_params.get("empty_latent_height")

            def on_image_captured(img_data: dict):
                try:
                    # Determine filename with sequence
                    seq_num = _get_next_sequence_start(session, filename_prefix, 1)
                    original_name = os.path.basename(img_data.get("filename") or "")
                    
                    # Store original filename to avoid post-processing duplicates
                    # ComfyClient sends the 'filename' it captured
                    processed_filenames.add(original_name)
                    
                    original_ext = original_name.rsplit('.', 1)[-1].lower() if '.' in original_name else "png"
                    final_filename = f"{filename_prefix}-{seq_num:04d}.{original_ext}"
                    
                    # Process and Save
                    result = _process_single_image(
                        img_data, 0, save_dir, final_filename, provenance_json, xp_comment_bytes, 
                        engine.output_dir, engine_root_dir, xp_title_bytes, xp_subject_bytes
                    )
                    
                    if result:
                        full_path, saved_filename, _ = result
                        
                        # Create DB Record
                        file_ext = os.path.splitext(saved_filename)[1].lstrip(".").lower() or "png"
                        
                        # Generate thumbnail
                        thumb_data, thumb_width, thumb_height = _create_thumbnail(full_path)
                        img_width = thumb_width or param_width
                        img_height = thumb_height or param_height
                        
                        new_image = Image(
                            job_id=job_id, path=full_path, filename=saved_filename, format=file_ext,
                            width=img_width, height=img_height, file_exists=True,
                            thumbnail_data=thumb_data, extra_metadata=image_metadata, is_kept=False
                        )
                        session.add(new_image)
                        session.commit()
                        session.refresh(new_image)
                        
                        saved_media.append(new_image)
                        
                        # Update index
                        fts_updated = False
                        search_text = build_search_text(pos_embed, neg_embed, None, None, stacked_history)
                        if search_text and new_image.id:
                            update_gallery_fts(session, new_image.id, search_text)
                            session.commit()
                            
                        # Stream the result!
                        manager.broadcast_sync({
                            "type": "image_completed",
                            "job_id": job_id,
                            "image": {
                                "id": new_image.id, "job_id": new_image.job_id, "path": new_image.path,
                                "filename": new_image.filename, "created_at": new_image.created_at.isoformat()
                            }
                        }, str(job_id))
                        
                except Exception as e:
                    print(f"Failed to process streamed image: {e}")

            prompt_id = client.queue_prompt(final_graph)
            job.comfy_prompt_id = prompt_id
            session.add(job)
            session.commit()
            
            manager.broadcast_sync({"type": "started", "prompt_id": prompt_id}, str(job_id))
            
            # Pass callback to get_images
            outputs = client.get_images(prompt_id, progress_callback=on_progress, on_image_callback=on_image_captured)
            
            # Filter Logic - only process items NOT already handled
            final_tasks = []
            
            # Re-read sequence for batch processing
            pending_outputs = []
            for item in outputs:
                fname = os.path.basename(item.get("filename") or "")
                # If we processed it in on_image_captured, processed_filenames has it
                # Note: previews might not trigger on_image_captured (type 1), only type 2 (SaveImageWebsocket)
                # But get_images returns type 2 images too.
                # History images (not websocket captured) wouldn't be in processed_filenames.
                if fname not in processed_filenames:
                    pending_outputs.append(item)
            
            # Reuse seq start logic for the remainder
            next_seq = _get_next_sequence_start(session, filename_prefix, len(pending_outputs))
            
            video_tasks = []
            image_tasks = []
            
            for idx, output in enumerate(pending_outputs):
                seq_num = next_seq + idx
                original_name = os.path.basename(output.get("filename") or "")
                original_ext = original_name.rsplit('.', 1)[-1].lower() if '.' in original_name else ""
                if not original_ext:
                    original_ext = "mp4" if output.get("kind") == "video" else "jpg"

                if output.get("kind") == "video":
                     # Original video logic
                    preferred_name = original_name or f"{filename_prefix}-{seq_num:04d}.{original_ext}"
                    if os.path.exists(os.path.join(save_dir, preferred_name)):
                        preferred_name = f"{filename_prefix}-{seq_num:04d}.{original_ext}"
                    video_tasks.append(
                        (output, idx, save_dir, preferred_name, video_provenance_json, engine.output_dir, engine_root_dir)
                    )
                else:
                    filename = f"{filename_prefix}-{seq_num:04d}.{original_ext}"
                    image_tasks.append(
                        (output, idx, save_dir, filename, provenance_json, xp_comment_bytes, 
                         engine.output_dir, engine_root_dir, xp_title_bytes, xp_subject_bytes)
                    )
             
            # Process images in parallel using ThreadPoolExecutor
            processed_results = []

            os.makedirs(save_dir, exist_ok=True)

            configured_workers_raw = os.getenv("SWEET_TEA_POSTPROCESS_WORKERS", "").strip()
            configured_workers = None
            if configured_workers_raw:
                try:
                    configured_workers = int(configured_workers_raw)
                except ValueError:
                    configured_workers = None

            cpu_workers = os.cpu_count() or 4
            default_workers = min(32, cpu_workers)
            max_workers = configured_workers if configured_workers and configured_workers > 0 else default_workers
            total_tasks = len(image_tasks) + len(video_tasks)
            max_workers = max(1, min(max_workers, total_tasks or 1))

            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {}
                for task in image_tasks:
                    futures[executor.submit(_process_single_image, *task)] = task[1]
                for task in video_tasks:
                    futures[executor.submit(_process_single_video, *task)] = task[1]

                for future in as_completed(futures):
                    result = future.result()
                    if result:
                        processed_results.append(result)
            
            # Sort by original index to maintain order
            processed_results.sort(key=lambda x: x[2])
            
            # Verify files actually exist on disk and track failures
            verified_results = []
            failed_count = 0
            for full_path, final_filename, idx in processed_results:
                if os.path.exists(full_path):
                    verified_results.append((full_path, final_filename, idx))
                else:
                    failed_count += 1
                    print(f"[SAVE FAILED] File not found after save: {full_path}")
            
            # Alert if any saves failed
            if failed_count > 0:
                manager.broadcast_sync({
                    "type": "save_failed",
                    "job_id": job_id,
                    "failed_count": failed_count,
                    "saved_count": len(verified_results),
                    "total_count": len(processed_results) + failed_count,
                    "message": f"{failed_count} image(s) failed to save to disk. Check disk space and permissions."
                }, str(job_id))
            
            # Build prompt history metadata (shared)
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
            for hist_idx, entry in enumerate(prompt_history):
                if isinstance(entry, dict):
                    stacked = entry.copy()
                    stacked.setdefault("stage", hist_idx + 1)
                    stacked_history.append(stacked)

            image_metadata = incoming_metadata.copy()
            image_metadata["active_prompt"] = latest_prompt
            image_metadata["prompt_history"] = stacked_history
            image_metadata["generation_params"] = {
                k: v for k, v in working_params.items() 
                if k != "metadata" and not k.startswith("__")
            }

            param_width = None
            param_height = None
            if isinstance(working_params, dict):
                param_width = working_params.get("width") or working_params.get("empty_latent_width")
                param_height = working_params.get("height") or working_params.get("empty_latent_height")
            
            # Create database records for each VERIFIED output (file confirmed on disk)
            for full_path, final_filename, idx in verified_results:
                file_ext = os.path.splitext(final_filename)[1].lstrip(".").lower() or "png"
                is_video = file_ext in {"mp4", "webm", "mov", "mkv", "avi"}

                thumb_data = None
                img_width = param_width
                img_height = param_height
                if not is_video:
                    # Generate inline thumbnail for DB portability (allows viewing prompts without image files)
                    thumb_data, thumb_width, thumb_height = _create_thumbnail(full_path)
                    img_width = thumb_width or param_width
                    img_height = thumb_height or param_height

                metadata = image_metadata
                if is_video:
                    metadata = {**image_metadata, "media_kind": "video"}

                new_image = Image(
                    job_id=job_id,
                    path=full_path,
                    filename=final_filename,
                    format=file_ext,
                    width=img_width,
                    height=img_height,
                    file_exists=True,
                    thumbnail_data=thumb_data,
                    extra_metadata=metadata,
                    is_kept=False
                )
                session.add(new_image)
                saved_media.append(new_image)
            
            session.commit()
            
            for img in saved_media:
                session.refresh(img)

            fts_updated = False
            search_text = build_search_text(pos_embed, neg_embed, None, None, stacked_history)
            if search_text:
                for img in saved_media:
                    if img.id is None:
                        continue
                    if update_gallery_fts(session, img.id, search_text):
                        fts_updated = True
            if fts_updated:
                session.commit()
                
            images_payload = [
                {
                    "id": img.id,
                    "job_id": img.job_id,
                    "path": img.path,
                    "filename": img.filename,
                    "created_at": img.created_at.isoformat(),
                    "is_kept": img.is_kept
                } 
                for img in saved_media
            ]
            
            manager.broadcast_sync({
                "type": "completed", 
                "images": images_payload,
                "job_params": working_params,
                "prompt": pos_embed,
                "negative_prompt": neg_embed
            }, str(job_id))
            manager.close_job_sync(str(job_id))
            
            # Auto-Save Prompt
            if saved_media:
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
                    preview_path = None
                    for img in saved_media:
                        if img.format and img.format.lower() not in {"mp4", "webm", "mov", "mkv", "avi"}:
                            preview_path = img.path
                            break
                    if not preview_path:
                        preview_path = saved_media[0].path

                    new_prompt = Prompt(
                        workflow_id=workflow.id,
                        name=f"Auto-Saved: {pos_embed[:30]}..." if pos_embed else f"Auto-Saved #{job_id}",
                        description=f"Automatically saved from Job {job_id}",
                        positive_text=pos_embed,
                        negative_text=neg_embed,
                        content_hash=content_hash,
                        parameters=working_params,
                        preview_image_path=preview_path,
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
            manager.close_job_sync(str(job_id))

        except Exception as e:
            job.status = "failed"
            job.error = str(e)
            session.add(job)
            session.commit()
            manager.broadcast_sync({"type": "error", "message": str(e)}, str(job_id))
            manager.close_job_sync(str(job_id))
