"""Metadata helpers for gallery endpoints."""

import io
import json
import os
import re
from datetime import datetime
from typing import Any, Dict, Optional

from PIL import Image as PILImage, ExifTags, ImageOps


def _decode_xp_comment(raw: Any) -> Optional[str]:
    """
    Decode Windows XPComment (UTF-16LE with null terminator) or generic bytes.
    """
    if raw is None:
        return None
    if isinstance(raw, bytes):
        try:
            return raw.decode("utf-16le", errors="ignore").rstrip("\x00")
        except Exception:
            try:
                return raw.decode("utf-8", errors="ignore")
            except Exception:
                return None
    if isinstance(raw, str):
        return raw
    return None


def _coerce_json_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _compute_ahash(img: PILImage.Image, size: int = 16) -> str:
    """
    Compute a simple average-hash (aHash) for rename/move matching.

    Returns a fixed-width hex string (size*size bits).
    """
    try:
        resample = getattr(PILImage, "Resampling", PILImage).LANCZOS
    except Exception:
        resample = getattr(PILImage, "LANCZOS", 1)

    small = img.convert("L").resize((size, size), resample=resample)
    pixels = list(small.getdata())
    if not pixels:
        return ""
    avg = sum(pixels) / len(pixels)
    bits = "".join("1" if px > avg else "0" for px in pixels)
    return hex(int(bits, 2))[2:].zfill((size * size) // 4)


def _ahash_for_thumbnail_bytes(data: bytes) -> Optional[str]:
    if not data:
        return None
    try:
        with PILImage.open(io.BytesIO(data)) as img:
            return _compute_ahash(img)
    except Exception:
        return None


def _ahash_for_image_path(path: str) -> Optional[str]:
    if not path:
        return None
    try:
        with PILImage.open(path) as img:
            return _compute_ahash(img)
    except Exception:
        return None


def _safe_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.isdigit():
            try:
                return int(stripped)
            except Exception:
                return None
    return None


def _build_resync_extra_metadata(
    *,
    prompt: Optional[str],
    negative_prompt: Optional[str],
    parameters: Dict[str, Any],
    source: str,
    mtime: datetime,
    recovered: bool = True,
) -> Dict[str, Any]:
    timestamp = mtime.isoformat()
    active_prompt = {
        "stage": 0,
        "positive_text": prompt,
        "negative_text": negative_prompt,
        "timestamp": timestamp,
        "source": source or "resync",
    }
    return {
        "active_prompt": active_prompt,
        "prompt_history": [active_prompt],
        "generation_params": parameters or {},
        "recovered": recovered,
        "recovered_source": source or "resync",
        "recovered_at": timestamp,
    }


def _merge_resync_extra_metadata(
    existing: Any,
    *,
    file_metadata: Optional[Dict[str, Any]],
    mtime: datetime,
) -> tuple[Optional[Dict[str, Any]], bool]:
    """
    Backfill/normalize extra_metadata to the canonical Sweet Tea structure.

    Returns (merged_metadata, changed).
    """
    current_raw = _coerce_json_dict(existing)

    # SQLAlchemy JSON columns do not reliably track in-place mutations to nested dicts.
    # Work on a copy so callers can assign a new object when changes occur.
    try:
        import copy

        current = copy.deepcopy(current_raw)
    except Exception:
        current = dict(current_raw) if isinstance(current_raw, dict) else {}
    changed = False

    prompt = None
    negative_prompt = None
    parameters: Dict[str, Any] = {}
    source = "resync"

    if file_metadata:
        prompt = file_metadata.get("prompt")
        negative_prompt = file_metadata.get("negative_prompt")
        parameters = file_metadata.get("parameters") if isinstance(file_metadata.get("parameters"), dict) else {}
        source = str(file_metadata.get("source") or source)

    # Legacy resync payload (pre-fix): {"positive_prompt","negative_prompt","params",...}
    if not prompt and isinstance(current.get("positive_prompt"), str):
        prompt = current.get("positive_prompt")
    if not negative_prompt and isinstance(current.get("negative_prompt"), str):
        negative_prompt = current.get("negative_prompt")
    if not parameters and isinstance(current.get("params"), dict):
        parameters = current.get("params") or {}

    existing_gen_params = current.get("generation_params") if isinstance(current.get("generation_params"), dict) else {}

    # If we still don't have prompt strings, infer from parameter dicts (ComfyUI-style workflows).
    if not prompt or not isinstance(prompt, str) or not prompt.strip() or not negative_prompt or not isinstance(negative_prompt, str) or not negative_prompt.strip():
        inferred_pos, inferred_neg = _extract_prompts_from_param_dict(parameters or existing_gen_params)
        if not prompt and inferred_pos:
            prompt = inferred_pos
        if not negative_prompt and inferred_neg:
            negative_prompt = inferred_neg

    prompt = prompt.strip() if isinstance(prompt, str) and prompt.strip() else None
    negative_prompt = negative_prompt.strip() if isinstance(negative_prompt, str) and negative_prompt.strip() else None

    active_prompt = current.get("active_prompt")
    if not isinstance(active_prompt, dict):
        timestamp = mtime.isoformat()
        active_prompt = {
            "stage": 0,
            "positive_text": prompt,
            "negative_text": negative_prompt,
            "timestamp": timestamp,
            "source": source or "resync",
        }
        current["active_prompt"] = active_prompt

        # Preserve any existing generation params; merge newly recovered keys in.
        merged_params: Dict[str, Any] = dict(existing_gen_params or {})
        if parameters:
            for k, v in parameters.items():
                merged_params.setdefault(k, v)
        current["generation_params"] = merged_params

        current["prompt_history"] = [active_prompt]
        if current.get("recovered") is None:
            current["recovered"] = True
        if not current.get("recovered_source"):
            current["recovered_source"] = source or "resync"
        if not current.get("recovered_at"):
            current["recovered_at"] = timestamp
        changed = True
        return current, changed

    if prompt and not active_prompt.get("positive_text"):
        active_prompt["positive_text"] = prompt
        changed = True
    if negative_prompt and not active_prompt.get("negative_text"):
        active_prompt["negative_text"] = negative_prompt
        changed = True

    raw_history = current.get("prompt_history")
    if not isinstance(raw_history, list):
        current["prompt_history"] = [active_prompt]
        changed = True
    else:
        history = [entry for entry in raw_history if isinstance(entry, dict)]
        if history != raw_history:
            current["prompt_history"] = history
            changed = True
        if not history:
            current["prompt_history"] = [active_prompt]
            changed = True
        else:
            stage0 = None
            for entry in history:
                if entry.get("stage") == 0:
                    stage0 = entry
                    break
            if stage0:
                if prompt and not stage0.get("positive_text"):
                    stage0["positive_text"] = prompt
                    changed = True
                if negative_prompt and not stage0.get("negative_text"):
                    stage0["negative_text"] = negative_prompt
                    changed = True

    gen_params = current.get("generation_params")
    if not isinstance(gen_params, dict):
        merged_params: Dict[str, Any] = dict(existing_gen_params or {})
        if parameters:
            for k, v in parameters.items():
                merged_params.setdefault(k, v)
        current["generation_params"] = merged_params
        changed = True
    elif parameters:
        for k, v in parameters.items():
            if k not in gen_params:
                gen_params[k] = v
                changed = True

    if current.get("recovered") is None:
        current["recovered"] = True
        changed = True
    if not current.get("recovered_source"):
        current["recovered_source"] = source
        changed = True

    return current, changed


def _extract_metadata_from_file(file_path: str) -> Optional[Dict[str, Any]]:
    """
    Extract metadata from an image file (PNG, JPEG) for resync.

    Returns a dict with prompt, negative_prompt, parameters, and source,
    or None if no metadata could be extracted.
    """
    try:
        with PILImage.open(file_path) as img:
            info = img.info or {}
            result = {
                "prompt": None,
                "negative_prompt": None,
                "parameters": {},
                "source": "none"
            }

            # Try comment metadata (PNG text chunks, JPEG comment segments, EXIF XPComment/UserComment)
            try:
                comment_text = None
                for key in ("comment", "Comment", "Description", "parameters", "Parameters"):
                    if key in info and info.get(key):
                        comment_text = _decode_xp_comment(info.get(key))
                        if comment_text:
                            break

                exif = None
                try:
                    exif = img.getexif()
                except Exception:
                    exif = None

                if not comment_text and exif:
                    XP_COMMENT_TAG = 0x9C9C  # 40092
                    if XP_COMMENT_TAG in exif:
                        comment_text = _decode_xp_comment(exif[XP_COMMENT_TAG])

                    if not comment_text:
                        for tag_id, value in exif.items():
                            tag_name = ExifTags.TAGS.get(tag_id, tag_id)
                            if str(tag_name).lower() in {"xpcomment", "usercomment", "comment"}:
                                comment_text = _decode_xp_comment(value)
                                if comment_text:
                                    break

                if comment_text:
                    parsed = _extract_prompts_from_comment_blob(comment_text)
                    if parsed.get("prompt"):
                        result["prompt"] = parsed.get("prompt")
                    if parsed.get("negative_prompt"):
                        result["negative_prompt"] = parsed.get("negative_prompt")
                    if isinstance(parsed.get("parameters"), dict) and parsed.get("parameters"):
                        result["parameters"].update(parsed.get("parameters") or {})
                    if result["prompt"] or result["negative_prompt"] or result["parameters"]:
                        result["source"] = "comment"
            except Exception:
                pass

            # Try Sweet Tea provenance
            if "sweet_tea_provenance" in info:
                try:
                    provenance = json.loads(info["sweet_tea_provenance"])
                    result["prompt"] = result["prompt"] or provenance.get("positive_prompt")
                    result["negative_prompt"] = result["negative_prompt"] or provenance.get("negative_prompt")
                    result["parameters"] = {
                        k: v for k, v in provenance.items()
                        if k not in ["positive_prompt", "negative_prompt", "models", "params"]
                        and v is not None
                    }
                    if "params" in provenance and isinstance(provenance["params"], dict):
                        result["parameters"].update(provenance["params"])
                    result["source"] = "sweet_tea"
                except json.JSONDecodeError:
                    pass

            # Try ComfyUI "prompt" metadata
            if "prompt" in info and result["source"] == "none":
                try:
                    prompt_data = json.loads(info["prompt"])
                    for node_id, node in prompt_data.items():
                        if isinstance(node, dict):
                            class_type = node.get("class_type", "")
                            inputs = node.get("inputs", {})
                            if class_type == "CLIPTextEncode":
                                text = inputs.get("text", "")
                                if not result["prompt"]:
                                    result["prompt"] = text
                                elif not result["negative_prompt"]:
                                    result["negative_prompt"] = text
                            elif "KSampler" in class_type or "Sampler" in class_type:
                                for k in ["seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"]:
                                    if k in inputs and inputs[k] is not None:
                                        result["parameters"][k] = inputs[k]
                            elif "CheckpointLoader" in class_type or "Load Checkpoint" in class_type:
                                ckpt = inputs.get("ckpt_name")
                                if ckpt:
                                    result["parameters"]["checkpoint"] = ckpt
                    result["source"] = "comfyui"
                except json.JSONDecodeError:
                    pass

            # Return result if any metadata was found
            if result["source"] != "none" or result["prompt"] or result["negative_prompt"]:
                return result

    except Exception:
        pass

    # Try sidecar JSON file
    try:
        sidecar_path = os.path.splitext(file_path)[0] + ".json"
        if os.path.exists(sidecar_path):
            with open(sidecar_path, "r", encoding="utf-8") as sf:
                sidecar_data = json.load(sf)
                if isinstance(sidecar_data, dict):
                    result = {
                        "prompt": sidecar_data.get("positive_prompt"),
                        "negative_prompt": sidecar_data.get("negative_prompt"),
                        "parameters": {
                            k: v for k, v in sidecar_data.items()
                            if k not in {"positive_prompt", "negative_prompt"}
                        },
                        "source": "sidecar"
                    }
                    return result
    except Exception:
        pass

    return None


def _extract_prompts_from_comment_blob(comment: Optional[str]) -> Dict[str, Any]:
    """
    Parse prompt/negative prompt strings from a metadata comment blob.
    """
    result: Dict[str, Any] = {
        "prompt": None,
        "negative_prompt": None,
        "parameters": {}
    }

    if not comment:
        return result

    comment = comment.strip()
    if not comment:
        return result

    # Try JSON
    try:
        parsed = json.loads(comment)
        if isinstance(parsed, dict):
            result["prompt"] = parsed.get("prompt") or parsed.get("positive_prompt") or parsed.get("text") or parsed.get("text_positive")
            result["negative_prompt"] = parsed.get("negative_prompt") or parsed.get("text_negative") or parsed.get("negative")

            params = parsed.get("params") if isinstance(parsed.get("params"), dict) else {}
            result["parameters"].update(params)
            for k, v in parsed.items():
                if k in {"positive_prompt", "negative_prompt", "prompt", "text", "text_positive", "text_negative", "negative", "params"}:
                    continue
                if v is None or isinstance(v, (dict, list)):
                    continue
                result["parameters"][k] = v

            return result
    except json.JSONDecodeError:
        pass

    # Heuristic split on "Negative prompt:"
    # Also look for parameters line (usually at the end, starting with Steps: or Size:)

    rest_text = comment
    params_dict: Dict[str, Any] = {}

    # Try to find parameters line at the end
    lines = comment.strip().split('\n')
    if len(lines) > 0:
        last_line = lines[-1].strip()
        # Common A1111/ComfyUI text format markers
        if last_line.startswith("Steps:") or last_line.startswith("Size:") or "Sampler:" in last_line:
            # Parse parameters
            try:
                # Naive split by comma might fail if values contain commas, but it's a good start for this format
                # A better regex structure would be needed for complex cases
                items = [x.strip() for x in last_line.split(',') if x.strip()]
                for item in items:
                    if ':' in item:
                        k, v = item.split(':', 1)
                        params_dict[k.strip()] = v.strip()

                size_raw = params_dict.get("Size")
                if isinstance(size_raw, str) and "x" in size_raw:
                    w_raw, h_raw = size_raw.lower().split("x", 1)
                    try:
                        params_dict["width"] = int(w_raw.strip())
                        params_dict["height"] = int(h_raw.strip())
                    except Exception:
                        pass

                # Remove the params line from text
                rest_text = '\n'.join(lines[:-1]).strip()
                result["parameters"] = params_dict
            except Exception:
                pass

    lower = rest_text.lower()
    if "negative prompt:" in lower:
        # standard "Negative prompt:" label
        parts = re.split(r"Negative prompt:", rest_text, flags=re.IGNORECASE, maxsplit=1)
        if len(parts) == 2:
            result["prompt"] = parts[0].strip() or None
            result["negative_prompt"] = parts[1].strip() or None
            return result

    # Fallback: treat whole remaining text as positive prompt
    result["prompt"] = rest_text.strip() or None
    return result


def _extract_prompts_from_param_dict(params: Any) -> tuple[Optional[str], Optional[str]]:
    """
    Best-effort extraction of positive/negative prompts from a params dict.

    Mirrors the frontend prompt heuristics so Gallery can still render prompts
    when `active_prompt` was not populated at generation time.
    """
    if not isinstance(params, dict):
        return None, None

    def as_nonempty_string(value: Any) -> Optional[str]:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                return stripped
        return None

    entries: list[tuple[str, str]] = []
    for key, value in params.items():
        if not isinstance(key, str):
            continue
        s = as_nonempty_string(value)
        if not s:
            continue
        entries.append((key, s))

    if not entries:
        return None, None

    positive: Optional[str] = None
    negative: Optional[str] = None

    positive_keys = {"positive", "prompt", "text_positive", "text_g", "clip_l", "active_positive", "positive_prompt"}
    negative_keys = {"negative", "text_negative", "negative_prompt", "clip_l_negative", "active_negative"}

    # Pass 1: explicit keys + contains-positive/negative heuristics.
    for key, value in entries:
        lower_key = key.lower()

        if lower_key in positive_keys or ("positive" in lower_key and "negative" not in lower_key):
            if not positive or len(value) > len(positive):
                positive = value

        if lower_key in negative_keys or ("negative" in lower_key and "positive" not in lower_key):
            if not negative or len(value) > len(negative):
                negative = value

    # Pass 2: ComfyUI patterns (CLIPTextEncode.text / 6.text / STRING_LITERAL.*).
    if not positive or not negative:
        clip_nodes: list[dict[str, str]] = []
        for key, value in entries:
            lower_key = key.lower()
            is_clip_textencode = ("cliptextencode" in lower_key and ".text" in lower_key) or bool(
                re.match(r"^\\d+\\.text$", key, flags=re.IGNORECASE)
            )
            is_string_literal = ("string_literal" in lower_key) or (".string" in lower_key and "lora" not in lower_key)

            if not (is_clip_textencode or is_string_literal):
                continue

            node_match = re.match(r"^(\\d+)\\.|^([^.]+)\\.", key)
            node_id = node_match.group(1) if node_match and node_match.group(1) else (node_match.group(2) if node_match else key)
            clip_nodes.append({"key": key, "value": value, "node_id": node_id})

        def sort_key(node: dict[str, str]) -> tuple[int, str]:
            node_id = node.get("node_id") or ""
            try:
                return (0, f"{int(node_id):010d}")
            except Exception:
                return (1, node_id)

        clip_nodes.sort(key=sort_key)

        if clip_nodes and not positive:
            positive = clip_nodes[0]["value"]
        if len(clip_nodes) >= 2 and not negative:
            negative = clip_nodes[1]["value"]

    # Pass 3: title-ish hints embedded in keys.
    if not positive or not negative:
        for key, value in entries:
            if not positive and re.search(r"positive.*(prompt|text)", key, flags=re.IGNORECASE):
                positive = value
            if not negative and re.search(r"negative.*(prompt|text)", key, flags=re.IGNORECASE):
                negative = value
            if positive and negative:
                break

    return positive, negative
