import hashlib
import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from sqlmodel import Session, select
from pydantic import BaseModel, Field

from app.db.engine import engine as db_engine
from app.models.workflow import WorkflowTemplate, WorkflowTemplateCreate, WorkflowTemplateRead
from app.models.engine import Engine
from app.core.comfy_client import ComfyClient
from app.core.workflow_merger import WorkflowMerger

router = APIRouter()
logger = logging.getLogger(__name__)


def _clean_description(description: Optional[str]) -> Optional[str]:
    """Normalize optional descriptions by trimming whitespace and empty strings."""

    if description is None:
        return None
    cleaned = description.strip()
    return cleaned or None
EXPORT_VERSION = 1


def _hash_structure(data: Any) -> str:
    serialized = json.dumps(data, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _build_export_bundle(workflow: WorkflowTemplate) -> Dict[str, Any]:
    graph = workflow.graph_json or {}
    input_schema = workflow.input_schema or {}
    node_mapping = workflow.node_mapping or {}

    graph_hash = _hash_structure(graph)
    schema_hash = _hash_structure(input_schema)
    bundle_hash = _hash_structure({
        "workflow": graph,
        "input_schema": input_schema,
        "node_mapping": node_mapping,
        "name": workflow.name,
        "description": workflow.description,
    })

    metadata = {
        "version": EXPORT_VERSION,
        "name": workflow.name,
        "description": workflow.description,
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "input_schema": input_schema,
        "node_mapping": node_mapping,
        "integrity": {
            "graph_sha256": graph_hash,
            "input_schema_sha256": schema_hash,
            "bundle_sha256": bundle_hash,
        },
        "settings": {
            "node_count": len(graph.keys()),
            "input_schema_count": len(input_schema.keys()),
            "node_mapping_count": len(node_mapping.keys()) if isinstance(node_mapping, dict) else 0,
        },
        "source": "sweet-tea-studio",
        "comfy_format": "api",
        "notes": "Contains ComfyUI API graph plus Sweet Tea Studio pipe metadata.",
    }

    return {
        "workflow": graph,
        "_sweet_tea": metadata,
    }

class WorkflowImportRequest(BaseModel):
    data: Dict[str, Any]
    name: Optional[str] = None
    description: Optional[str] = None


MEDIA_KIND_BY_TYPE = {
    "IMAGE": "image",
    "MASK": "image",
    "VIDEO": "video",
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".mkv", ".avi"}


def _infer_media_kind(
    val_type: Any,
    config: Optional[Dict[str, Any]],
    input_name: Optional[str],
    class_type: Optional[str],
) -> Optional[str]:
    if isinstance(val_type, str):
        upper_type = val_type.upper()
        kind = MEDIA_KIND_BY_TYPE.get(val_type.upper())
        if kind:
            return kind
        if "VIDEO" in upper_type and input_name and input_name.lower() == "video":
            return "video"

    if isinstance(config, dict):
        config_type = config.get("type") or config.get("input_type") or config.get("media_type")
        if isinstance(config_type, str):
            kind = MEDIA_KIND_BY_TYPE.get(config_type.upper())
            if kind:
                return kind

    if isinstance(val_type, list):
        for entry in val_type:
            if not isinstance(entry, str):
                continue
            ext = os.path.splitext(entry)[1].lower()
            if ext in IMAGE_EXTENSIONS:
                return "image"
            if ext in VIDEO_EXTENSIONS:
                return "video"

    if input_name and class_type:
        lower_input = input_name.lower()
        lower_class = class_type.lower()
        if lower_input == "video" and "loadvideo" in lower_class:
            return "video"

    return None


def generate_schema_from_graph(graph: Dict[str, Any], object_info: Dict[str, Any]) -> Dict[str, Any]:
    schema: Dict[str, Any] = {}
    
    # We want to expose widgets. 
    # Logic: Iterate nodes, look at class_type, find widgets in object_info.
    # Group by class_type to handle dupes.
    
    node_counts: Dict[str, int] = {}
    node_meta: Dict[str, Any] = {}
    
    # Sort by ID to have stable order (string IDs)
    ordered_node_ids = sorted(
        graph.keys(), 
        key=lambda x: int(x) if str(x).isdigit() else x
    )
    
    for node_id in ordered_node_ids:
        node = graph[node_id]
        class_type = node.get("class_type")
        title = node.get("_meta", {}).get("title", class_type)

        node_meta[node_id] = {
            "class_type": class_type,
            "title": title,
            "skipped": None,
        }

        if not class_type:
            node_meta[node_id]["skipped"] = "missing_class_type"
            continue
            
        # Check against object_info
        if class_type not in object_info:
            node_meta[node_id]["skipped"] = "unknown_node_type"
            continue # Skip missing nodes for schema generation (validation handles warning)
            
        node_def = object_info[class_type]
        input_conf = node_def.get("input", {})
        required = input_conf.get("required", {})
        optional = input_conf.get("optional", {})
        node_meta[node_id]["input_count"] = len(required) + len(optional)
        
        # Merge inputs
        all_inputs = {**required, **optional}
        
        # Track counts for display naming
        if class_type not in node_counts:
            node_counts[class_type] = 0
        node_counts[class_type] += 1
        count = node_counts[class_type]
        
        fields_added = False

        for input_name, input_config in all_inputs.items():
            # input_config is [type, config_dict] e.g. ["INT", {"default": 20...}]
            if not isinstance(input_config, list):
                continue
            
            # Check if this input is actually a LINK (connected to another node)
            # In ComfyUI graph, unconnected inputs have primitive values.
            # Connected inputs have a list value: [node_id, slot_index]
            current_val = node.get("inputs", {}).get(input_name)
            
            # If default is provided in config, fallback to it if not in node inputs
            config = input_config[1] if len(input_config) > 1 else {}
            if current_val is None:
                current_val = config.get("default")

            # CRITICAL FIX: If current_val is a list, it's a link (or invalid). 
            # We must NOT expose linked inputs as widgets.
            if isinstance(current_val, list):
                continue
                
            val_type = input_config[0]
            
            # Helper to map Comfy types to JSON Schema
            # Include node_id to make keys stable even when multiple nodes share a class_type.
            field_key = f"{class_type}#{node_id}.{input_name}"
            
            base_field = {
                "x_node_id": node_id,
                "x_class_type": class_type,
                "x_title": title or class_type,
                "x_instance": count,
            }
            
            media_kind = _infer_media_kind(val_type, config, input_name, class_type)
            if media_kind:
                schema[field_key] = {
                    "type": "string",
                    "title": f"{input_name} ({class_type}{'' if count == 1 else f' #{node_id}'})",
                    "default": current_val if current_val is not None else "",
                    "widget": "media_upload",
                    "x_media_kind": media_kind,
                    **base_field,
                }
                if isinstance(val_type, list):
                    schema[field_key]["enum"] = val_type
                fields_added = True
                continue

            # Simple mapping logic
            if val_type == "INT":
                # Special case: Allow -1 for seed fields (randomize on each run)
                min_val = config.get("min")
                if "seed" in input_name.lower() and min_val is not None and min_val > -1:
                    min_val = -1
                
                schema[field_key] = {
                    "type": "integer", 
                    "title": f"{input_name} ({class_type}{'' if count == 1 else f' #{node_id}'})",
                    "default": current_val if current_val is not None else 0,
                    "minimum": min_val,
                    "maximum": config.get("max"),
                    **base_field,
                }
                fields_added = True

            elif val_type == "FLOAT":
                schema[field_key] = {
                    "type": "number", 
                    "title": f"{input_name} ({class_type}{'' if count == 1 else f' #{node_id}'})",
                    "default": current_val if current_val is not None else 0.0,
                    "minimum": config.get("min"),
                    "maximum": config.get("max"),
                    "step": config.get("step", 0.01),
                    **base_field,
                }
                fields_added = True
            elif val_type == "STRING":
                 # Check for multiline
                widget = "textarea" if config.get("multiline") else "text"
                schema[field_key] = {
                    "type": "string",
                    "title": f"{(node.get('_meta', {}).get('title') or input_name)}", 
                    "default": current_val if current_val is not None else "",
                    "widget": widget,
                    **base_field,
                }
                fields_added = True
            elif isinstance(val_type, list):
                # Enum
                schema[field_key] = {
                    "type": "string",
                    "title": f"{input_name} ({class_type}{'' if count == 1 else f' #{node_id}'})",
                    "default": current_val if current_val is not None else (val_type[0] if val_type else ""),
                    "enum": val_type,
                    **base_field,
                }
                fields_added = True
            
            elif val_type == "COMBO":
                # Handle COMBO type which is ["COMBO", [options...]]
                # The config is in input_config[1]
                options = []
                if isinstance(config, list):
                    options = config
                elif isinstance(config, dict) and "default" not in config: 
                    # Sometimes config can be the list itself if it wasn't parsed as dict? 
                    # But based on standard structure: ["COMBO", [list]] -> val_type="COMBO", config=[list]
                    # Let's inspect 'input_config' directly from source loop if needed, but 'config' variable 
                    # was set as input_config[1].
                    pass
                
                # If the definition is ["COMBO", ["a", "b"]], then val_type="COMBO" and config=["a", "b"]
                # If the definition is ["COMBO", {"default": "a"}], this is likely invalid or handled elsewhere?
                # Actually, some nodes might use ["COMBO", { ... }] but standard combo is list.
                
                # Let's re-read the input_config to be safe because 'config' logic above assumed dict.
                raw_config = input_config[1] if len(input_config) > 1 else None
                
                if isinstance(raw_config, list):
                     options = raw_config
                
                if options:
                    schema[field_key] = {
                        "type": "string",
                        "title": f"{input_name} ({class_type}{'' if count == 1 else f' #{node_id}'})",
                        "default": current_val if current_val is not None else (options[0] if options else ""),
                        "enum": options,
                        **base_field,
                    }
                    fields_added = True

        if not fields_added and node_meta[node_id]["skipped"] is None:
            node_meta[node_id]["skipped"] = "no_exposed_inputs"

    # Attach metadata so the frontend can preserve node ordering and explain omissions
    schema["__node_order"] = [str(nid) for nid in ordered_node_ids]
    schema["__node_meta"] = node_meta
    schema["__schema_version"] = 2

    return schema


def ensure_node_order(workflow: WorkflowTemplate | WorkflowTemplateCreate):
    """Ensure __node_order exists in input_schema, generating it if missing."""
    if not workflow.input_schema or "__node_order" in workflow.input_schema:
        return
        
    graph = workflow.graph_json or {}
    if not graph:
        return
        
    # Sort by ID to have stable order (string IDs)
    ordered_node_ids = sorted(
        graph.keys(), 
        key=lambda x: int(x) if str(x).isdigit() else x
    )
    
    workflow.input_schema["__node_order"] = [str(nid) for nid in ordered_node_ids]


def _prepare_import_payload(payload: WorkflowImportRequest) -> WorkflowTemplateCreate:
    raw_data = payload.data

    # Reject ComfyUI "Saved" format (nodes as an array)
    if isinstance(raw_data, dict) and isinstance(raw_data.get("nodes"), list):
        raise HTTPException(
            status_code=400,
            detail="Detected ComfyUI save-format with a 'nodes' array. Please export using 'Save (API Format)'.",
        )

    if not isinstance(raw_data, dict):
        raise HTTPException(status_code=400, detail="Workflow payload must be a JSON object.")

    metadata = raw_data.get("_sweet_tea") if isinstance(raw_data, dict) else None

    if metadata:
        version = metadata.get("version")
        if version != EXPORT_VERSION:
            raise HTTPException(status_code=400, detail=f"Unsupported workflow export version: {version}")

        workflow_graph = raw_data.get("workflow")
        if not isinstance(workflow_graph, dict):
            raise HTTPException(status_code=400, detail="Export bundle is missing the workflow graph")

        input_schema = metadata.get("input_schema") or {}
        node_mapping = metadata.get("node_mapping") or {}
        integrity = metadata.get("integrity") or {}

        graph_hash = _hash_structure(workflow_graph)
        schema_hash = _hash_structure(input_schema)
        bundle_hash = _hash_structure({
            "workflow": workflow_graph,
            "input_schema": input_schema,
            "node_mapping": node_mapping,
            "name": metadata.get("name"),
            "description": metadata.get("description"),
        })

        if integrity.get("graph_sha256") and integrity["graph_sha256"] != graph_hash:
            raise HTTPException(status_code=400, detail="Workflow graph integrity check failed")

        if integrity.get("input_schema_sha256") and integrity["input_schema_sha256"] != schema_hash:
            raise HTTPException(status_code=400, detail="Input schema integrity check failed")

        if integrity.get("bundle_sha256") and integrity["bundle_sha256"] != bundle_hash:
            raise HTTPException(status_code=400, detail="Bundle integrity check failed")

        name = payload.name or metadata.get("name") or "imported pipe"
        description = payload.description or metadata.get("description") or "imported pipe bundle"

    else:
        workflow_graph = raw_data
        input_schema = {}
        node_mapping = None
        name = payload.name or "imported pipe"
        description = payload.description or "imported from ComfyUI API format"

    if not isinstance(workflow_graph, dict):
        raise HTTPException(status_code=400, detail="Workflow graph must be an object with node definitions")

    return WorkflowTemplateCreate(
        name=name,
        description=description,
        graph_json=workflow_graph,
        input_schema=input_schema,
        node_mapping=node_mapping,
    )


@router.post("/import", response_model=WorkflowTemplate)
def import_workflow(payload: WorkflowImportRequest):
    workflow_in = _prepare_import_payload(payload)
    return create_workflow(workflow_in)


@router.get("/{workflow_id}/export")
def export_workflow(workflow_id: int):
    with Session(db_engine) as session:
        workflow = session.get(WorkflowTemplate, workflow_id)
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")

        bundle = _build_export_bundle(workflow)
        filename = workflow.name.lower().replace(" ", "_") + ".json"
        return JSONResponse(
            content=bundle,
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )


@router.post("/", response_model=WorkflowTemplate)
def create_workflow(workflow_in: WorkflowTemplateCreate):
    with Session(db_engine) as session:
        # 1. Fetch Engine to Validate (Use first found engine for now)
        engine = session.exec(select(Engine)).first()
        if not engine:
             # Fallback if no engine: just save without fancy validation? 
             # Or error? Let's error for now as validation is requested.
             raise HTTPException(status_code=400, detail="No active Engine found to validate workflow.")
        
        client = ComfyClient(engine)
        try:
            object_info = client.get_object_info()
        except Exception as e:
            # If Comfy is down, we might want to allow creation anyway? 
            # But we need object_info for schema generation.
            # Let's fail for now to ensure quality.
            raise HTTPException(status_code=503, detail=f"Failed to connect to ComfyUI for validation: {str(e)}")

        # 2. Validate Missing Nodes
        graph = workflow_in.graph_json
        missing_nodes = []
        for node_id, node in graph.items():
            ctype = node.get("class_type")
            if ctype and ctype not in object_info:
                missing_nodes.append(ctype)
        
        missing_nodes = list(set(missing_nodes))

        # 3. Generate Schema if not provided/empty
        if not workflow_in.input_schema:
            workflow_in.input_schema = generate_schema_from_graph(graph, object_info)
        else:
            # Ensure __node_order exists if a pre-existing schema was provided (e.g. from import)
            ensure_node_order(workflow_in)
            
        # Generate default helper mapping as well
        workflow_in.node_mapping = {}
        for key, field_def in workflow_in.input_schema.items():
            if key.startswith("__"):
                continue
            if not isinstance(field_def, dict) or "x_node_id" not in field_def:
                continue
            # We preserve x_ metadata in the schema for UI grouping!
            workflow_in.node_mapping[key] = {
                "node_id": field_def["x_node_id"],
                "field": f"inputs.{field_def.get('mock_field', key.split('.')[-1])}" # fallback logic
            }

        workflow_in.description = _clean_description(workflow_in.description)

        # Create
        db_workflow = WorkflowTemplate.from_orm(workflow_in)
        if missing_nodes:
            db_workflow.description = (db_workflow.description or "") + f" [Missing Nodes: {', '.join(missing_nodes)}]"
            
        session.add(db_workflow)
        session.commit()
        session.refresh(db_workflow)
        return db_workflow


@router.get("/", response_model=List[WorkflowTemplateRead])
def read_workflows(skip: int = 0, limit: int = 100):
    with Session(db_engine) as session:
        workflows = session.exec(
            select(WorkflowTemplate)
            .order_by(WorkflowTemplate.display_order, WorkflowTemplate.id)
            .offset(skip)
            .limit(limit)
        ).all()
        
        # Batch Self-Healing
        # Check if any workflow needs healing
        needs_healing = [w for w in workflows if w.description and "[Missing Nodes:" in w.description]
        
        if needs_healing:
            try:
                engine = session.exec(select(Engine)).first()
                if engine:
                    client = ComfyClient(engine)
                    object_info = client.get_object_info()
                    import re
                    
                    for w in needs_healing:
                        graph = w.graph_json
                        still_missing = []
                        for node_id, node in graph.items():
                             ctype = node.get("class_type")
                             if ctype and ctype not in object_info:
                                 still_missing.append(ctype)
                        
                        still_missing = list(set(still_missing))
                        
                        desc = w.description
                        desc = re.sub(r'\s*\[Missing Nodes:.*?\]', '', desc)
                        
                        if still_missing:
                             desc = desc + f" [Missing Nodes: {', '.join(still_missing)}]"
                        
                        if desc != w.description:
                             w.description = desc
                             session.add(w)
                    
                    session.commit()
                    for w in workflows:
                        session.refresh(w)
            except Exception as e:
                print(f"Batch self-heal failed: {e}")
                
        return workflows


@router.get("/{workflow_id}", response_model=WorkflowTemplateRead)
def read_workflow(workflow_id: int):
    with Session(db_engine) as session:
        workflow = session.get(WorkflowTemplate, workflow_id)
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")
        
        # Self-Healing: Check if description contains "[Missing Nodes:" and re-validate
        if workflow.description and "[Missing Nodes:" in workflow.description:
             try:
                 # Check current engine state
                 engine = session.exec(select(Engine)).first()
                 if engine:
                     client = ComfyClient(engine)
                     object_info = client.get_object_info()
                     
                     # Check if nodes are STILL missing
                     graph = workflow.graph_json
                     still_missing = []
                     for node_id, node in graph.items():
                         ctype = node.get("class_type")
                         if ctype and ctype not in object_info:
                             still_missing.append(ctype)
                     
                     still_missing = list(set(still_missing))
                     
                     # Update description
                     import re
                     desc = workflow.description
                     # Remove old tag
                     desc = re.sub(r'\s*\[Missing Nodes:.*?\]', '', desc)
                     
                     if still_missing:
                         desc = desc + f" [Missing Nodes: {', '.join(still_missing)}]"
                     
                     if desc != workflow.description:
                         workflow.description = desc
                         session.add(workflow)
                         session.commit()
                         session.refresh(workflow)
                         
             except Exception as e:
                 # If validation fails (e.g. Comfy offline), just return existing record
                 print(f"Self-heal validation failed: {e}")

        return workflow

@router.put("/{workflow_id}", response_model=WorkflowTemplate)
def update_workflow(workflow_id: int, workflow_in: WorkflowTemplateCreate):
    with Session(db_engine) as session:
        workflow = session.get(WorkflowTemplate, workflow_id)
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")

        # Backfill metadata if missing in the new data
        ensure_node_order(workflow_in)

        workflow_in.description = _clean_description(workflow_in.description)
        workflow_data = workflow_in.dict(exclude_unset=True)
        for key, value in workflow_data.items():
            setattr(workflow, key, value)

        session.add(workflow)
        session.commit()
        session.refresh(workflow)
        return workflow


@router.delete("/{workflow_id}")
def delete_workflow(workflow_id: int):
    with Session(db_engine) as session:
        workflow = session.get(WorkflowTemplate, workflow_id)
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")
        session.delete(workflow)
        session.commit()
        return {"ok": True}

class WorkflowReorderItem(BaseModel):
    id: int
    display_order: int


@router.patch("/reorder")
def reorder_workflows(items: List[WorkflowReorderItem]):
    """Bulk update display_order for multiple workflows."""
    with Session(db_engine) as session:
        for item in items:
            workflow = session.get(WorkflowTemplate, item.id)
            if workflow:
                workflow.display_order = item.display_order
                session.add(workflow)
        session.commit()
        return {"ok": True, "updated": len(items)}


def _merge_schemas(
    source_schema: Dict[str, Any],
    target_schema: Dict[str, Any],
    target_id_map: Dict[str, str],
    removed_node_ids: List[str],
) -> Dict[str, Any]:
    """
    Merge input_schema from source and target workflows for composition.
    
    - Source schema entries are copied as-is (node IDs unchanged)
    - Target schema entries have their x_node_id remapped using target_id_map
    - __bypass_* keys are remapped with new node IDs
    - __node_order is merged (source first, then remapped target, excluding removed nodes)
    - Entries for removed nodes (bridge nodes) are skipped
    """
    merged: Dict[str, Any] = {}
    
    # Helper to check if a node ID was removed
    removed_set = set(removed_node_ids)
    
    # 1. Copy source schema entries directly
    for key, value in source_schema.items():
        if key.startswith("__"):
            continue  # Handle meta keys separately
        if not isinstance(value, dict):
            continue
        merged[key] = value.copy()
    
    # 2. Copy target schema entries with remapped node IDs
    for key, value in target_schema.items():
        if key.startswith("__"):
            continue  # Handle meta keys separately
        if not isinstance(value, dict):
            continue
            
        old_node_id = str(value.get("x_node_id", ""))
        new_node_id = target_id_map.get(old_node_id)
        
        # Skip if node was removed (bridge node) or not in the map
        if new_node_id in removed_set:
            continue
        
        if new_node_id:
            # Create a new entry with remapped node ID
            new_value = value.copy()
            new_value["x_node_id"] = new_node_id
            
            # Remap the key if it contains the node ID (e.g., "ClassName#12.field")
            if f"#{old_node_id}." in key:
                new_key = key.replace(f"#{old_node_id}.", f"#{new_node_id}.")
            else:
                new_key = key
            
            merged[new_key] = new_value
        else:
            # Fallback: copy as-is if no mapping found
            merged[key] = value.copy()
    
    # 3. Handle __bypass_* keys from both schemas
    for key, value in source_schema.items():
        if key.startswith("__bypass_"):
            merged[key] = value.copy() if isinstance(value, dict) else value
            
    for key, value in target_schema.items():
        if key.startswith("__bypass_"):
            # Extract old node ID and remap
            old_node_id = key.replace("__bypass_", "")
            new_node_id = target_id_map.get(old_node_id)
            
            if new_node_id and new_node_id not in removed_set:
                new_key = f"__bypass_{new_node_id}"
                new_value = value.copy() if isinstance(value, dict) else value
                if isinstance(new_value, dict) and "x_node_id" in new_value:
                    new_value["x_node_id"] = new_node_id
                merged[new_key] = new_value
    
    # 4. Merge __node_order (source first, then remapped target, excluding removed)
    source_order = source_schema.get("__node_order", [])
    target_order = target_schema.get("__node_order", [])
    
    merged_order = list(source_order)  # Copy source order
    for old_id in target_order:
        new_id = target_id_map.get(str(old_id))
        if new_id and new_id not in removed_set:
            merged_order.append(new_id)
    
    merged["__node_order"] = merged_order
    
    # 5. Copy other meta fields
    if "__schema_version" in source_schema:
        merged["__schema_version"] = source_schema["__schema_version"]
    elif "__schema_version" in target_schema:
        merged["__schema_version"] = target_schema["__schema_version"]
    
    return merged


class WorkflowComposeRequest(BaseModel):
    source_id: int
    target_id: int
    name: str
    description: Optional[str] = Field(default=None, max_length=500)

@router.post("/compose", response_model=WorkflowTemplate)
def compose_workflows(req: WorkflowComposeRequest):
    with Session(db_engine) as session:
        w_source = session.get(WorkflowTemplate, req.source_id)
        w_target = session.get(WorkflowTemplate, req.target_id)
        
        if not w_source or not w_target:
             raise HTTPException(status_code=404, detail="One or more workflows not found.")
             
        # Merge
        try:
             merge_result = WorkflowMerger.merge(w_source.graph_json, w_target.graph_json)
        except Exception as e:
             raise HTTPException(status_code=500, detail=f"Merge failed: {str(e)}")
        
        # Check merge result and log warnings
        if not merge_result.success and merge_result.warnings:
            warning_text = " | ".join(merge_result.warnings)
            logger.warning(f"Compose merge incomplete: {warning_text}")
        
        # Merge schemas from both workflows instead of regenerating
        # This preserves pipe editor settings (bypasses, aliases, visibility, etc.)
        source_schema = w_source.input_schema or {}
        target_schema = w_target.input_schema or {}
        schema = _merge_schemas(
            source_schema,
            target_schema,
            merge_result.target_id_map,
            merge_result.removed_nodes,
        )
        
        # Build description with merge status
        base_description = _clean_description(req.description) or f"Composed from '{w_source.name}' + '{w_target.name}'"
        
        if not merge_result.success and merge_result.warnings:
            warning_summary = "; ".join(merge_result.warnings[:2])
            base_description = f"{base_description} [Merge Warning: {warning_summary}]"
        
        # Create Record
        new_workflow = WorkflowTemplate(
            name=req.name,
            description=base_description,
            graph_json=merge_result.graph,
            input_schema=schema
        )
        
        session.add(new_workflow)
        session.commit()
        session.refresh(new_workflow)
        
        return new_workflow
