import os
import tempfile
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.endpoints import library
from app.models.image import Image
from app.models.job import Job
from app.models.project import Project
from app.models.prompt import Prompt


@pytest.fixture()
def library_client(engine):
    original_engine = library.db_engine
    library.db_engine = engine
    app = FastAPI()
    app.include_router(library.router, prefix="/api/v1/library", tags=["library"])
    client = TestClient(app)
    try:
        yield client
    finally:
        library.db_engine = original_engine


def _create_temp_media(name: str) -> str:
    fd, path = tempfile.mkstemp(prefix=name, suffix=".png")
    os.close(fd)
    with open(path, "wb") as f:
        f.write(
            bytes.fromhex(
                "89504E470D0A1A0A0000000D4948445200000001000000010802000000907753DE0000000C4944415408D763F8FFFF3F0005FE02FEA557A9020000000049454E44AE426082"
            )
        )
    return path


def test_media_search_relevance_and_recency(library_client, session):
    project = Project(name="Search Project", slug="search-project")
    prompt = Prompt(workflow_id=1, name="Retriever Prompt", positive_text="golden retriever")
    session.add(project)
    session.add(prompt)
    session.commit()
    session.refresh(project)
    session.refresh(prompt)

    job_recent = Job(
        engine_id=1,
        workflow_template_id=1,
        status="completed",
        input_params={"prompt": "golden retriever on beach", "negative_prompt": "blurry"},
        prompt_id=prompt.id,
        project_id=project.id,
    )
    job_old = Job(
        engine_id=1,
        workflow_template_id=1,
        status="completed",
        input_params={"prompt": "golden retriever on beach", "negative_prompt": "blurry"},
        prompt_id=prompt.id,
        project_id=project.id,
    )
    session.add(job_recent)
    session.add(job_old)
    session.commit()
    session.refresh(job_recent)
    session.refresh(job_old)

    recent_path = _create_temp_media("recent")
    old_path = _create_temp_media("old")
    unrelated_path = _create_temp_media("unrelated")
    try:
        recent_image = Image(
            job_id=job_recent.id,
            path=recent_path,
            filename=os.path.basename(recent_path),
            caption="golden retriever running on beach",
            created_at=datetime.utcnow(),
            extra_metadata={
                "active_prompt": {
                    "positive_text": "golden retriever on beach",
                    "negative_text": "blurry",
                }
            },
        )
        old_image = Image(
            job_id=job_old.id,
            path=old_path,
            filename=os.path.basename(old_path),
            caption="golden retriever running on beach",
            created_at=datetime.utcnow() - timedelta(days=30),
            extra_metadata={
                "active_prompt": {
                    "positive_text": "golden retriever on beach",
                    "negative_text": "blurry",
                }
            },
        )
        unrelated_image = Image(
            job_id=job_recent.id,
            path=unrelated_path,
            filename=os.path.basename(unrelated_path),
            caption="city skyline at night",
            created_at=datetime.utcnow(),
            extra_metadata={
                "active_prompt": {
                    "positive_text": "city skyline",
                    "negative_text": "low quality",
                }
            },
        )
        session.add(recent_image)
        session.add(old_image)
        session.add(unrelated_image)
        session.commit()
        session.refresh(recent_image)
        session.refresh(old_image)

        response = library_client.get(
            "/api/v1/library/media-search",
            params={"q": "golden retriever beach", "offset": 0, "limit": 10},
        )
        assert response.status_code == 200
        payload = response.json()
        assert len(payload["items"]) >= 2
        ids = [item["image_id"] for item in payload["items"]]
        assert ids.index(recent_image.id) < ids.index(old_image.id)
    finally:
        for path in [recent_path, old_path, unrelated_path]:
            if os.path.exists(path):
                os.remove(path)
