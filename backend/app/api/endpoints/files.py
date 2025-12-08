from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from sqlmodel import Session, select
from app.db.database import get_session
from app.models.engine import Engine
import shutil
import os
import uuid
from typing import Optional

router = APIRouter()

@router.post("/upload")
def upload_file(
    file: UploadFile = File(...),
    engine_id: Optional[int] = Form(None),
    session: Session = Depends(get_session)
):
    # Determine target directory
    target_dir = ""
    if engine_id:
        engine = session.get(Engine, engine_id)
        if engine and engine.input_dir:
            target_dir = engine.input_dir
    
    if not target_dir:
        # Fallback to default engine if exists
        engine = session.exec(select(Engine).where(Engine.name == "Local ComfyUI")).first()
        if engine and engine.input_dir:
            target_dir = engine.input_dir
            
    if not target_dir:
        raise HTTPException(status_code=400, detail="No valid input directory found for engine")

    # Create directory if not exists
    os.makedirs(target_dir, exist_ok=True)

    # Generate filename
    # Prefix with uuid to avoid collisions
    filename = f"{uuid.uuid4().hex[:8]}_{file.filename}"
    file_path = os.path.join(target_dir, filename)

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    return {"filename": filename, "path": file_path}

@router.get("/tree")
def get_file_tree(
    engine_id: Optional[int] = None,
    path: str = "",  # Relative path to scan
    session: Session = Depends(get_session)
):
    """
    Get file tree for input/output directories.
    Returns list of items in the specified path.
    """
    if engine_id:
        engine = session.get(Engine, engine_id)
        # If engine not found, we could error or fallback. Let's error if ID provided.
        if not engine and engine_id:
             # Just fallback silently if weirdness
             pass
    else:
        engine = None

    if not engine:
         engine = session.exec(select(Engine).where(Engine.name == "Local ComfyUI")).first()

    if not engine:
         raise HTTPException(status_code=404, detail="No engine configuration found")

    base_dirs = []
    if engine.input_dir:
        base_dirs.append({"name": "Inputs", "path": engine.input_dir, "type": "directory"})
    if engine.output_dir:
        base_dirs.append({"name": "Outputs", "path": engine.output_dir, "type": "directory"})

    # If asking for root
    if not path:
        return [{"name": d["name"], "type": "directory", "path": d["path"], "is_root": True} for d in base_dirs]

    # Check if path is valid
    if not os.path.isdir(path):
        # It might be a file or non-existent
        return []

    items = []
    try:
        with os.scandir(path) as it:
            for entry in it:
                if entry.name.startswith('.'): continue
                
                item = {
                    "name": entry.name,
                    "path": entry.path,
                    "type": "directory" if entry.is_dir() else "file"
                }
                items.append(item)
    except Exception as e:
        print(f"Error scanning {path}: {e}")
        return []

    # Sort: Directories first, then files
    items.sort(key=lambda x: (x["type"] != "directory", x["name"].lower()))
    return items
