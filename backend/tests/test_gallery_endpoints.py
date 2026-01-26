import os
import tempfile

from sqlmodel import Session

from app.models.image import Image
from app.models.job import Job
from app.models.prompt import Prompt
from app.services.gallery.search import build_search_text_from_image, update_gallery_fts


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


def test_cleanup_with_keep_image_ids_deletes_kept_images(client, session):
    prompt = Prompt(workflow_id=1, name="Cleanup KeepIds", positive_text="keep ids")
    session.add(prompt)
    session.commit()
    session.refresh(prompt)

    job = create_job(session, prompt, {"prompt": "Cleanup keep ids"})

    fd1, path1 = tempfile.mkstemp()
    fd2, path2 = tempfile.mkstemp()
    os.close(fd1)
    os.close(fd2)

    try:
        kept_image = Image(job_id=job.id, path=path1, filename="kept.png", is_kept=True)
        other_image = Image(job_id=job.id, path=path2, filename="other.png", is_kept=False)
        session.add_all([kept_image, other_image])
        session.commit()
        session.refresh(kept_image)
        session.refresh(other_image)

        # Keep one image (by explicit ID list) and delete the other, regardless of is_kept flags.
        resp = client.post(
            "/api/v1/gallery/cleanup",
            json={"job_id": job.id, "keep_image_ids": [kept_image.id]},
        )
        assert resp.status_code == 200

        with Session(session.get_bind()) as verify_session:
            verify_kept = verify_session.get(Image, kept_image.id)
            verify_other = verify_session.get(Image, other_image.id)
            assert verify_kept is not None
            assert verify_kept.is_deleted is False
            assert verify_other is not None
            assert verify_other.is_deleted is True

        assert os.path.exists(path1)
        assert not os.path.exists(path2)

        # Now delete everything in-scope (keep list provided but empty), including the previously kept image.
        resp2 = client.post(
            "/api/v1/gallery/cleanup",
            json={"job_id": job.id, "keep_image_ids": []},
        )
        assert resp2.status_code == 200

        with Session(session.get_bind()) as verify_session:
            verify_kept = verify_session.get(Image, kept_image.id)
            assert verify_kept is not None
            assert verify_kept.is_deleted is True

        assert not os.path.exists(path1)
    finally:
        if os.path.exists(path1):
            os.remove(path1)
        if os.path.exists(path2):
            os.remove(path2)


def test_matches_naming_convention():
    """
    Test the _matches_naming_convention helper function.
    Files following the pattern {project}-{subfolder}-{number} should return True.
    Non-standard names should return False.
    """
    from app.api.endpoints.gallery import _matches_naming_convention
    
    # Files that SHOULD match the naming convention
    assert _matches_naming_convention("myproject-output-0001.png") is True
    assert _matches_naming_convention("photos-transform-0051.jpg") is True
    assert _matches_naming_convention("test-upload-1.webp") is True
    assert _matches_naming_convention("project123-subfolder-999.jpeg") is True
    
    # Files that should NOT match (keep original name when moved)
    assert _matches_naming_convention("myimage.jpg") is False
    assert _matches_naming_convention("photo.png") is False
    assert _matches_naming_convention("sunset_beach.webp") is False
    assert _matches_naming_convention("IMG_20240101.jpg") is False
    assert _matches_naming_convention("screenshot-2024.png") is False
    assert _matches_naming_convention("just-one-dash.png") is False
