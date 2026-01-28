"""Canvas snapshot API endpoints."""
from datetime import datetime
import json
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import text

from fastapi import APIRouter, HTTPException
from sqlmodel import Session, select

from app.db.engine import ingestion_engine
from app.models.canvas import Canvas, CanvasCreate, CanvasRead, CanvasUpdate

router = APIRouter()
logger = logging.getLogger(__name__)


def _decode_canvas_payload(raw_payload: Any) -> tuple[Optional[Dict[str, Any]], bool]:
    if raw_payload in (None, ""):
        return {}, True
    if isinstance(raw_payload, dict):
        return raw_payload, True
    if isinstance(raw_payload, (bytes, bytearray)):
        raw_payload = raw_payload.decode("utf-8", errors="replace")
    if not isinstance(raw_payload, str):
        return None, False
    try:
        decoded = json.loads(raw_payload)
    except json.JSONDecodeError:
        return None, False
    if decoded is None:
        return {}, True
    if not isinstance(decoded, dict):
        return None, False
    return decoded, True


def _list_canvases_raw(
    project_id: Optional[int],
    workflow_template_id: Optional[int],
) -> tuple[List[Dict[str, Any]], List[int]]:
    sql = """
        SELECT
            id,
            name,
            payload,
            project_id,
            workflow_template_id,
            created_at,
            updated_at
        FROM canvas
        WHERE (:project_id IS NULL OR project_id = :project_id)
          AND (:workflow_template_id IS NULL OR workflow_template_id = :workflow_template_id)
        ORDER BY updated_at DESC
    """
    with ingestion_engine.connect() as conn:
        rows = conn.execute(
            text(sql),
            {
                "project_id": project_id,
                "workflow_template_id": workflow_template_id,
            },
        ).mappings().all()

    canvases: List[Dict[str, Any]] = []
    bad_ids: List[int] = []
    for row in rows:
        payload, ok = _decode_canvas_payload(row["payload"])
        if not ok:
            bad_ids.append(row["id"])
            continue
        canvases.append(
            {
                "id": row["id"],
                "name": row["name"],
                "payload": payload,
                "project_id": row["project_id"],
                "workflow_template_id": row["workflow_template_id"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
        )

    if bad_ids:
        if len(bad_ids) == len(rows):
            logger.error(
                "All %d canvases have invalid JSON payloads; returning empty list.",
                len(bad_ids),
            )
        else:
            logger.warning(
                "Skipped %d canvases with invalid JSON payloads: %s",
                len(bad_ids),
                ", ".join(str(canvas_id) for canvas_id in bad_ids),
            )
    return canvases, bad_ids


def _fetch_canvas_row(canvas_id: int) -> Optional[Dict[str, Any]]:
    sql = """
        SELECT
            id,
            name,
            payload,
            project_id,
            workflow_template_id,
            created_at,
            updated_at
        FROM canvas
        WHERE id = :canvas_id
    """
    with ingestion_engine.connect() as conn:
        row = conn.execute(text(sql), {"canvas_id": canvas_id}).mappings().first()
    return dict(row) if row else None


@router.get("", response_model=List[CanvasRead])
def list_canvases(
    project_id: Optional[int] = None,
    workflow_template_id: Optional[int] = None,
):
    """List canvases, optionally filtered by project/workflow."""
    try:
        with Session(ingestion_engine) as session:
            query = select(Canvas)
            if project_id is not None:
                query = query.where(Canvas.project_id == project_id)
            if workflow_template_id is not None:
                query = query.where(Canvas.workflow_template_id == workflow_template_id)
            canvases = session.exec(query.order_by(Canvas.updated_at.desc())).all()
            return canvases
    except json.JSONDecodeError:
        canvases, _ = _list_canvases_raw(project_id, workflow_template_id)
        return canvases


@router.get("/{canvas_id}", response_model=CanvasRead)
def get_canvas(canvas_id: int):
    """Fetch a single canvas by ID."""
    try:
        with Session(ingestion_engine) as session:
            canvas = session.get(Canvas, canvas_id)
            if not canvas:
                raise HTTPException(status_code=404, detail="Canvas not found")
            return canvas
    except json.JSONDecodeError:
        row = _fetch_canvas_row(canvas_id)
        if not row:
            raise HTTPException(status_code=404, detail="Canvas not found")
        payload, ok = _decode_canvas_payload(row.get("payload"))
        if not ok:
            raise HTTPException(
                status_code=422,
                detail="Canvas payload is not valid JSON.",
            )
        row["payload"] = payload
        return row


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
    try:
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
    except json.JSONDecodeError:
        row = _fetch_canvas_row(canvas_id)
        if not row:
            raise HTTPException(status_code=404, detail="Canvas not found")
        if data.payload is None:
            raise HTTPException(
                status_code=422,
                detail="Canvas payload is not valid JSON; include a new payload to repair it.",
            )

        if data.name is not None:
            updated_name = data.name.strip() or row["name"]
        else:
            updated_name = row["name"]
        payload_json = json.dumps(data.payload)
        updated_project_id = data.project_id if data.project_id is not None else row["project_id"]
        updated_workflow_template_id = (
            data.workflow_template_id
            if data.workflow_template_id is not None
            else row["workflow_template_id"]
        )
        updated_at = datetime.utcnow()

        sql = """
            UPDATE canvas
            SET name = :name,
                payload = :payload,
                project_id = :project_id,
                workflow_template_id = :workflow_template_id,
                updated_at = :updated_at
            WHERE id = :canvas_id
        """
        with ingestion_engine.begin() as conn:
            conn.execute(
                text(sql),
                {
                    "name": updated_name,
                    "payload": payload_json,
                    "project_id": updated_project_id,
                    "workflow_template_id": updated_workflow_template_id,
                    "updated_at": updated_at,
                    "canvas_id": canvas_id,
                },
            )

        refreshed = _fetch_canvas_row(canvas_id)
        if not refreshed:
            raise HTTPException(status_code=404, detail="Canvas not found")
        payload, ok = _decode_canvas_payload(refreshed.get("payload"))
        if not ok:
            raise HTTPException(
                status_code=422,
                detail="Canvas payload is not valid JSON after update.",
            )
        refreshed["payload"] = payload
        return refreshed


@router.delete("/{canvas_id}")
def delete_canvas(canvas_id: int):
    """Delete a canvas."""
    try:
        with Session(ingestion_engine) as session:
            canvas = session.get(Canvas, canvas_id)
            if not canvas:
                raise HTTPException(status_code=404, detail="Canvas not found")
            session.delete(canvas)
            session.commit()
            return {"ok": True}
    except json.JSONDecodeError:
        with ingestion_engine.begin() as conn:
            result = conn.execute(
                text("DELETE FROM canvas WHERE id = :canvas_id"),
                {"canvas_id": canvas_id},
            )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Canvas not found")
        return {"ok": True}
