"""Canvas snapshot API endpoints."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, select

from app.db.engine import ingestion_engine
from app.models.canvas import Canvas, CanvasCreate, CanvasRead, CanvasUpdate

router = APIRouter()


@router.get("", response_model=List[CanvasRead])
def list_canvases(
    project_id: Optional[int] = None,
    workflow_template_id: Optional[int] = None,
):
    """List canvases, optionally filtered by project/workflow."""
    with Session(ingestion_engine) as session:
        query = select(Canvas)
        if project_id is not None:
            query = query.where(Canvas.project_id == project_id)
        if workflow_template_id is not None:
            query = query.where(Canvas.workflow_template_id == workflow_template_id)
        canvases = session.exec(query.order_by(Canvas.updated_at.desc())).all()
        return canvases


@router.get("/{canvas_id}", response_model=CanvasRead)
def get_canvas(canvas_id: int):
    """Fetch a single canvas by ID."""
    with Session(ingestion_engine) as session:
        canvas = session.get(Canvas, canvas_id)
        if not canvas:
            raise HTTPException(status_code=404, detail="Canvas not found")
        return canvas


@router.post("", response_model=CanvasRead)
def create_canvas(data: CanvasCreate):
    """Create a new canvas snapshot."""
    with Session(ingestion_engine) as session:
        canvas = Canvas(
            name=data.name.strip() or "untitled canvas",
            payload=data.payload or {},
            project_id=data.project_id,
            workflow_template_id=data.workflow_template_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        session.add(canvas)
        session.commit()
        session.refresh(canvas)
        return canvas


@router.patch("/{canvas_id}", response_model=CanvasRead)
def update_canvas(canvas_id: int, data: CanvasUpdate):
    """Update an existing canvas."""
    with Session(ingestion_engine) as session:
        canvas = session.get(Canvas, canvas_id)
        if not canvas:
            raise HTTPException(status_code=404, detail="Canvas not found")

        if data.name is not None:
            canvas.name = data.name.strip() or canvas.name
        if data.payload is not None:
            canvas.payload = data.payload
        if data.project_id is not None:
            canvas.project_id = data.project_id
        if data.workflow_template_id is not None:
            canvas.workflow_template_id = data.workflow_template_id

        canvas.updated_at = datetime.utcnow()
        session.add(canvas)
        session.commit()
        session.refresh(canvas)
        return canvas


@router.delete("/{canvas_id}")
def delete_canvas(canvas_id: int):
    """Delete a canvas."""
    with Session(ingestion_engine) as session:
        canvas = session.get(Canvas, canvas_id)
        if not canvas:
            raise HTTPException(status_code=404, detail="Canvas not found")
        session.delete(canvas)
        session.commit()
        return {"ok": True}
