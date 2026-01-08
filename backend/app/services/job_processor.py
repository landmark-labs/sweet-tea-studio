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
from collections import Counter
from pathlib import Path
from datetime import datetime
from typing import Any, List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

from sqlmodel import Session, select
from app.models.job import Job
from app.models.project import Project
from app.models.workflow import WorkflowTemplate
from app.models.engine import Engine
from app.models.image import Image
from app.models.prompt import Prompt
from app.models.portfolio import RunExecutionStats, RunNodeTiming
from app.db.engine import engine as db_engine
from app.core.websockets import manager
from app.services.comfy_watchdog import watchdog
from app.services.gallery_search import build_search_text, update_gallery_fts

# ===== DIAGNOSTIC MODE TOGGLE =====
DIAGNOSTIC_MODE = os.getenv("SWEET_TEA_DIAGNOSTIC_MODE", "").lower() in ("1", "true", "yes")
PREVIEW_DEBUG = os.getenv("SWEET_TEA_PREVIEW_DEBUG", "").lower() in ("1", "true", "yes")
DUMP_GRAPH = os.getenv("SWEET_TEA_DUMP_GRAPH", "").lower() in ("1", "true", "yes")
GRAPH_AUDIT = os.getenv("SWEET_TEA_GRAPH_AUDIT", "").lower() in ("1", "true", "yes") or DUMP_GRAPH
GRAPH_AUDIT_HASH_INPUT_FILES = os.getenv("SWEET_TEA_GRAPH_AUDIT_HASH_INPUT_FILES", "").lower() in ("1", "true", "yes")
GRAPH_AUDIT_MAX_HASH_BYTES = int(os.getenv("SWEET_TEA_GRAPH_AUDIT_MAX_HASH_BYTES", str(50 * 1024 * 1024)))
GRAPH_RESOLVE_VALUES = os.getenv("SWEET_TEA_GRAPH_RESOLVE_VALUES", "").lower() in ("1", "true", "yes") or DUMP_GRAPH
DUMP_COMFY_HISTORY = os.getenv("SWEET_TEA_DUMP_COMFY_HISTORY", "").lower() in ("1", "true", "yes") or DUMP_GRAPH

if DIAGNOSTIC_MODE:
    from app.core.comfy_diagnostics import DiagnosticComfyClient as ComfyClient
    from app.core.comfy_client import ComfyConnectionError, ComfyResponseError, ExecutionMetrics
else:
    from app.core.comfy_client import ComfyClient, ComfyConnectionError, ComfyResponseError, ExecutionMetrics
# ===================================

_sequence_cache: dict[str, dict[str, float | int]] = {}
_sequence_lock = threading.Lock()
_sequence_pattern_cache: dict[str, dict[str, object]] = {}
_sequence_cache_last_prune = 0.0
_sequence_cache_max = int(os.getenv("SWEET_TEA_SEQ_CACHE_MAX", "512"))
_sequence_pattern_cache_max = int(os.getenv("SWEET_TEA_SEQ_PATTERN_CACHE_MAX", "512"))
_sequence_cache_ttl_s = int(os.getenv("SWEET_TEA_SEQ_CACHE_TTL_S", "3600"))
_sequence_cache_prune_interval_s = int(os.getenv("SWEET_TEA_SEQ_CACHE_PRUNE_INTERVAL_S", "60"))

_cancel_events: dict[int, threading.Event] = {}
_cancel_events_lock = threading.Lock()


def signal_job_cancel(job_id: int) -> None:
    """Signal a running job processor to stop promptly."""
    with _cancel_events_lock:
        event = _cancel_events.setdefault(job_id, threading.Event())
    event.set()


def _get_cancel_event(job_id: int) -> threading.Event:
    with _cancel_events_lock:
        return _cancel_events.setdefault(job_id, threading.Event())


def _clear_cancel_event(job_id: int) -> None:
    with _cancel_events_lock:
        _cancel_events.pop(job_id, None)


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


def _derive_output_filename(
    original_name: str | None,
    seq_num: int,
    ext: str,
    fallback_prefix: str,
    save_dir: str,
) -> str:
    """
    Derive output filename, preserving save node naming pattern if present.
    
    If original_name has a pattern like 'Prefix_00001.mp4', extract 'Prefix_'
    and generate 'Prefix_{seq_num:05d}.mp4' (matching the zero-padding width).
    
    Falls back to sweet-tea naming '{fallback_prefix}-{seq_num:04d}.{ext}'.
    """
    if not original_name:
        return f"{fallback_prefix}-{seq_num:04d}.{ext}"
    
    # Extract base name without extension
    base_name = original_name.rsplit('.', 1)[0] if '.' in original_name else original_name
    
    # Pattern: prefix followed by digits (possibly with underscore/dash separator)
    match = re.match(r'^(.+?)([-_])?(\d+)$', base_name)
    if match:
        prefix = match.group(1)
        separator = match.group(2) or '_'  # Default to underscore if no separator
        digits = match.group(3)
        padding = len(digits)
        
        # Generate unique filename with this pattern
        candidate = f"{prefix}{separator}{seq_num:0{padding}d}.{ext}"
        if not os.path.exists(os.path.join(save_dir, candidate)):
            return candidate
        
        # If still exists, find next available sequence number
        for i in range(seq_num, seq_num + 1000):
            candidate = f"{prefix}{separator}{i:0{padding}d}.{ext}"
            if not os.path.exists(os.path.join(save_dir, candidate)):
                return candidate
    
    # No recognizable pattern - fallback to sweet-tea naming
    return f"{fallback_prefix}-{seq_num:04d}.{ext}"


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


def _stable_json_sha256(data: object) -> str:
    serialized = json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _is_scalar(value: object) -> bool:
    return isinstance(value, (str, int, float, bool)) or value is None


def _sort_node_ids(node_ids: list[str] | set[str]) -> list[str]:
    def sort_key(val: str) -> tuple[int, str]:
        text = str(val)
        return (0, f"{int(text):020d}") if text.isdigit() else (1, text)

    return sorted({str(v) for v in node_ids}, key=sort_key)


def _is_link(value: object) -> bool:
    if not (isinstance(value, list) and len(value) == 2):
        return False
    return value[0] is not None and value[1] is not None


def _read_png_size(path: Path) -> tuple[int, int] | None:
    try:
        with path.open("rb") as f:
            header = f.read(24)
        if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
            return None
        # IHDR width/height are big-endian at bytes 16..24
        width = int.from_bytes(header[16:20], "big")
        height = int.from_bytes(header[20:24], "big")
        if width <= 0 or height <= 0:
            return None
        return width, height
    except Exception:
        return None


def _read_jpeg_size(path: Path) -> tuple[int, int] | None:
    # Minimal JPEG SOF parser (baseline/progressive). Returns None on failure.
    try:
        with path.open("rb") as f:
            data = f.read(1024 * 1024)  # header scan only; JPEG dims are near the start
        if len(data) < 4 or data[0:2] != b"\xFF\xD8":
            return None
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            # Skip fill bytes
            while i < len(data) and data[i] == 0xFF:
                i += 1
            if i >= len(data):
                break
            marker = data[i]
            i += 1
            # Standalone markers
            if marker in (0xD8, 0xD9, 0x01) or (0xD0 <= marker <= 0xD7):
                continue
            if i + 2 > len(data):
                break
            length = int.from_bytes(data[i:i+2], "big")
            if length < 2:
                break
            segment_start = i + 2
            segment_end = segment_start + (length - 2)
            if segment_end > len(data):
                break
            # SOF markers that contain size
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                if segment_start + 7 > len(data):
                    break
                height = int.from_bytes(data[segment_start + 1:segment_start + 3], "big")
                width = int.from_bytes(data[segment_start + 3:segment_start + 5], "big")
                if width <= 0 or height <= 0:
                    return None
                return width, height
            i = segment_end
        return None
    except Exception:
        return None


def _read_image_size(path: Path) -> tuple[int, int] | None:
    try:
        from PIL import Image as PILImage  # type: ignore

        with PILImage.open(path) as img:
            width, height = img.size
            if width <= 0 or height <= 0:
                return None
            return int(width), int(height)
    except Exception:
        pass

    suffix = path.suffix.lower()
    if suffix == ".png":
        return _read_png_size(path)
    if suffix in (".jpg", ".jpeg"):
        return _read_jpeg_size(path)
    # Unknown; best-effort only.
    return None


def _resolve_graph_scalar_values(graph: dict, *, engine: Engine | None) -> dict[str, Any]:
    """
    Best-effort resolver for scalar values produced by common "calculated" nodes.

    This is purely diagnostic: it does not alter the prompt sent to ComfyUI.
    It exists to answer: "what number does this link evaluate to at runtime?"
    """
    UNRESOLVED = object()

    input_dir: Path | None = None
    if engine and engine.input_dir:
        try:
            input_dir = Path(engine.input_dir)
        except Exception:
            input_dir = None

    memo: dict[tuple[str, int], object] = {}
    visiting: set[tuple[str, int]] = set()
    image_size_cache: dict[str, tuple[int, int]] = {}

    def resolve_value(val: object) -> object:
        if _is_link(val):
            try:
                return resolve_output(str(val[0]), int(val[1]))
            except Exception:
                return UNRESOLVED
        return val

    def resolve_output(node_id: str, slot: int) -> object:
        key = (str(node_id), int(slot))
        if key in memo:
            return memo[key]
        if key in visiting:
            return UNRESOLVED
        visiting.add(key)
        result: object = UNRESOLVED
        try:
            node = graph.get(key[0])
            if not isinstance(node, dict):
                result = UNRESOLVED
                return result
            class_type = str(node.get("class_type") or "")
            inputs = node.get("inputs", {})
            if not isinstance(inputs, dict):
                inputs = {}

            # --- Interactive scalar widgets ---
            if class_type == "InteractiveInteger":
                if slot != 0:
                    result = UNRESOLVED
                    return result
                raw = inputs.get("integer")
                if isinstance(raw, bool):
                    result = UNRESOLVED
                    return result
                if isinstance(raw, int):
                    result = raw
                    return result
                if isinstance(raw, float) and raw.is_integer():
                    result = int(raw)
                    return result
                if isinstance(raw, str):
                    text = raw.strip()
                    if text and text.lstrip("-").isdigit():
                        result = int(text)
                        return result
                result = UNRESOLVED
                return result

            if class_type == "InteractiveFloat":
                if slot != 0:
                    result = UNRESOLVED
                    return result
                raw = inputs.get("float")
                if isinstance(raw, bool):
                    result = UNRESOLVED
                    return result
                if isinstance(raw, (int, float)):
                    result = float(raw)
                    return result
                if isinstance(raw, str):
                    try:
                        result = float(raw.strip())
                        return result
                    except Exception:
                        result = UNRESOLVED
                        return result
                result = UNRESOLVED
                return result

            # --- Load image / size ---
            if class_type == "Get Image Size":
                if slot not in (0, 1):
                    result = UNRESOLVED
                    return result
                image_in = inputs.get("image")
                if not _is_link(image_in):
                    result = UNRESOLVED
                    return result

                upstream_id = str(image_in[0])
                upstream = graph.get(upstream_id)
                if not isinstance(upstream, dict):
                    result = UNRESOLVED
                    return result
                if str(upstream.get("class_type") or "") != "LoadImage":
                    result = UNRESOLVED
                    return result

                upstream_inputs = upstream.get("inputs", {})
                if not isinstance(upstream_inputs, dict):
                    result = UNRESOLVED
                    return result

                filename = upstream_inputs.get("image")
                if not isinstance(filename, str) or not filename.strip():
                    result = UNRESOLVED
                    return result
                filename = filename.strip().strip('"').strip("'")

                cached = image_size_cache.get(filename)
                if cached is None:
                    candidate = Path(filename)
                    if not candidate.is_absolute() and input_dir:
                        candidate = input_dir / candidate

                    if candidate.exists() and candidate.is_file():
                        size = _read_image_size(candidate)
                        if size:
                            image_size_cache[filename] = size
                            cached = size
                    if cached is None:
                        result = UNRESOLVED
                        return result

                result = int(cached[0] if slot == 0 else cached[1])
                return result

            # --- easy-use nodes (common in STS graphs) ---
            if class_type == "easy mathInt":
                if slot != 0:
                    result = UNRESOLVED
                    return result
                op = inputs.get("operation")
                a_val = resolve_value(inputs.get("a"))
                b_val = resolve_value(inputs.get("b"))
                if not isinstance(op, str):
                    result = UNRESOLVED
                    return result
                if not isinstance(a_val, (int, float)) or not isinstance(b_val, (int, float)):
                    result = UNRESOLVED
                    return result

                a_num = float(a_val)
                b_num = float(b_val)
                op_norm = op.strip().lower()
                try:
                    if op_norm == "add":
                        result = int(a_num + b_num)
                        return result
                    if op_norm == "subtract":
                        result = int(a_num - b_num)
                        return result
                    if op_norm == "multiply":
                        result = int(a_num * b_num)
                        return result
                    if op_norm == "divide":
                        if b_num == 0:
                            result = UNRESOLVED
                            return result
                        result = int(a_num // b_num)
                        return result
                    if op_norm == "mod":
                        if b_num == 0:
                            result = UNRESOLVED
                            return result
                        result = int(a_num % b_num)
                        return result
                    if op_norm == "max":
                        result = int(max(a_num, b_num))
                        return result
                    if op_norm == "min":
                        result = int(min(a_num, b_num))
                        return result
                except Exception:
                    result = UNRESOLVED
                    return result
                result = UNRESOLVED
                return result

            if class_type == "easy compare":
                if slot != 0:
                    result = UNRESOLVED
                    return result
                comparison = inputs.get("comparison")
                a_val = resolve_value(inputs.get("a"))
                b_val = resolve_value(inputs.get("b"))
                if not isinstance(comparison, str) or not isinstance(a_val, (int, float)) or not isinstance(b_val, (int, float)):
                    result = UNRESOLVED
                    return result
                expr = comparison.strip().replace(" ", "")
                a_num = float(a_val)
                b_num = float(b_val)
                try:
                    if expr == "a<b":
                        result = a_num < b_num
                        return result
                    if expr == "a<=b":
                        result = a_num <= b_num
                        return result
                    if expr == "a>b":
                        result = a_num > b_num
                        return result
                    if expr == "a>=b":
                        result = a_num >= b_num
                        return result
                    if expr == "a==b":
                        result = a_num == b_num
                        return result
                    if expr == "a!=b":
                        result = a_num != b_num
                        return result
                except Exception:
                    result = UNRESOLVED
                    return result
                result = UNRESOLVED
                return result

            if class_type == "easy ifElse":
                if slot != 0:
                    result = UNRESOLVED
                    return result
                cond_val = resolve_value(inputs.get("boolean"))
                if not isinstance(cond_val, bool):
                    result = UNRESOLVED
                    return result
                chosen = inputs.get("on_true") if cond_val else inputs.get("on_false")
                result = resolve_value(chosen)
                return result

            result = UNRESOLVED
            return result
        finally:
            visiting.discard(key)
            memo[key] = result

    # Build outputs map for all nodes/slots we can resolve (bounded).
    computed_outputs: dict[str, dict[str, object]] = {}
    for node_id in _sort_node_ids(list(graph.keys())):
        # Common scalar producers tend to have <=2 scalar outputs; probe a few.
        for slot in range(0, 4):
            key = (node_id, slot)
            if key in memo:
                val = memo[key]
            else:
                val = resolve_output(node_id, slot)
            if val is UNRESOLVED or not _is_scalar(val):
                continue
            computed_outputs.setdefault(node_id, {})[str(slot)] = val

    # Resolve inputs for every node where possible.
    resolved_inputs: dict[str, dict[str, object]] = {}
    resolved_numeric_inputs: dict[str, dict[str, object]] = {}
    for node_id in _sort_node_ids(list(graph.keys())):
        node = graph.get(node_id)
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue
        node_resolved: dict[str, object] = {}
        node_numeric: dict[str, object] = {}
        for input_name, input_val in inputs.items():
            if _is_link(input_val):
                resolved = resolve_value(input_val)
                if resolved is not UNRESOLVED and _is_scalar(resolved):
                    node_resolved[str(input_name)] = resolved
                    if isinstance(resolved, (int, float, bool)) or resolved is None:
                        node_numeric[str(input_name)] = resolved
                else:
                    node_resolved[str(input_name)] = input_val
            else:
                node_resolved[str(input_name)] = input_val
        resolved_inputs[node_id] = node_resolved
        if node_numeric:
            resolved_numeric_inputs[node_id] = node_numeric

    return {
        "computed_outputs": computed_outputs,
        "resolved_inputs": resolved_inputs,
        "resolved_numeric_inputs": resolved_numeric_inputs,
        "image_size_cache": {k: {"width": v[0], "height": v[1]} for k, v in image_size_cache.items()},
    }


def _graph_link_signature(graph: dict) -> dict:
    signature: dict[str, dict[str, object]] = {}
    for node_id in _sort_node_ids(list(graph.keys())):
        node = graph.get(node_id)
        if not isinstance(node, dict):
            continue
        class_type = node.get("class_type")
        if not isinstance(class_type, str):
            class_type = str(class_type) if class_type is not None else ""
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            inputs = {}
        links: dict[str, list] = {}
        for input_name, input_val in inputs.items():
            if _is_link(input_val):
                try:
                    links[str(input_name)] = [str(input_val[0]), int(input_val[1])]
                except Exception:
                    # If a link is malformed, keep a stable placeholder so hashing doesn't explode.
                    links[str(input_name)] = ["?", "?"]
        signature[str(node_id)] = {"class_type": class_type, "links": links}
    return signature


def _follow_lora_chain(graph: dict, start_link: object, *, expected_slot: int, next_input: str) -> list[str]:
    chain: list[str] = []
    current = start_link
    seen: set[str] = set()

    for _ in range(128):
        if not _is_link(current):
            break
        src_id = str(current[0])
        try:
            slot = int(current[1])
        except Exception:
            break
        if slot != expected_slot:
            break
        if src_id in seen:
            break
        seen.add(src_id)

        node = graph.get(src_id)
        if not isinstance(node, dict):
            break
        if str(node.get("class_type") or "") != "LoraLoader":
            break

        chain.append(src_id)
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            break
        current = inputs.get(next_input)

    return chain


def _looks_like_sampler_node(class_type: str, inputs: dict) -> bool:
    if class_type in ("KSampler", "KSamplerAdvanced"):
        return True
    if "UltimateSDUpscale" in class_type:
        return True
    if not (isinstance(inputs, dict) and inputs):
        return False
    if not all(key in inputs for key in ("model", "positive", "negative")):
        return False
    return any(key in inputs for key in ("seed", "steps", "cfg")) and any(key in inputs for key in ("sampler_name", "scheduler"))


def _sha256_file(path: Path, *, max_bytes: int) -> str | None:
    try:
        if not path.exists() or not path.is_file():
            return None
        size = path.stat().st_size
        if size > max_bytes:
            return None
        h = hashlib.sha256()
        with path.open("rb") as f:
            while True:
                chunk = f.read(1024 * 1024)
                if not chunk:
                    break
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None


def _unwrap_scalar_history_value(value: object) -> object | None:
    """
    Coerce common ComfyUI history output shapes into scalars when possible.

    Many nodes emit scalars as `[123]` or `{'result': 123}`; this tries to unwrap
    the most common patterns for debugging numeric pipelines.
    """
    if _is_scalar(value):
        return value
    if isinstance(value, list):
        if len(value) == 1 and _is_scalar(value[0]):
            return value[0]
        if value and all(_is_scalar(v) for v in value):
            # Keep small scalar lists (e.g. [w, h]) intact.
            return value
        return None
    if isinstance(value, dict):
        # Heuristic: if there's exactly one scalar entry, use it.
        scalar_items = [(k, v) for k, v in value.items() if _is_scalar(v)]
        if len(scalar_items) == 1:
            return scalar_items[0][1]
        # Common keys
        for k in ("result", "value", "int", "float", "width", "height"):
            v = value.get(k)
            if _is_scalar(v):
                return v
        return None
    return None


def _resolve_scalar_links_from_history(
    graph: dict,
    *,
    object_info: dict[str, Any] | None,
    history_outputs: dict[str, Any] | None,
) -> dict[str, Any]:
    """
    Build a "resolved inputs" view using ComfyUI history outputs.

    For any input that is a link `[node_id, slot]`, if the upstream node has a
    scalar output in history that matches that slot, substitute the scalar.
    """
    if not isinstance(graph, dict) or not isinstance(history_outputs, dict) or not history_outputs:
        return {"resolved_numeric_inputs": {}, "resolved_inputs": {}, "warnings": ["Missing history outputs."]}

    warnings: list[str] = []

    def output_key_for_slot(src_node_id: str, slot: int) -> str | None:
        node = graph.get(src_node_id)
        if not isinstance(node, dict):
            return None
        class_type = node.get("class_type")
        if not isinstance(class_type, str) or not class_type:
            return None
        out_map = history_outputs.get(src_node_id)
        if not isinstance(out_map, dict) or not out_map:
            return None

        # Prefer object_info's output_name ordering when available.
        if isinstance(object_info, dict):
            node_def = object_info.get(class_type)
            if isinstance(node_def, dict):
                names = node_def.get("output_name")
                if isinstance(names, list) and 0 <= slot < len(names) and isinstance(names[slot], str):
                    return names[slot]

        # Fallback: only safe when slot==0 and there's a single output key.
        if slot == 0 and len(out_map) == 1:
            only_key = next(iter(out_map.keys()))
            return only_key if isinstance(only_key, str) else None

        # Best-effort fallback: assume JSON key order matches output slot order.
        # This is not guaranteed, but is useful for debugging scalar pipelines.
        ordered_keys = [k for k in out_map.keys() if isinstance(k, str)]
        if 0 <= slot < len(ordered_keys):
            return ordered_keys[slot]

        return None

    resolved_inputs: dict[str, dict[str, object]] = {}
    resolved_numeric_inputs: dict[str, dict[str, object]] = {}

    for node_id in _sort_node_ids(list(graph.keys())):
        node = graph.get(node_id)
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict) or not inputs:
            continue

        node_resolved: dict[str, object] = {}
        node_numeric: dict[str, object] = {}

        for input_name, input_val in inputs.items():
            if not _is_link(input_val):
                continue
            try:
                src_id = str(input_val[0])
                slot = int(input_val[1])
            except Exception:
                continue

            out_map = history_outputs.get(src_id)
            if not isinstance(out_map, dict) or not out_map:
                continue

            out_key = output_key_for_slot(src_id, slot)
            if not out_key:
                continue

            raw = out_map.get(out_key)
            unwrapped = _unwrap_scalar_history_value(raw)
            if unwrapped is None:
                continue

            node_resolved[str(input_name)] = unwrapped
            if isinstance(unwrapped, (int, float, bool)) or unwrapped is None:
                node_numeric[str(input_name)] = unwrapped

        if node_resolved:
            resolved_inputs[node_id] = node_resolved
        if node_numeric:
            resolved_numeric_inputs[node_id] = node_numeric

    if not resolved_inputs:
        warnings.append("No scalar link inputs could be resolved from history outputs (missing output_name mapping or non-scalar outputs).")

    return {
        "resolved_inputs": resolved_inputs,
        "resolved_numeric_inputs": resolved_numeric_inputs,
        "warnings": warnings,
    }


def _build_graph_audit_report(
    graph: dict,
    *,
    engine: Engine | None,
    workflow: WorkflowTemplate | None,
    params: dict,
    bypass_nodes: list[str],
) -> dict[str, Any]:
    report: dict[str, Any] = {
        "job": {
            "workflow_id": getattr(workflow, "id", None),
            "workflow_name": getattr(workflow, "name", None),
            "engine_id": getattr(engine, "id", None),
        },
        "hashes": {
            "prompt_sha256": _stable_json_sha256(graph),
            "links_sha256": _stable_json_sha256(_graph_link_signature(graph)),
        },
        "counts": {
            "nodes": len(graph) if isinstance(graph, dict) else 0,
        },
        "bypass_nodes": [str(n) for n in (bypass_nodes or [])],
        "warnings": [],
        "samplers": [],
        "loras": [],
        "clip_text_encoders": [],
        "sdxl_conditioning": [],
        "input_files": [],
    }

    if not isinstance(graph, dict) or not graph:
        report["warnings"].append("Graph is empty or invalid.")
        return report

    type_counts = Counter()
    for node in graph.values():
        if isinstance(node, dict):
            type_counts[str(node.get("class_type") or "?")] += 1
    report["counts"]["class_types"] = dict(type_counts)

    # --- LoRA nodes ---
    lora_nodes: dict[str, dict[str, Any]] = {}
    for node_id, node in graph.items():
        if not isinstance(node, dict):
            continue
        if str(node.get("class_type") or "") != "LoraLoader":
            continue
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            inputs = {}

        lora_name = inputs.get("lora_name")
        strength_model = inputs.get("strength_model")
        strength_clip = inputs.get("strength_clip")

        active = bool(isinstance(lora_name, str) and lora_name.strip()) and any(
            isinstance(val, (int, float)) and float(val) != 0.0
            for val in (strength_model, strength_clip)
        )

        entry = {
            "node_id": str(node_id),
            "lora_name": lora_name,
            "strength_model": strength_model,
            "strength_clip": strength_clip,
            "active": active,
            "model_in": inputs.get("model"),
            "clip_in": inputs.get("clip"),
        }
        lora_nodes[str(node_id)] = entry

    report["loras"] = [lora_nodes[nid] for nid in _sort_node_ids(list(lora_nodes.keys()))]

    # --- Samplers / terminal nodes ---
    used_lora_nodes: set[str] = set()
    for node_id, node in graph.items():
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type") or "")
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue
        if not _looks_like_sampler_node(class_type, inputs):
            continue

        model_chain = _follow_lora_chain(graph, inputs.get("model"), expected_slot=0, next_input="model")
        used_lora_nodes.update(model_chain)

        sampler_entry = {
            "node_id": str(node_id),
            "class_type": class_type,
            "model": inputs.get("model"),
            "model_lora_chain": model_chain,
            "seed": inputs.get("seed"),
            "steps": inputs.get("steps"),
            "cfg": inputs.get("cfg"),
            "sampler_name": inputs.get("sampler_name"),
            "scheduler": inputs.get("scheduler"),
            "denoise": inputs.get("denoise"),
        }
        report["samplers"].append(sampler_entry)

    report["samplers"] = sorted(report["samplers"], key=lambda x: (0, int(x["node_id"])) if str(x.get("node_id", "")).isdigit() else (1, str(x.get("node_id", ""))))

    active_lora_ids = [nid for nid, entry in lora_nodes.items() if entry.get("active")]
    if active_lora_ids:
        if not used_lora_nodes:
            report["warnings"].append(
                "LoRA loader nodes are active, but no sampler/terminal node is receiving a LoRA'd MODEL. "
                "This usually means the sampler's `model` input is wired to the checkpoint (or another branch) instead of the LoRA chain."
            )
        else:
            unused = [nid for nid in active_lora_ids if nid not in used_lora_nodes]
            if unused:
                report["warnings"].append(f"Active LoRA loader node(s) not used by any sampler/terminal node: {', '.join(_sort_node_ids(unused))}")

        for sampler in report["samplers"]:
            if not sampler.get("model_lora_chain"):
                report["warnings"].append(f"Sampler/terminal node {sampler['node_id']} ({sampler['class_type']}) receives an un-LoRA'd MODEL (no LoraLoader chain).")

    # --- CLIPTextEncode clip chain (helps catch 'model LoRA applied but clip isn't') ---
    for node_id, node in graph.items():
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type") or "")
        if class_type != "CLIPTextEncode":
            continue
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue
        clip_chain = _follow_lora_chain(graph, inputs.get("clip"), expected_slot=1, next_input="clip")
        report["clip_text_encoders"].append(
            {
                "node_id": str(node_id),
                "title": (node.get("_meta", {}) or {}).get("title"),
                "clip": inputs.get("clip"),
                "clip_lora_chain": clip_chain,
            }
        )

    report["clip_text_encoders"] = sorted(report["clip_text_encoders"], key=lambda x: (0, int(x["node_id"])) if str(x.get("node_id", "")).isdigit() else (1, str(x.get("node_id", ""))))

    # --- SDXL size conditioning ---
    sdxl_nodes: list[dict[str, Any]] = []
    for node_id, node in graph.items():
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type") or "")
        if "SDXL" not in class_type and "Sdxl" not in class_type:
            continue
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue
        size_keys = ("width", "height", "target_width", "target_height", "crop_w", "crop_h")
        if not any(k in inputs for k in size_keys):
            continue
        entry = {"node_id": str(node_id), "class_type": class_type, "title": (node.get("_meta", {}) or {}).get("title")}
        for k in size_keys:
            if k in inputs:
                entry[k] = inputs.get(k)
        sdxl_nodes.append(entry)
    report["sdxl_conditioning"] = sorted(sdxl_nodes, key=lambda x: (0, int(x["node_id"])) if str(x.get("node_id", "")).isdigit() else (1, str(x.get("node_id", ""))))

    if len(report["sdxl_conditioning"]) >= 2:
        # If multiple SDXL conditioning nodes disagree on width/height/etc, warn.
        def sig(n: dict[str, Any]) -> tuple:
            return tuple(n.get(k) for k in ("width", "height", "target_width", "target_height", "crop_w", "crop_h"))

        unique = {sig(n) for n in report["sdxl_conditioning"]}
        if len(unique) > 1:
            report["warnings"].append("SDXL conditioning nodes have mismatched size/crop metadata (width/height/target/crop differ across nodes).")

    # --- Input files (LoadImage, etc) ---
    input_dir: Path | None = None
    if engine and engine.input_dir:
        try:
            input_dir = Path(engine.input_dir)
        except Exception:
            input_dir = None

    for node_id, node in graph.items():
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type") or "")
        if "LoadImage" not in class_type and class_type != "LoadImage":
            continue
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue
        filename = inputs.get("image")
        if not isinstance(filename, str) or not filename.strip():
            continue

        record: dict[str, Any] = {
            "node_id": str(node_id),
            "class_type": class_type,
            "image": filename,
        }

        resolved_path: Path | None = None
        if input_dir:
            try:
                resolved_path = input_dir / Path(filename)
            except Exception:
                resolved_path = None

        if resolved_path:
            record["resolved_path"] = str(resolved_path)
            try:
                record["exists"] = resolved_path.exists()
                if record["exists"]:
                    record["size_bytes"] = resolved_path.stat().st_size
                    if GRAPH_AUDIT_HASH_INPUT_FILES:
                        record["sha256"] = _sha256_file(resolved_path, max_bytes=GRAPH_AUDIT_MAX_HASH_BYTES)
            except Exception:
                record["exists"] = False

        report["input_files"].append(record)

    # If schema-based params include typical core keys, add a small checksum so we can compare runs.
    try:
        core_keys = ("seed", "steps", "cfg", "denoise", "sampler_name", "scheduler", "width", "height")
        core_params = {k: params.get(k) for k in core_keys if k in params}
        if core_params:
            report["hashes"]["core_params_sha256"] = _stable_json_sha256(core_params)
    except Exception:
        pass

    if GRAPH_RESOLVE_VALUES:
        try:
            report["resolved_values"] = _resolve_graph_scalar_values(graph, engine=engine)
        except Exception as exc:
            report["warnings"].append(f"Graph scalar resolution failed: {exc}")

    return report


def _normalize_comfy_type(type_name: object) -> str | None:
    if not isinstance(type_name, str):
        return None
    text = type_name.strip()
    return text.upper() if text else None


def _comfy_types_match(input_type: str | None, output_type: str | None) -> bool:
    if not input_type or not output_type:
        return False
    # For bypass pass-through mapping we only consider exact type matches safe.
    # Wildcard inputs (ANY/*) are intentionally NOT treated as compatible here
    # because the bypassed node may be performing a type conversion.
    return input_type == output_type


def _build_bypass_output_map(
    node: dict,
    object_info: dict[str, Any] | None = None,
) -> dict[int, list]:
    """
    Build a mapping of bypassed node output slot -> upstream source [node_id, slot].

    Prefer ComfyUI object_info (type-aware) to avoid grafting invalid links for
    nodes whose outputs cannot be passed through from any input.
    """
    node_inputs = node.get("inputs", {})
    if not isinstance(node_inputs, dict):
        node_inputs = {}

    if not isinstance(object_info, dict) or not object_info:
        return {}

    class_type = node.get("class_type")
    if not isinstance(class_type, str) or not class_type or class_type not in object_info:
        return {}

    node_def = object_info.get(class_type, {})
    if not isinstance(node_def, dict):
        return {}

    # Type-aware mapping (best-effort)
    raw_outputs = node_def.get("output")
    output_types: list[str] = []
    if isinstance(raw_outputs, list):
        for t in raw_outputs:
            norm = _normalize_comfy_type(t)
            if norm:
                output_types.append(norm)

    if not output_types:
        return {}

    input_conf = node_def.get("input", {})
    if not isinstance(input_conf, dict):
        return {}

    required = input_conf.get("required", {})
    optional = input_conf.get("optional", {})

    input_defs: dict[str, Any] = {}
    if isinstance(required, dict):
        input_defs.update(required)
    if isinstance(optional, dict):
        input_defs.update(optional)

    if not input_defs:
        return {}

    input_types: dict[str, str] = {}
    for input_name, input_config in input_defs.items():
        if not isinstance(input_name, str) or not isinstance(input_config, list) or not input_config:
            continue
        norm = _normalize_comfy_type(input_config[0])
        if norm:
            input_types[input_name] = norm

    connected_inputs_in_order: list[tuple[str, list]] = []
    for input_name in input_defs.keys():
        input_val = node_inputs.get(input_name)
        if isinstance(input_val, list) and len(input_val) == 2:
            connected_inputs_in_order.append((input_name, input_val))

    if not connected_inputs_in_order or not input_types:
        return {}

    mapping: dict[int, list] = {}
    for out_slot, out_type in enumerate(output_types):
        for input_name, input_val in connected_inputs_in_order:
            in_type = input_types.get(input_name)
            if _comfy_types_match(in_type, out_type):
                mapping[out_slot] = input_val
                break
    return mapping


def _topological_sort_bypass_nodes(
    graph: dict,
    bypass_nodes: list[str],
) -> list[str]:
    """
    Sort bypass nodes in topological order (upstream first).
    
    This ensures that when building the resolution map, upstream bypassed
    nodes are processed before their downstream dependents, so the resolution
    for an upstream node is available when a downstream node references it.
    """
    bypass_set = set(bypass_nodes)
    
    # Build dependency graph: for each bypass node, find which other bypass nodes it depends on
    # A node depends on another if its inputs reference that node
    dependencies: dict[str, set[str]] = {node_id: set() for node_id in bypass_nodes}
    
    for node_id in bypass_nodes:
        if node_id not in graph:
            continue
        node = graph[node_id]
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue
        for inp_val in inputs.values():
            if isinstance(inp_val, list) and len(inp_val) == 2:
                upstream_id = str(inp_val[0])
                if upstream_id in bypass_set:
                    dependencies[node_id].add(upstream_id)
    
    # Kahn's algorithm for topological sort
    in_degree = {node_id: len(deps) for node_id, deps in dependencies.items()}
    queue = [node_id for node_id, degree in in_degree.items() if degree == 0]
    sorted_nodes: list[str] = []
    
    while queue:
        node_id = queue.pop(0)
        sorted_nodes.append(node_id)
        for other_id, deps in dependencies.items():
            if node_id in deps:
                in_degree[other_id] -= 1
                if in_degree[other_id] == 0:
                    queue.append(other_id)
    
    # Handle any remaining nodes (cycles or disconnected)
    for node_id in bypass_nodes:
        if node_id not in sorted_nodes:
            sorted_nodes.append(node_id)
    
    # Return in topological order (upstream first)
    return sorted_nodes


def apply_bypass_to_graph(
    graph: dict,
    bypass_nodes: list[str],
    object_info: dict[str, Any] | None = None,
) -> None:
    """
    Mutates `graph` in place by removing bypassed nodes and rewiring downstream
    connections. Downstream links are grafted to an upstream source when a safe
    pass-through mapping exists; otherwise the input is disconnected (deleted).
    
    Uses a two-pass algorithm with reverse topological ordering to correctly
    handle cascading bypasses where multiple connected nodes are bypassed together.
    """
    if not isinstance(graph, dict) or not bypass_nodes:
        return

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_bypass: list[str] = []
    for node_id in bypass_nodes:
        node_id_str = str(node_id)
        if node_id_str in seen:
            continue
        seen.add(node_id_str)
        if node_id_str in graph:
            unique_bypass.append(node_id_str)
    
    if not unique_bypass:
        return
    
    bypass_set = set(unique_bypass)
    
    # Sort in topological order (upstream first) so resolutions cascade correctly
    sorted_bypass = _topological_sort_bypass_nodes(graph, unique_bypass)
    
    # === PASS 1: Build complete resolution map without modifying graph ===
    # Maps (bypassed_node_id, output_slot) -> [resolved_source_id, slot] or None
    resolution_map: dict[tuple[str, int], list | None] = {}
    
    for node_id in sorted_bypass:
        node = graph.get(node_id)
        if not node:
            continue
        
        output_map = _build_bypass_output_map(node, object_info=object_info)
        
        # For each output slot, determine the final resolved upstream source
        # Check all possible output slots (0-9 should cover most nodes)
        for slot in range(10):
            upstream = output_map.get(slot)
            if upstream is None:
                resolution_map[(node_id, slot)] = None
                continue
            
            upstream_id = str(upstream[0])
            upstream_slot = upstream[1]
            
            # If upstream is also being bypassed, resolve through it
            if upstream_id in bypass_set:
                resolved = resolution_map.get((upstream_id, upstream_slot))
                resolution_map[(node_id, slot)] = resolved
            else:
                resolution_map[(node_id, slot)] = list(upstream)
    
    # === PASS 2: Rewire all non-bypassed nodes using the resolution map ===
    for other_node_id, other_node in list(graph.items()):
        if other_node_id in bypass_set:
            continue
        
        inputs = other_node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        
        for inp_name, inp_val in list(inputs.items()):
            if not (isinstance(inp_val, list) and len(inp_val) == 2):
                continue
            
            source_id = str(inp_val[0])
            if source_id not in bypass_set:
                continue
            
            try:
                source_slot = int(inp_val[1])
            except Exception:
                inputs.pop(inp_name, None)
                continue
            
            resolved = resolution_map.get((source_id, source_slot))
            if resolved is not None:
                inputs[inp_name] = resolved
            else:
                inputs.pop(inp_name, None)
    
    # === PASS 3: Remove all bypassed nodes at once ===
    for node_id in bypass_set:
        graph.pop(node_id, None)


def _get_node_output_type(
    graph: dict,
    node_id: str,
    output_slot: int,
    object_info: dict[str, Any],
) -> str | None:
    node = graph.get(node_id)
    if not isinstance(node, dict):
        return None
    class_type = node.get("class_type")
    if not isinstance(class_type, str) or not class_type:
        return None
    node_def = object_info.get(class_type)
    if not isinstance(node_def, dict):
        return None
    outputs = node_def.get("output")
    if not isinstance(outputs, list) or output_slot < 0 or output_slot >= len(outputs):
        return None
    return _normalize_comfy_type(outputs[output_slot])


def _prune_type_mismatched_optional_links(graph: dict, object_info: dict[str, Any] | None) -> None:
    """
    Best-effort safety net: remove optional linked inputs whose upstream output
    type does not match the downstream expected type.

    This is primarily meant to prevent ComfyUI prompt validation failures after
    bypass rewiring when an upstream pass-through would produce an incompatible
    type (e.g. INT -> IMAGE).
    """
    if not isinstance(graph, dict) or not isinstance(object_info, dict) or not object_info:
        return

    for _node_id, node in list(graph.items()):
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict) or not inputs:
            continue

        class_type = node.get("class_type")
        if not isinstance(class_type, str) or not class_type:
            continue

        node_def = object_info.get(class_type)
        if not isinstance(node_def, dict):
            continue

        input_conf = node_def.get("input", {})
        if not isinstance(input_conf, dict):
            continue

        optional = input_conf.get("optional", {})
        if not isinstance(optional, dict) or not optional:
            continue

        for input_name, input_val in list(inputs.items()):
            if input_name not in optional:
                continue
            if not (isinstance(input_val, list) and len(input_val) == 2):
                continue

            try:
                source_id = str(input_val[0])
                source_slot = int(input_val[1])
            except Exception:
                inputs.pop(input_name, None)
                continue

            input_config = optional.get(input_name)
            if not isinstance(input_config, list) or not input_config:
                continue

            expected_type = _normalize_comfy_type(input_config[0])
            if not expected_type or expected_type in ("ANY", "*"):
                continue

            actual_type = _get_node_output_type(graph, source_id, source_slot, object_info)
            if not actual_type:
                continue

            if expected_type != actual_type:
                inputs.pop(input_name, None)


def _dump_failed_prompt_graph(
    job_id: int,
    graph: dict,
    bypass_nodes: list[str],
    params: dict,
    error: str,
) -> list[str]:
    written: list[str] = []
    try:
        from app.core.config import settings

        payload = {
            "job_id": job_id,
            "error": error,
            "bypass_nodes": [str(n) for n in (bypass_nodes or [])],
            "params": params,
            "graph": graph,
        }

        # Overwrite last error dump to avoid clutter.
        dump_path = settings.meta_dir / "debug_last_graph_error.json"
        with open(dump_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, default=str)
        written.append(str(dump_path))
        print(f"[JobProcessor] Wrote ComfyUI error graph dump: {dump_path}")
    except Exception as dump_err:
        print(f"[JobProcessor] Failed to dump ComfyUI error graph: {dump_err}")
        return written

    # Also write to backend/logs for easier discovery when SWEET_TEA_ROOT_DIR differs.
    try:
        from pathlib import Path

        backend_dir = Path(__file__).resolve().parents[2]
        logs_dir = backend_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        logs_dump_path = logs_dir / "debug_last_graph_error.json"
        with open(logs_dump_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, default=str)
        written.append(str(logs_dump_path))
        print(f"[JobProcessor] Wrote ComfyUI error graph dump: {logs_dump_path}")
    except Exception as dump_err:
        print(f"[JobProcessor] Failed to dump ComfyUI error graph to backend/logs: {dump_err}")
    return written


def _dump_prompt_graph_and_audit(
    job_id: int,
    graph: dict,
    bypass_nodes: list[str],
    params: dict,
    audit: dict | None = None,
) -> list[str]:
    written: list[str] = []
    try:
        from app.core.config import settings

        graph_payload = graph
        audit_payload: dict[str, Any] = {
            "job_id": job_id,
            "bypass_nodes": [str(n) for n in (bypass_nodes or [])],
            "params": params,
            "audit": audit or {},
        }

        resolved_graph_payload: dict | None = None
        try:
            resolved_inputs = (audit_payload.get("audit") or {}).get("resolved_values", {}).get("resolved_inputs")
            if isinstance(resolved_inputs, dict) and resolved_inputs:
                resolved_graph_payload = copy.deepcopy(graph_payload)
                for node_id, inputs in resolved_inputs.items():
                    if not isinstance(inputs, dict):
                        continue
                    node = resolved_graph_payload.get(str(node_id))
                    if isinstance(node, dict):
                        node["inputs"] = inputs
        except Exception:
            resolved_graph_payload = None

        graph_path = settings.meta_dir / f"debug_job_{job_id}_graph.json"
        audit_path = settings.meta_dir / f"debug_job_{job_id}_audit.json"
        resolved_graph_path = settings.meta_dir / f"debug_job_{job_id}_graph_resolved.json"
        last_graph_path = settings.meta_dir / "debug_last_graph.json"
        last_audit_path = settings.meta_dir / "debug_last_graph_audit.json"
        last_resolved_graph_path = settings.meta_dir / "debug_last_graph_resolved.json"

        with open(graph_path, "w", encoding="utf-8") as f:
            json.dump(graph_payload, f, indent=2, default=str)
        with open(audit_path, "w", encoding="utf-8") as f:
            json.dump(audit_payload, f, indent=2, default=str)
        with open(last_graph_path, "w", encoding="utf-8") as f:
            json.dump(graph_payload, f, indent=2, default=str)
        with open(last_audit_path, "w", encoding="utf-8") as f:
            json.dump(audit_payload, f, indent=2, default=str)

        if resolved_graph_payload is not None:
            with open(resolved_graph_path, "w", encoding="utf-8") as f:
                json.dump(resolved_graph_payload, f, indent=2, default=str)
            with open(last_resolved_graph_path, "w", encoding="utf-8") as f:
                json.dump(resolved_graph_payload, f, indent=2, default=str)
            written.extend([str(resolved_graph_path), str(last_resolved_graph_path)])

        written.extend([str(graph_path), str(audit_path), str(last_graph_path), str(last_audit_path)])
        print(f"[JobProcessor] Wrote prompt graph/audit to {graph_path} and {audit_path}")
    except Exception as dump_err:
        print(f"[JobProcessor] Failed to dump prompt graph/audit to meta dir: {dump_err}")
        return written

    # Also mirror into backend/logs for convenience when SWEET_TEA_ROOT_DIR differs.
    try:
        backend_dir = Path(__file__).resolve().parents[2]
        logs_dir = backend_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        logs_graph_path = logs_dir / f"debug_job_{job_id}_graph.json"
        logs_audit_path = logs_dir / f"debug_job_{job_id}_audit.json"
        logs_resolved_graph_path = logs_dir / f"debug_job_{job_id}_graph_resolved.json"
        logs_last_graph_path = logs_dir / "debug_last_graph.json"
        logs_last_audit_path = logs_dir / "debug_last_graph_audit.json"
        logs_last_resolved_graph_path = logs_dir / "debug_last_graph_resolved.json"

        with open(logs_graph_path, "w", encoding="utf-8") as f:
            json.dump(graph, f, indent=2, default=str)
        with open(logs_audit_path, "w", encoding="utf-8") as f:
            json.dump(audit_payload, f, indent=2, default=str)
        with open(logs_last_graph_path, "w", encoding="utf-8") as f:
            json.dump(graph, f, indent=2, default=str)
        with open(logs_last_audit_path, "w", encoding="utf-8") as f:
            json.dump(audit_payload, f, indent=2, default=str)

        if resolved_graph_payload is not None:
            with open(logs_resolved_graph_path, "w", encoding="utf-8") as f:
                json.dump(resolved_graph_payload, f, indent=2, default=str)
            with open(logs_last_resolved_graph_path, "w", encoding="utf-8") as f:
                json.dump(resolved_graph_payload, f, indent=2, default=str)
            written.extend([str(logs_resolved_graph_path), str(logs_last_resolved_graph_path)])

        written.extend([str(logs_graph_path), str(logs_audit_path), str(logs_last_graph_path), str(logs_last_audit_path)])
        print(f"[JobProcessor] Mirrored prompt graph/audit to backend/logs")
    except Exception as dump_err:
        print(f"[JobProcessor] Failed to dump prompt graph/audit to backend/logs: {dump_err}")

    return written


def _dump_comfy_history_and_resolved(
    job_id: int,
    *,
    prompt_id: str,
    graph: dict,
    history_map: dict,
    history_resolved: dict | None = None,
) -> list[str]:
    written: list[str] = []
    try:
        from app.core.config import settings

        history_path = settings.meta_dir / f"debug_job_{job_id}_comfy_history.json"
        last_history_path = settings.meta_dir / "debug_last_comfy_history.json"
        resolved_path = settings.meta_dir / f"debug_job_{job_id}_comfy_history_resolved.json"
        last_resolved_path = settings.meta_dir / "debug_last_comfy_history_resolved.json"
        resolved_graph_path = settings.meta_dir / f"debug_job_{job_id}_graph_resolved_from_history.json"
        last_resolved_graph_path = settings.meta_dir / "debug_last_graph_resolved_from_history.json"

        payload = {
            "job_id": job_id,
            "prompt_id": prompt_id,
            "history": history_map,
        }
        with open(history_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, default=str)
        with open(last_history_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, default=str)

        written.extend([str(history_path), str(last_history_path)])

        if history_resolved is not None:
            resolved_graph_payload: dict | None = None
            try:
                resolved_inputs = history_resolved.get("resolved_inputs")
                if isinstance(resolved_inputs, dict) and resolved_inputs:
                    resolved_graph_payload = copy.deepcopy(graph)
                    for node_id, inputs in resolved_inputs.items():
                        if not isinstance(inputs, dict):
                            continue
                        node = resolved_graph_payload.get(str(node_id))
                        if isinstance(node, dict):
                            node_inputs = node.get("inputs")
                            if not isinstance(node_inputs, dict):
                                node_inputs = {}
                            node_inputs.update(inputs)
                            node["inputs"] = node_inputs
            except Exception:
                resolved_graph_payload = None

            resolved_payload = {
                "job_id": job_id,
                "prompt_id": prompt_id,
                "resolved": history_resolved,
            }
            with open(resolved_path, "w", encoding="utf-8") as f:
                json.dump(resolved_payload, f, indent=2, default=str)
            with open(last_resolved_path, "w", encoding="utf-8") as f:
                json.dump(resolved_payload, f, indent=2, default=str)
            written.extend([str(resolved_path), str(last_resolved_path)])

            if resolved_graph_payload is not None:
                with open(resolved_graph_path, "w", encoding="utf-8") as f:
                    json.dump(resolved_graph_payload, f, indent=2, default=str)
                with open(last_resolved_graph_path, "w", encoding="utf-8") as f:
                    json.dump(resolved_graph_payload, f, indent=2, default=str)
                written.extend([str(resolved_graph_path), str(last_resolved_graph_path)])

        print(f"[JobProcessor] Wrote ComfyUI history dump: {history_path}")
    except Exception as dump_err:
        print(f"[JobProcessor] Failed to dump ComfyUI history to meta dir: {dump_err}")
        return written

    try:
        backend_dir = Path(__file__).resolve().parents[2]
        logs_dir = backend_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        logs_history_path = logs_dir / f"debug_job_{job_id}_comfy_history.json"
        logs_last_history_path = logs_dir / "debug_last_comfy_history.json"
        logs_resolved_path = logs_dir / f"debug_job_{job_id}_comfy_history_resolved.json"
        logs_last_resolved_path = logs_dir / "debug_last_comfy_history_resolved.json"
        logs_resolved_graph_path = logs_dir / f"debug_job_{job_id}_graph_resolved_from_history.json"
        logs_last_resolved_graph_path = logs_dir / "debug_last_graph_resolved_from_history.json"

        payload = {
            "job_id": job_id,
            "prompt_id": prompt_id,
            "history": history_map,
        }
        with open(logs_history_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, default=str)
        with open(logs_last_history_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, default=str)
        written.extend([str(logs_history_path), str(logs_last_history_path)])

        if history_resolved is not None:
            resolved_payload = {
                "job_id": job_id,
                "prompt_id": prompt_id,
                "resolved": history_resolved,
            }
            with open(logs_resolved_path, "w", encoding="utf-8") as f:
                json.dump(resolved_payload, f, indent=2, default=str)
            with open(logs_last_resolved_path, "w", encoding="utf-8") as f:
                json.dump(resolved_payload, f, indent=2, default=str)
            written.extend([str(logs_resolved_path), str(logs_last_resolved_path)])

            # Mirror the resolved graph overlay if available
            try:
                if "resolved_graph_payload" in locals() and resolved_graph_payload is not None:
                    with open(logs_resolved_graph_path, "w", encoding="utf-8") as f:
                        json.dump(resolved_graph_payload, f, indent=2, default=str)
                    with open(logs_last_resolved_graph_path, "w", encoding="utf-8") as f:
                        json.dump(resolved_graph_payload, f, indent=2, default=str)
                    written.extend([str(logs_resolved_graph_path), str(logs_last_resolved_graph_path)])
            except Exception:
                pass

        print(f"[JobProcessor] Mirrored ComfyUI history dump to backend/logs")
    except Exception as dump_err:
        print(f"[JobProcessor] Failed to dump ComfyUI history to backend/logs: {dump_err}")

    return written


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


def _store_execution_stats(
    session: Session,
    job_id: int,
    execution_metrics: ExecutionMetrics | None,
    system_stats_before: dict | None = None,
    system_stats_after: dict | None = None,
    queue_wait_ms: int | None = None,
) -> None:
    """
    Store execution statistics for a job.
    
    Args:
        session: Database session
        job_id: The job ID to associate stats with
        execution_metrics: ExecutionMetrics from ComfyClient (optional)
        system_stats_before: System stats captured before execution (optional)
        system_stats_after: System stats captured after execution (optional) 
        queue_wait_ms: Time spent waiting in queue (optional)
    """
    if not execution_metrics:
        return
    
    try:
        # Extract GPU/VRAM info from system stats
        gpu_name = None
        cuda_version = None
        torch_version = None
        device_count = None
        vram_before_mb = None
        vram_after_mb = None
        ram_before_mb = None
        ram_after_mb = None
        
        if system_stats_before:
            system_info = system_stats_before.get("system", {})
            devices = system_stats_before.get("devices", [])
            torch_version = system_info.get("torch_version")
            if devices:
                gpu_name = devices[0].get("name")
                cuda_version = devices[0].get("cuda")
                device_count = len(devices)
                vram_before_mb = devices[0].get("vram_total", 0) - devices[0].get("vram_free", 0)
                vram_before_mb = vram_before_mb / (1024 * 1024) if vram_before_mb else None
            ram_before_mb = system_info.get("ram_used", 0) / (1024 * 1024) if system_info.get("ram_used") else None
        
        if system_stats_after:
            devices = system_stats_after.get("devices", [])
            system_info = system_stats_after.get("system", {})
            if devices:
                vram_after_mb = devices[0].get("vram_total", 0) - devices[0].get("vram_free", 0)
                vram_after_mb = vram_after_mb / (1024 * 1024) if vram_after_mb else None
            ram_after_mb = system_info.get("ram_used", 0) / (1024 * 1024) if system_info.get("ram_used") else None
        
        # Create execution stats record
        stats = RunExecutionStats(
            job_id=job_id,
            total_duration_ms=execution_metrics.total_duration_ms,
            queue_wait_ms=queue_wait_ms,
            gpu_name=gpu_name,
            cuda_version=cuda_version,
            torch_version=torch_version,
            device_count=device_count,
            vram_before_mb=vram_before_mb,
            vram_after_mb=vram_after_mb,
            ram_before_mb=ram_before_mb,
            ram_after_mb=ram_after_mb,
            raw_system_stats=json.dumps(system_stats_after) if system_stats_after else None,
        )
        session.add(stats)
        
        # Create node timing records
        base_start_ms = None
        if execution_metrics.node_timings and execution_metrics.node_timings[0].start_time_ms:
            base_start_ms = execution_metrics.node_timings[0].start_time_ms

        node_records = []
        for timing in execution_metrics.node_timings:
            start_offset_ms = None
            if timing.start_time_ms is not None and base_start_ms is not None:
                start_offset_ms = int(timing.start_time_ms - base_start_ms)

            node_records.append(
                RunNodeTiming(
                    job_id=job_id,
                    node_id=timing.node_id,
                    node_type=timing.node_type,
                    start_offset_ms=start_offset_ms,
                    duration_ms=timing.duration_ms,
                    execution_order=timing.execution_order,
                    from_cache=timing.from_cache,
                )
            )
        if node_records:
            session.add_all(node_records)
        
        session.commit()
        print(f"[Stats] Stored execution stats for job {job_id}: {execution_metrics.total_duration_ms}ms, {len(execution_metrics.node_timings)} nodes")
    except Exception as e:
        print(f"[Stats] Failed to store execution stats for job {job_id}: {e}")
        # Don't fail the job if stats storage fails
        session.rollback()


def process_job(job_id: int):
    cancel_event = _get_cancel_event(job_id)
    with Session(db_engine) as session:
        # Re-fetch objects within session
        job = session.get(Job, job_id)
        if not job:
            _clear_cancel_event(job_id)
            return

        # Skip execution if job was already cancelled (e.g., batch cancel from frontend)
        if job.status == "cancelled" or cancel_event.is_set():
            print(f"[JobProcessor] Job {job_id} already cancelled, skipping execution")
            manager.close_job_sync(str(job_id))
            _clear_cancel_event(job_id)
            return

        last_cancel_db_check = 0.0
        cancelled_in_db = False

        def cancel_check() -> bool:
            nonlocal last_cancel_db_check, cancelled_in_db
            if cancel_event.is_set():
                return True

            now = time.time()
            if now - last_cancel_db_check < 1.0:
                return cancelled_in_db

            last_cancel_db_check = now
            try:
                with Session(db_engine) as cancel_session:
                    job_row = cancel_session.get(Job, job_id)
                    cancelled_in_db = bool(job_row and job_row.status == "cancelled")
            except Exception:
                cancelled_in_db = False

            if cancelled_in_db:
                cancel_event.set()
            return cancelled_in_db

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
            _clear_cancel_event(job_id)
            return

        final_graph: dict | None = None
        bypass_nodes: list[str] = []
        working_params: dict = {}

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

            # Also respect ComfyUI graph-level bypass markers (mode: 4) for imported workflows.
            for node_id, node in list(final_graph.items()):
                if isinstance(node, dict) and node.get("mode") == 4:
                    bypass_nodes.append(str(node_id))
             
            for key in list(working_params.keys()):
                 # Seed Handling
                 if "seed" in key.lower() and str(working_params[key]) == "-1":
                     working_params[key] = random.randint(1, 1125899906842624)
                 
                 # Explicit Backend Bypass Key
                 if key.startswith("__bypass_") and working_params[key] is True:
                     node_id = key.replace("__bypass_", "")
                     bypass_nodes.append(node_id)
                     # Keep __bypass_ keys for metadata/regeneration
                     # del working_params[key]
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

            # Apply bypass by rewiring and removing nodes from the prompt graph.
            # Prefer ComfyUI object_info for type-aware pass-through when available.
            object_info = None
            if bypass_nodes:
                try:
                    object_info = client.get_object_info()
                except Exception:
                    object_info = None
            apply_bypass_to_graph(final_graph, bypass_nodes, object_info=object_info)
            if bypass_nodes:
                _prune_type_mismatched_optional_links(final_graph, object_info)

            node_mapping = workflow.node_mapping if isinstance(workflow.node_mapping, dict) else {}
            node_mapping = dict(node_mapping) if node_mapping else {}
            schema = workflow.input_schema or {}
            if schema:
                schema_mapping = _build_node_mapping_from_schema(schema)
                # Schema (x_node_id + mock_field) is authoritative for UI-exposed keys.
                # This prevents stale node_mapping entries from silently targeting the wrong node after graph edits.
                for key, mapping in schema_mapping.items():
                    existing = node_mapping.get(key)
                    if GRAPH_AUDIT and existing and existing != mapping:
                        print(f"[JobProcessor] Mapping override for '{key}': {existing} -> {mapping}")
                    node_mapping[key] = mapping

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

            audit_report: dict[str, Any] | None = None
            if GRAPH_AUDIT:
                try:
                    audit_report = _build_graph_audit_report(
                        final_graph,
                        engine=engine,
                        workflow=workflow,
                        params=working_params,
                        bypass_nodes=bypass_nodes,
                    )
                    if audit_report.get("warnings"):
                        for warning in audit_report["warnings"]:
                            print(f"[JobProcessor][GraphAudit] {warning}")
                except Exception as e:
                    print(f"[JobProcessor] Graph audit failed: {e}")

            # Debug: Dump graph (+ audit) to file(s)
            if DUMP_GRAPH:
                _dump_prompt_graph_and_audit(job_id, final_graph, bypass_nodes, working_params, audit=audit_report)

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
                "params": {k: v for k, v in working_params.items() if k != "metadata" and (not k.startswith("__") or k.startswith("__bypass_"))}
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
            image_metadata["generation_params"] = {k: v for k, v in working_params.items() if k != "metadata" and (not k.startswith("__") or k.startswith("__bypass_"))}
            
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

            if cancel_check():
                print(f"[JobProcessor] Job {job_id} cancelled before queueing prompt")
                manager.close_job_sync(str(job_id))
                return

            try:
                prompt_id = client.queue_prompt(final_graph)
            except ComfyResponseError as e:
                dump_paths = _dump_failed_prompt_graph(job_id, final_graph, bypass_nodes, working_params, str(e))
                if dump_paths:
                    joined = "; ".join(dump_paths)
                    raise ComfyResponseError(f"{e} (debug graph: {joined})") from e
                raise
            job.comfy_prompt_id = prompt_id
            session.add(job)
            session.commit()

            if cancel_check():
                print(f"[JobProcessor] Job {job_id} cancelled after queueing prompt {prompt_id}, stopping")
                try:
                    client.cancel_prompt(prompt_id)
                except Exception:
                    pass
                manager.close_job_sync(str(job_id))
                return
             
            manager.broadcast_sync({"type": "started", "prompt_id": prompt_id}, str(job_id))
             
            # Pass callback to get_images - enable timing tracking for execution stats
            outputs, execution_metrics = client.get_images(
                prompt_id,
                progress_callback=on_progress,
                on_image_callback=on_image_captured,
                track_timing=True,
                workflow_graph=final_graph,
                cancel_check=cancel_check,
            )

            # Optional: dump ComfyUI history (includes computed outputs for "calculated" nodes).
            if DUMP_COMFY_HISTORY:
                try:
                    history_map = client.get_history(prompt_id)
                    history = None
                    if isinstance(history_map, dict):
                        history = history_map.get(prompt_id) or history_map.get(str(prompt_id))
                        if history is None and prompt_id in history_map:
                            history = history_map[prompt_id]

                    history_outputs = history.get("outputs") if isinstance(history, dict) else None

                    object_info = None
                    try:
                        object_info = client.get_object_info()
                    except Exception:
                        object_info = None

                    history_resolved = _resolve_scalar_links_from_history(
                        final_graph,
                        object_info=object_info,
                        history_outputs=history_outputs,
                    )
                    _dump_comfy_history_and_resolved(
                        job_id,
                        prompt_id=prompt_id,
                        graph=final_graph,
                        history_map=history_map if isinstance(history_map, dict) else {"raw": history_map},
                        history_resolved=history_resolved,
                    )
                except Exception as exc:
                    print(f"[JobProcessor] Failed to dump ComfyUI history for job {job_id}: {exc}")
            
            # CRITICAL: Re-check cancellation after execution completes
            # This catches cancellations that happened during ComfyUI execution
            session.refresh(job)
            if job.status == "cancelled" or cancel_event.is_set():
                print(f"[JobProcessor] Job {job_id} was cancelled during execution, stopping")
                manager.close_job_sync(str(job_id))
                return
            
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
                    # Preserve save node naming pattern across batch outputs
                    preferred_name = _derive_output_filename(
                        original_name, seq_num, original_ext, filename_prefix, save_dir
                    )
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
                if k != "metadata" and (not k.startswith("__") or k.startswith("__bypass_"))
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
            
            # Store execution statistics
            _store_execution_stats(
                session,
                job_id,
                execution_metrics,
            )
            
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
            if isinstance(final_graph, dict):
                _dump_failed_prompt_graph(job_id, final_graph, bypass_nodes, working_params, str(e))
            job.status = "failed"
            job.error = str(e)
            session.add(job)
            session.commit()
            manager.broadcast_sync({"type": "error", "message": str(e)}, str(job_id))
            manager.close_job_sync(str(job_id))

        except Exception as e:
            if isinstance(final_graph, dict):
                _dump_failed_prompt_graph(job_id, final_graph, bypass_nodes, working_params, str(e))
            job.status = "failed"
            job.error = str(e)
            session.add(job)
            session.commit()
            manager.broadcast_sync({"type": "error", "message": str(e)}, str(job_id))
            manager.close_job_sync(str(job_id))

        finally:
            _clear_cancel_event(job_id)
