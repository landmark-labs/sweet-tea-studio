from pathlib import Path

from PIL import Image
from sqlmodel import Session, SQLModel, create_engine, select

from app.models import project as project_models  # Registers project table metadata
from app.models.portfolio import Output
from app.services.portfolio_storage import ModelUsage, OutputArtifact, PortfolioStorage


def test_record_run_uses_relative_paths_and_embeds_provenance(tmp_path: Path):
    # Arrange
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)

    root_dir = tmp_path
    image_path = root_dir / "outputs" / "sample.jpg"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (32, 32), color=(255, 0, 0)).save(image_path)

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
    comment = info.get("comment") or b""
    assert b"pipe-one" in comment or "sweet_tea_provenance" in "".join(info.keys())
