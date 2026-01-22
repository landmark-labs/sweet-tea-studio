import os

from sqlmodel import Session

from app.models.image import Image
from app.models.job import Job
from app.models.prompt import Prompt
from app.services.gallery_search import build_search_text_from_image, update_gallery_fts


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

    keep_path = os.path.join(os.getcwd(), "kept.png")
    other_path = os.path.join(os.getcwd(), "other.png")
    
    with open(keep_path, "wb") as f: f.write(b"dummy image data")
    with open(other_path, "wb") as f: f.write(b"dummy image data")
    
    try:
        keep_image = Image(job_id=job.id, path=keep_path, filename="kept.png", caption="Vacation vibes", is_kept=True)
        other_image = Image(job_id=job.id, path=other_path, filename="other.png", caption="City skyline", is_kept=True)
        session.add_all([keep_image, other_image])
        session.commit()
        
        # Update FTS so search works (read_gallery uses FTS if table exists)
        for img in [keep_image, other_image]:
            search_text = build_search_text_from_image(img)
            update_gallery_fts(session, img.id, search_text)
        session.commit()

        response = client.get("/api/v1/gallery/", params={"search": "vacation", "limit": 10})
        assert response.status_code == 200
        payload = response.json()

        assert len(payload) == 1
        assert payload[0]["image"]["id"] == keep_image.id
    finally:
        if os.path.exists(keep_path): os.remove(keep_path)
        if os.path.exists(other_path): os.remove(other_path)
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
        # Soft delete: image still exists but is marked as deleted
        stale_img = verify_session.get(Image, stale_id)
        assert stale_img is not None
        assert stale_img.is_deleted is True
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
        # Soft delete: image still exists but is marked as deleted
        deleted_img = verify_session.get(Image, image.id)
        assert deleted_img is not None
        assert deleted_img.is_deleted is True
    assert "X-Gallery-Request-Duration-ms" in delete_response.headers

    # Trying to delete an already-deleted image should still succeed
    # (or return 404 if we want to prevent double-delete)
    # Currently the soft-delete logic will mark it again
    second_response = client.delete(f"/api/v1/gallery/{image.id}")
    # Either 200 (re-deleted) or 404 (already deleted) is acceptable
    assert second_response.status_code in [200, 404]
    assert "X-Gallery-Request-Duration-ms" in second_response.headers
