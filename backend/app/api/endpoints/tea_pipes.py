"""Endpoints for `.tea` package import/export and dependency readiness."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.db.engine import engine as db_engine
from app.models.workflow import WorkflowTemplate, WorkflowTemplateRead
from app.services import app_settings
from app.services.tea_package import (
    TeaInterfaceV1,
    TeaManifestV1,
    build_input_schema_from_interface,
    build_interface_from_workflow_schema,
    build_runtime_mapping_from_interface,
    canonical_json_bytes,
    compute_dependency_readiness,
    create_tea_archive,
    detect_custom_node_lock,
    ensure_manifest_defaults,
    get_local_pipe_dir,
    parse_tea_archive,
    read_local_pipe_files,
    read_local_pipe_manifest,
    store_local_pipe_payload,
)

router = APIRouter(prefix="/tea-pipes", tags=["tea-pipes"])


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _extract_pipe_id(workflow: WorkflowTemplate) -> Optional[str]:
    schema = workflow.input_schema or {}
    pipe_id = schema.get("__tea_pipe_id")
    if isinstance(pipe_id, str) and pipe_id.strip():
        return pipe_id.strip()
    return None


def _extract_unverified(workflow: WorkflowTemplate) -> bool:
    schema = workflow.input_schema or {}
    return bool(schema.get("__tea_unverified"))


def _extract_integrity_mismatches(workflow: WorkflowTemplate) -> List[str]:
    schema = workflow.input_schema or {}
    value = schema.get("__tea_integrity_mismatches")
    if isinstance(value, list):
        return [str(item) for item in value]
    return []


def _safe_description(text: Optional[str], fallback: Optional[str]) -> str:
    raw = (text if text is not None else fallback) or ""
    return raw.strip()[:500]


def _safe_name(name: Optional[str], fallback: Optional[str]) -> str:
    value = (name if name is not None else fallback) or ""
    return value.strip() or "imported tea pipe"


class TeaReadinessResponse(BaseModel):
    ready: bool
    models: List[Dict[str, Any]] = Field(default_factory=list)
    custom_nodes: List[Dict[str, Any]] = Field(default_factory=list)
    missing_models: List[Dict[str, Any]] = Field(default_factory=list)
    missing_custom_nodes: List[Dict[str, Any]] = Field(default_factory=list)


class TeaWorkflowStatus(BaseModel):
    workflow_id: int
    is_tea: bool
    pipe_id: Optional[str] = None
    unverified: bool = False
    integrity_mismatches: List[str] = Field(default_factory=list)
    manifest: Optional[Dict[str, Any]] = None
    readiness: Optional[TeaReadinessResponse] = None
    storage_path: Optional[str] = None


class TeaImportResponse(BaseModel):
    workflow: WorkflowTemplateRead
    status: TeaWorkflowStatus
    warnings: List[str] = Field(default_factory=list)


def _build_status_for_workflow(workflow: WorkflowTemplate, *, session: Session) -> TeaWorkflowStatus:
    pipe_id = _extract_pipe_id(workflow)
    if not pipe_id:
        return TeaWorkflowStatus(workflow_id=workflow.id or -1, is_tea=False)

    manifest = read_local_pipe_manifest(pipe_id)
    if manifest is None:
        return TeaWorkflowStatus(
            workflow_id=workflow.id or -1,
            is_tea=False,
            pipe_id=pipe_id,
        )

    readiness = compute_dependency_readiness(manifest, session=session) if manifest else None
    return TeaWorkflowStatus(
        workflow_id=workflow.id or -1,
        is_tea=True,
        pipe_id=pipe_id,
        unverified=_extract_unverified(workflow),
        integrity_mismatches=_extract_integrity_mismatches(workflow),
        manifest=manifest.model_dump() if manifest else None,
        readiness=TeaReadinessResponse(**readiness) if readiness else None,
        storage_path=str(get_local_pipe_dir(pipe_id, session=session)),
    )


@router.post("/import", response_model=TeaImportResponse)
async def import_tea_pipe(
    file: UploadFile = File(...),
    name: Optional[str] = Form(default=None),
    description: Optional[str] = Form(default=None),
    store_original: Optional[bool] = Form(default=None),
):
    filename = file.filename or ""
    if not filename.lower().endswith(".tea"):
        raise HTTPException(status_code=400, detail="Expected a .tea package")

    raw = await file.read()
    try:
        parsed = parse_tea_archive(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    workflow_name = _safe_name(name, parsed.manifest.pipe.name)
    workflow_description = _safe_description(description, parsed.manifest.pipe.description)

    input_schema = build_input_schema_from_interface(parsed.interface)
    input_schema["__tea_pipe_id"] = parsed.manifest.pipe.id
    input_schema["__tea_unverified"] = bool(parsed.integrity_mismatches)
    input_schema["__tea_integrity_mismatches"] = list(parsed.integrity_mismatches)
    input_schema["__tea_imported_at"] = _utc_now_iso()

    mapping = build_runtime_mapping_from_interface(parsed.interface)

    with Session(db_engine) as session:
        workflow = WorkflowTemplate(
            name=workflow_name,
            description=workflow_description,
            graph_json=parsed.workflow,
            input_schema=input_schema,
            node_mapping=mapping,
        )
        session.add(workflow)
        session.commit()
        session.refresh(workflow)

        store_blob_setting = app_settings.get_setting_typed("pipes_store_original_blob", True)
        should_store_blob = bool(store_blob_setting) if store_original is None else bool(store_original)

        try:
            store_local_pipe_payload(
                pipe_id=parsed.manifest.pipe.id,
                manifest=parsed.manifest,
                workflow=parsed.workflow,
                interface=parsed.interface,
                preview_png=parsed.preview_png,
                optional_files=parsed.optional_files,
                original_archive=raw if should_store_blob else None,
                workflow_id=workflow.id,
                unverified=bool(parsed.integrity_mismatches),
                integrity_mismatches=parsed.integrity_mismatches,
            )
        except Exception as exc:
            # Keep DB record consistent by removing the workflow if persistence fails.
            session.delete(workflow)
            session.commit()
            raise HTTPException(status_code=500, detail=f"Failed to persist imported pipe: {exc}") from exc

        status = _build_status_for_workflow(workflow, session=session)
        warnings: List[str] = []
        if parsed.integrity_mismatches:
            warnings.append(f"Integrity mismatch for: {', '.join(parsed.integrity_mismatches)}")
        return TeaImportResponse(
            workflow=workflow,  # type: ignore[arg-type]
            status=status,
            warnings=warnings,
        )


@router.get("/status", response_model=List[TeaWorkflowStatus])
def list_tea_workflow_statuses(include_archived: bool = Query(default=True)):
    with Session(db_engine) as session:
        query = select(WorkflowTemplate).order_by(WorkflowTemplate.display_order, WorkflowTemplate.id)
        if not include_archived:
            query = query.where(WorkflowTemplate.archived_at == None)  # noqa: E711
        workflows = session.exec(query).all()
        return [_build_status_for_workflow(workflow, session=session) for workflow in workflows]


@router.get("/{workflow_id}", response_model=TeaWorkflowStatus)
def get_tea_workflow_status(workflow_id: int):
    with Session(db_engine) as session:
        workflow = session.get(WorkflowTemplate, workflow_id)
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return _build_status_for_workflow(workflow, session=session)


def _load_local_manifest_workflow_interface(
    pipe_id: str,
) -> tuple[Optional[TeaManifestV1], Optional[Dict[str, Any]], Optional[TeaInterfaceV1], Dict[str, bytes]]:
    files = read_local_pipe_files(pipe_id)
    manifest = None
    workflow = None
    interface = None

    try:
        if "manifest.json" in files:
            manifest = TeaManifestV1.model_validate(json.loads(files["manifest.json"].decode("utf-8")))
    except Exception:
        manifest = None
    try:
        if "workflow.json" in files:
            data = json.loads(files["workflow.json"].decode("utf-8"))
            if isinstance(data, dict):
                workflow = data
    except Exception:
        workflow = None
    try:
        if "interface.json" in files:
            interface = TeaInterfaceV1.model_validate(json.loads(files["interface.json"].decode("utf-8")))
    except Exception:
        interface = None
    return manifest, workflow, interface, files


@router.get("/{workflow_id}/export")
def export_tea_pipe(
    workflow_id: int,
    mode: str = Query(default="shareable"),
    new_id: bool = Query(default=False),
):
    export_mode = mode.lower().strip()
    if export_mode not in ("shareable", "exact_clone"):
        raise HTTPException(status_code=400, detail="mode must be 'shareable' or 'exact_clone'")

    with Session(db_engine) as session:
        workflow = session.get(WorkflowTemplate, workflow_id)
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")

        pipe_id = _extract_pipe_id(workflow)
        local_manifest: Optional[TeaManifestV1] = None
        export_workflow: Optional[Dict[str, Any]] = None
        export_interface: Optional[TeaInterfaceV1] = None
        local_files: Dict[str, bytes] = {}

        if pipe_id:
            local_manifest, export_workflow, export_interface, local_files = _load_local_manifest_workflow_interface(pipe_id)

        stable_pipe_id = pipe_id
        if not stable_pipe_id and not new_id:
            stable_pipe_id = f"sts.pipe.{uuid4()}"
            schema = dict(workflow.input_schema or {})
            schema["__tea_pipe_id"] = stable_pipe_id
            workflow.input_schema = schema
            session.add(workflow)
            session.commit()
            session.refresh(workflow)

        if export_workflow is None:
            export_workflow = workflow.graph_json or {}
        if not isinstance(export_workflow, dict):
            raise HTTPException(status_code=400, detail="Workflow graph is invalid")

        if export_interface is None:
            export_interface = build_interface_from_workflow_schema(
                workflow.input_schema or {},
                node_mapping=workflow.node_mapping if isinstance(workflow.node_mapping, dict) else {},
            )

        manifest = ensure_manifest_defaults(
            manifest=local_manifest,
            workflow_name=workflow.name,
            workflow_description=workflow.description,
            workflow=export_workflow,
            seed_pipe_id=stable_pipe_id,
            mode=export_mode,  # type: ignore[arg-type]
            new_id=new_id,
        )

        optional_files = {
            rel: payload
            for rel, payload in local_files.items()
            if rel not in ("manifest.json", "workflow.json", "interface.json", "preview.png")
        }
        preview_png = local_files.get("preview.png", b"")

        if export_mode == "exact_clone":
            lock_payload = detect_custom_node_lock(manifest, session=session)
            optional_files["lock.json"] = canonical_json_bytes(lock_payload)

        result = create_tea_archive(
            manifest=manifest,
            workflow=export_workflow,
            interface=export_interface,
            preview_png=preview_png,
            optional_files=optional_files,
            mode=export_mode,  # type: ignore[arg-type]
        )

        headers = {"Content-Disposition": f"attachment; filename={result.filename}"}
        if result.warnings:
            headers["X-Sweet-Tea-Warnings"] = "; ".join(result.warnings)[:1024]
        return Response(content=result.archive_bytes, media_type="application/zip", headers=headers)
