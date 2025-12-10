import json
from pathlib import Path

import pytest
from PIL import Image
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.config import settings
from app.models import project as project_models  # Registers project table metadata
from app.models.portfolio import Output
from app.services.portfolio_storage import ModelUsage, OutputArtifact, PortfolioStorage


@pytest.mark.parametrize("extension,image_format", [("jpg", "JPEG"), ("png", "PNG")])
def test_record_run_uses_relative_paths_and_embeds_provenance(tmp_path: Path, extension: str, image_format: str):
    # Arrange
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)

    root_dir = tmp_path
    image_path = root_dir / "outputs" / f"sample.{extension}"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (32, 32), color=(255, 0, 0)).save(image_path, format=image_format)

    storage = PortfolioStorage(root_dir=root_dir)

    model_usage = [
        ModelUsage(
            role="checkpoint",
            kind="checkpoint",
            name="modelA",
            path=root_dir / "models" / "modelA.safetensors",
            checksum="abc123",
            metadata={"source": "local"},
        )
    ]

    artifacts = [
        OutputArtifact(
            path=image_path,
            kind="image",
            index=0,
            metadata={"size": image_path.stat().st_size},
            perceptual_hash="hash123",
        )
    ]

    # Act
    with Session(engine) as session:
        storage.record_run(
            session,
            run_uuid="run-123",
            comfy_hash="hash-1",
            comfy_json="{}",
            pipe_slug="pipe-one",
            pipe_name="Pipe One",
            params_diff={"cfg": 7.5},
            default_params={"cfg": 6.5},
            prompts={"positive": "a cat", "negative": ""},
            outputs=artifacts,
            models=model_usage,
            sampler="euler",
            seed="42",
            steps=20,
            cfg=7.5,
            duration_ms=1234,
            final_iterations_per_second=2.5,
            engine_name="local",
            engine_version="1.0.0",
        )

    # Assert
    with Session(engine) as session:
        output_row = session.exec(select(Output)).one()
        assert output_row.path == str(image_path.relative_to(root_dir))
        assert output_row.thumb_jpeg is not None
        assert output_row.perceptual_hash == "hash123"

    info = Image.open(image_path).info
    comment = (
        info.get("comment")
        or info.get("Comment")
        or info.get("Description")
        or info.get("sweet_tea_provenance")
        or b""
    )
    assert comment

    provenance_text = comment.decode("utf-8") if isinstance(comment, bytes) else comment
    payload = json.loads(provenance_text)
    expected_payload = {
        "pipe_slug": "pipe-one",
        "comfy_hash": "hash-1",
        "positive_prompt": "a cat",
        "negative_prompt": "",
        "seed": "42",
        "steps": 20,
        "cfg": 7.5,
        "sampler": "euler",
        "engine_name": "local",
        "engine_version": "1.0.0",
        "app_version": settings.APP_VERSION,
        "duration_ms": 1234,
        "final_iterations_per_second": 2.5,
        "params": {"cfg": 7.5},
        "models": [
            {
                "role": "checkpoint",
                "kind": "checkpoint",
                "name": "modelA",
                "path": "models/modelA.safetensors",
                "checksum": "abc123",
            }
        ],
    }
    assert payload == expected_payload
