import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel

from app.api.endpoints import projects as projects_endpoints
from app.core.config import settings


@pytest.fixture()
def projects_client(engine, tmp_path, monkeypatch):
    SQLModel.metadata.create_all(engine)

    app = FastAPI()
    app.include_router(projects_endpoints.router, prefix="/api/v1/projects", tags=["projects"])

    def override_get_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[projects_endpoints.get_session] = override_get_session

    monkeypatch.setattr(settings, "ROOT_DIR", tmp_path)
    settings.ensure_dirs()

    client = TestClient(app)
    yield client

    with Session(engine) as session:
        for table in reversed(SQLModel.metadata.sorted_tables):
            session.execute(table.delete())
        session.commit()


def test_add_project_folder_success(projects_client):
    response = projects_client.post("/api/v1/projects", json={"name": "Test Project"})
    assert response.status_code == 200
    project = response.json()

    response = projects_client.post(
        f"/api/v1/projects/{project['id']}/folders",
        json={"folder_name": "My Folder"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert "config_json" in payload
    assert "my-folder" in (payload["config_json"].get("folders") or [])
    assert "image_count" in payload
    assert "last_activity" in payload
