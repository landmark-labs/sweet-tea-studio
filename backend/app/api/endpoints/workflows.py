import hashlib
import json
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


def _infer_media_kind(val_type: Any, config: Optional[Dict[str, Any]]) -> Optional[str]:
    if isinstance(val_type, str):
        kind = MEDIA_KIND_BY_TYPE.get(val_type.upper())
        if kind:
            return kind

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
            
            media_kind = _infer_media_kind(val_type, config)
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
        workflows = session.exec(select(WorkflowTemplate).offset(skip).limit(limit)).all()
        
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
             merged_graph = WorkflowMerger.merge(w_source.graph_json, w_target.graph_json)
        except Exception as e:
             raise HTTPException(status_code=500, detail=f"Merge failed: {str(e)}")
        
        # Verify engine for schema gen
        engine = session.exec(select(Engine)).first()
        client = ComfyClient(engine) if engine else None
        object_info = client.get_object_info() if client else {}
        
        # Schema
        schema = generate_schema_from_graph(merged_graph, object_info)
        
        # Create Record
        new_workflow = WorkflowTemplate(
            name=req.name,
            description=_clean_description(req.description)
            or f"Composed from '{w_source.name}' + '{w_target.name}'",
            graph_json=merged_graph,
            input_schema=schema
        )
        
        session.add(new_workflow)
        session.commit()
        session.refresh(new_workflow)
        
        return new_workflow
