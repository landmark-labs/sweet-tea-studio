import os

from sqlmodel import Session

from app.models.image import Image
from app.models.job import Job
from app.models.prompt import Prompt


def create_job(session: Session, prompt: Prompt, params: dict | None = None) -> Job:
    job = Job(
        engine_id=1,
        workflow_template_id=1,
        status="completed",
        input_params=params or {},
        prompt_id=prompt.id,
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def test_gallery_search_filters_results(client, session):
    prompt = Prompt(workflow_id=1, name="Test", positive_text="sunny beach", tags=["beach"])
    session.add(prompt)
    session.commit()
    session.refresh(prompt)

    job = create_job(session, prompt, {"prompt": "Sunny beach", "negative_prompt": "rain"})

    keep_image = Image(job_id=job.id, path="kept.png", filename="kept.png", caption="Vacation vibes", is_kept=True)
    other_image = Image(job_id=job.id, path="other.png", filename="other.png", caption="City skyline", is_kept=True)
    session.add_all([keep_image, other_image])
    session.commit()

    response = client.get("/api/v1/gallery/", params={"search": "vacation", "limit": 10})
    assert response.status_code == 200
    payload = response.json()

    assert len(payload) == 1
    assert payload[0]["image"]["id"] == keep_image.id
    assert "X-Gallery-Request-Duration-ms" in response.headers


def test_keep_and_cleanup_cycle(client, session, temp_file_path):
    prompt = Prompt(workflow_id=1, name="Cleanup", positive_text="keep test")
    session.add(prompt)
    session.commit()
    session.refresh(prompt)

    job = create_job(session, prompt, {"prompt": "Cleanup prompts"})

    kept_image = Image(job_id=job.id, path="keep.png", filename="keep.png", is_kept=False)
    stale_image = Image(job_id=job.id, path=temp_file_path, filename="stale.png", is_kept=False)
    session.add_all([kept_image, stale_image])
    session.commit()
    session.refresh(kept_image)
    session.refresh(stale_image)
    stale_id = stale_image.id

    keep_response = client.post(
        "/api/v1/gallery/keep",
        json={"image_ids": [kept_image.id], "keep": True},
    )
    assert keep_response.status_code == 200
    session.expire_all()
    with Session(session.get_bind()) as verify_session:
        assert verify_session.get(Image, kept_image.id).is_kept is True

    cleanup_response = client.post("/api/v1/gallery/cleanup", json={"job_id": job.id})
    assert cleanup_response.status_code == 200
    with Session(session.get_bind()) as verify_session:
        assert verify_session.get(Image, stale_id) is None
    assert not os.path.exists(temp_file_path)


def test_delete_image_and_standardized_errors(client, session):
    prompt = Prompt(workflow_id=1, name="Delete", positive_text="delete test")
    session.add(prompt)
    session.commit()
    session.refresh(prompt)

    job = create_job(session, prompt, {"prompt": "Delete prompt"})

    image = Image(job_id=job.id, path="delete.png", filename="delete.png", is_kept=False)
    session.add(image)
    session.commit()
    session.refresh(image)

    delete_response = client.delete(f"/api/v1/gallery/{image.id}")
    assert delete_response.status_code == 200
    with Session(session.get_bind()) as verify_session:
        assert verify_session.get(Image, image.id) is None
    assert "X-Gallery-Request-Duration-ms" in delete_response.headers

    missing_response = client.delete(f"/api/v1/gallery/{image.id}")
    assert missing_response.status_code == 404
    body = missing_response.json()
    assert body["error"] == "gallery_error"
    assert body["path"].endswith(f"/api/v1/gallery/{image.id}")
    assert "X-Gallery-Request-Duration-ms" in missing_response.headers
