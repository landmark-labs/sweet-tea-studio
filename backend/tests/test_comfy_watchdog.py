import time
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core.comfy_client import ComfyConnectionError
from app.main import app
from app.models.engine import Engine
from app.models.workflow import WorkflowTemplate
from app.services.comfy_watchdog import ComfyWatchdog, EngineWatchState, watchdog
from sqlmodel import Session, select
from app.db.engine import engine as db_engine
from app.db.init_db import init_db


def test_watchdog_marks_engine_unhealthy(monkeypatch):
    test_watchdog = ComfyWatchdog(poll_interval=1, max_backoff=4)
    engine = Engine(id=1, name="Test", base_url="http://localhost:8188", output_dir="/tmp/out", input_dir="/tmp/in")

    monkeypatch.setattr("app.core.comfy_client.ComfyClient.get_object_info", lambda self: (_ for _ in ()).throw(ComfyConnectionError("down")))

    state = test_watchdog._check_engine(engine)

    assert not state.healthy
    assert state.backoff >= 2
    assert state.next_check > state.last_checked
    assert "down" in (state.last_error or "").lower()


def test_watchdog_recovers_after_restart(monkeypatch):
    test_watchdog = ComfyWatchdog(poll_interval=1, max_backoff=4)
    engine = Engine(id=2, name="TestRecover", base_url="http://localhost:8188", output_dir="/tmp/out", input_dir="/tmp/in")

    test_watchdog.state[engine.id] = EngineWatchState(
        healthy=False,
        backoff=4,
        last_checked=time.monotonic(),
        last_checked_wall=time.time(),
        next_check=time.monotonic(),
        last_error="down",
        engine_name=engine.name,
    )

    monkeypatch.setattr("app.core.comfy_client.ComfyClient.get_object_info", lambda self: {})

    recovered = test_watchdog._check_engine(engine)

    assert recovered.healthy
    assert recovered.backoff == test_watchdog.poll_interval
    assert recovered.last_error is None


def test_job_submission_blocked_when_offline(monkeypatch):
    monkeypatch.setattr("app.core.comfy_client.ComfyClient.get_object_info", lambda self: (_ for _ in ()).throw(ComfyConnectionError("offline")))

    init_db()

    with Session(db_engine) as session:
        engine = session.exec(select(Engine)).first()
        if not engine:
            engine = Engine(name="Local", base_url="http://localhost:8188", output_dir="/tmp/out", input_dir="/tmp/in")
            session.add(engine)
            session.commit()
            session.refresh(engine)

        engine_id = engine.id
        engine_name = engine.name

        workflow = session.exec(select(WorkflowTemplate)).first()
        if not workflow:
            workflow = WorkflowTemplate(
                name="SmokeTest",
                description="",
                graph_json={},
                input_schema={},
            )
            session.add(workflow)
            session.commit()
            session.refresh(workflow)

    watchdog.state[engine_id] = EngineWatchState(
        healthy=False,
        backoff=5,
        last_checked=time.monotonic(),
        last_checked_wall=time.time(),
        next_check=time.monotonic() + 5,
        last_error="ComfyUI offline",
        engine_name=engine_name,
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/jobs/",
            json={
                "engine_id": engine.id,
                "workflow_template_id": workflow.id,
                "input_params": {},
            },
        )

        assert response.status_code == 503
        assert "offline" in response.json()["detail"].lower()
