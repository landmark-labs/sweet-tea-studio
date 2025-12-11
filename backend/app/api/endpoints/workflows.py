from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel

from app.db.engine import engine as db_engine
from app.models.workflow import WorkflowTemplate, WorkflowTemplateCreate, WorkflowTemplateRead
from app.models.engine import Engine
from app.core.comfy_client import ComfyClient
from app.core.workflow_merger import WorkflowMerger

router = APIRouter()

def generate_schema_from_graph(graph: Dict[str, Any], object_info: Dict[str, Any]) -> Dict[str, Any]:
    schema = {}
    
    # We want to expose widgets. 
    # Logic: Iterate nodes, look at class_type, find widgets in object_info.
    # Group by class_type to handle dupes.
    
    node_counts = {}
    
    # Sort by ID to have stable order (string IDs)
    for node_id in sorted(graph.keys(), key=lambda x: int(x) if x.isdigit() else x):
        node = graph[node_id]
        class_type = node.get("class_type")
        if not class_type:
            continue
            
        # Check against object_info
        if class_type not in object_info:
            continue # Skip missing nodes for schema generation (validation handles warning)
            
        node_def = object_info[class_type]
        input_conf = node_def.get("input", {})
        required = input_conf.get("required", {})
        optional = input_conf.get("optional", {})
        
        # Merge inputs
        all_inputs = {**required, **optional}
        
        # Track counts for unique naming
        if class_type not in node_counts:
            node_counts[class_type] = 0
        node_counts[class_type] += 1
        count = node_counts[class_type]
        
        # Suffix for dupes: KSampler (no suffix), KSampler_2, etc.
        suffix = "" if count == 1 else f"_{count}"
        
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
            field_key = f"{class_type}{suffix}.{input_name}"
            
            # Simple mapping logic
            if val_type == "INT":
                # Special case: Allow -1 for seed fields (randomize on each run)
                min_val = config.get("min")
                if "seed" in input_name.lower() and min_val is not None and min_val > -1:
                    min_val = -1
                
                schema[field_key] = {
                    "type": "integer", 
                    "title": f"{input_name} ({class_type}{suffix})",
                    "default": current_val if current_val is not None else 0,
                    "minimum": min_val,
                    "maximum": config.get("max"),
                    "x_node_id": node_id,
                    "x_class_type": class_type,
                    "x_title": node.get("_meta", {}).get("title", class_type)
                }

            elif val_type == "FLOAT":
                schema[field_key] = {
                    "type": "number", 
                    "title": f"{input_name} ({class_type}{suffix})",
                    "default": current_val if current_val is not None else 0.0,
                    "minimum": config.get("min"),
                    "maximum": config.get("max"),
                    "step": config.get("step", 0.01),
                    "x_node_id": node_id,
                    "x_class_type": class_type,
                    "x_title": node.get("_meta", {}).get("title", class_type)
                }
            elif val_type == "STRING":
                 # Check for multiline
                widget = "textarea" if config.get("multiline") else "text"
                schema[field_key] = {
                    "type": "string",
                    "title": f"{(node.get('_meta', {}).get('title') or input_name)}", 
                    "default": current_val if current_val is not None else "",
                    "widget": widget,
                    "x_node_id": node_id,
                    "x_class_type": class_type,
                    "x_title": node.get("_meta", {}).get("title", class_type)
                }
            elif isinstance(val_type, list):
                # Enum
                # Special case for LoadImage nodes
                if class_type == "LoadImage" and input_name == "image":
                    schema[field_key] = {
                        "type": "string",
                        "title": f"Image ({class_type}{suffix})",
                        "default": current_val if current_val is not None else (val_type[0] if val_type else ""),
                        "widget": "image_upload", # Force specialized widget
                        "enum": val_type, # Pass available files as options
                        "x_node_id": node_id,
                        "x_class_type": class_type,
                        "x_title": node.get("_meta", {}).get("title", class_type)
                    }
                else:
                    schema[field_key] = {
                        "type": "string",
                        "title": f"{input_name} ({class_type}{suffix})",
                        "default": current_val if current_val is not None else val_type[0],
                        "enum": val_type,
                        "x_node_id": node_id,
                        "x_class_type": class_type,
                        "x_title": node.get("_meta", {}).get("title", class_type)
                    }

    return schema


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
            
            # Generate default helper mapping as well
            workflow_in.node_mapping = {}
            for key, field_def in workflow_in.input_schema.items():
                if "x_node_id" in field_def:
                    # We preserve x_ metadata in the schema for UI grouping!
                    workflow_in.node_mapping[key] = {
                        "node_id": field_def["x_node_id"],
                        "field": f"inputs.{field_def.get('mock_field', key.split('.')[-1])}" # fallback logic
                    }

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
            description=f"Composed from '{w_source.name}' + '{w_target.name}'",
            graph_json=merged_graph,
            input_schema=schema
        )
        
        session.add(new_workflow)
        session.commit()
        session.refresh(new_workflow)
        
        return new_workflow
