import json
import os
from pathlib import Path

from PIL import Image as PILImage
from PIL import PngImagePlugin
from sqlmodel import Session, select

from app.models.engine import Engine
from app.models.image import Image
from app.models.job import Job


def _write_noise_png(path: Path, comment_json: str) -> None:
    # Random-ish content so the file is >10KB (resync skips tiny thumbnails).
    data = os.urandom(512 * 512 * 3)
    img = PILImage.frombytes("RGB", (512, 512), data)
    info = PngImagePlugin.PngInfo()
    info.add_text("Comment", comment_json)
    info.add_text("Description", comment_json)
    img.save(path, pnginfo=info)


def test_resync_imports_file_and_captures_generation_info(client, session, tmp_path):
    comfy_root = tmp_path / "comfy"
    output_dir = comfy_root / "output"
    sweet_tea_dir = comfy_root / "sweet_tea"
    (sweet_tea_dir / "proj1" / "output").mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    engine = Engine(
        name="Local ComfyUI",
        base_url="http://localhost:8188",
        output_dir=str(output_dir),
        input_dir=str(comfy_root / "input"),
        is_active=True,
    )
    session.add(engine)
    session.commit()
    session.refresh(engine)

    job = Job(engine_id=engine.id, workflow_template_id=1, status="completed", input_params={"prompt": "x"})
    session.add(job)
    session.commit()
    session.refresh(job)

    payload = {
        "positive_prompt": "a cat",
        "negative_prompt": "bad",
        "job_id": job.id,
        "workflow_id": 1,
        "workflow_name": "Test",
        "timestamp": "2026-01-01T00:00:00Z",
        "params": {"seed": 123, "steps": 20},
    }
    img_path = sweet_tea_dir / "proj1" / "output" / "gen.png"
    _write_noise_png(img_path, json.dumps(payload))

    res = client.post("/api/v1/gallery/resync")
    assert res.status_code == 200
    data = res.json()
    assert data["imported"] == 1
    assert data["found"] == 1

    with Session(session.get_bind()) as verify:
        row = verify.exec(select(Image).where(Image.path == str(img_path))).first()
        assert row is not None
        assert row.job_id == job.id
        assert isinstance(row.extra_metadata, dict)
        assert row.extra_metadata["active_prompt"]["positive_text"] == "a cat"
        assert row.extra_metadata["active_prompt"]["negative_text"] == "bad"
        assert row.extra_metadata["generation_params"]["seed"] == 123
        assert row.extra_metadata["generation_params"]["steps"] == 20


def test_resync_backfills_metadata_for_existing_rows(client, session, tmp_path):
    comfy_root = tmp_path / "comfy2"
    output_dir = comfy_root / "output"
    sweet_tea_dir = comfy_root / "sweet_tea"
    (sweet_tea_dir / "proj2" / "output").mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    engine = Engine(
        name="Local ComfyUI",
        base_url="http://localhost:8188",
        output_dir=str(output_dir),
        input_dir=str(comfy_root / "input"),
        is_active=True,
    )
    session.add(engine)
    session.commit()
    session.refresh(engine)

    payload = {"positive_prompt": "a dog", "negative_prompt": "no", "params": {"seed": 1}}
    img_path = sweet_tea_dir / "proj2" / "output" / "existing.png"
    _write_noise_png(img_path, json.dumps(payload))

    # Simulate a previously-imported orphan without metadata.
    orphan = Image(job_id=-1, path=str(img_path), filename=img_path.name, format="png", is_kept=True)
    session.add(orphan)
    session.commit()
    session.refresh(orphan)

    res = client.post("/api/v1/gallery/resync")
    assert res.status_code == 200
    data = res.json()
    assert data["imported"] == 0
    assert data["already_in_db"] == 1
    assert data["updated"] >= 1

    with Session(session.get_bind()) as verify:
        row = verify.get(Image, orphan.id)
        assert row is not None
        assert isinstance(row.extra_metadata, dict)
        assert row.extra_metadata["active_prompt"]["positive_text"] == "a dog"
        assert row.extra_metadata["generation_params"]["seed"] == 1


def test_resync_persists_prompt_backfill_for_existing_metadata_dict(client, session, tmp_path):
    comfy_root = tmp_path / "comfy4"
    output_dir = comfy_root / "output"
    sweet_tea_dir = comfy_root / "sweet_tea"
    (sweet_tea_dir / "proj4" / "output").mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    engine = Engine(
        name="Local ComfyUI",
        base_url="http://localhost:8188",
        output_dir=str(output_dir),
        input_dir=str(comfy_root / "input"),
        is_active=True,
    )
    session.add(engine)
    session.commit()
    session.refresh(engine)

    payload = {"positive_prompt": "a tiger", "negative_prompt": "no", "params": {"seed": 2}}
    img_path = sweet_tea_dir / "proj4" / "output" / "existing-meta.png"
    _write_noise_png(img_path, json.dumps(payload))

    existing_meta = {
        "active_prompt": {
            "stage": 0,
            "positive_text": None,
            "negative_text": None,
            "timestamp": "2026-01-01T00:00:00Z",
            "source": "workflow",
        },
        "prompt_history": [
            {
                "stage": 0,
                "positive_text": None,
                "negative_text": None,
                "timestamp": "2026-01-01T00:00:00Z",
                "source": "workflow",
            }
        ],
        "generation_params": {"CLIPTextEncode.text": "old", "CLIPTextEncode_2.text": "old"},
    }

    row = Image(
        job_id=-1,
        path=str(img_path),
        filename=img_path.name,
        format="png",
        is_kept=True,
        extra_metadata=existing_meta,
    )
    session.add(row)
    session.commit()
    session.refresh(row)

    res = client.post("/api/v1/gallery/resync")
    assert res.status_code == 200

    with Session(session.get_bind()) as verify:
        refreshed = verify.get(Image, row.id)
        assert refreshed is not None
        assert isinstance(refreshed.extra_metadata, dict)
        assert refreshed.extra_metadata["active_prompt"]["positive_text"] == "a tiger"
        assert refreshed.extra_metadata["active_prompt"]["negative_text"] == "no"


def test_resync_skips_masks_folder(client, session, tmp_path):
    comfy_root = tmp_path / "comfy3"
    output_dir = comfy_root / "output"
    sweet_tea_dir = comfy_root / "sweet_tea"
    (sweet_tea_dir / "proj3" / "masks").mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    engine = Engine(
        name="Local ComfyUI",
        base_url="http://localhost:8188",
        output_dir=str(output_dir),
        input_dir=str(comfy_root / "input"),
        is_active=True,
    )
    session.add(engine)
    session.commit()

    payload = {"positive_prompt": "mask", "negative_prompt": "", "params": {"seed": 1}}
    img_path = sweet_tea_dir / "proj3" / "masks" / "mask.png"
    _write_noise_png(img_path, json.dumps(payload))

    res = client.post("/api/v1/gallery/resync")
    assert res.status_code == 200
    data = res.json()
    assert data["found"] == 0
    assert data["imported"] == 0
