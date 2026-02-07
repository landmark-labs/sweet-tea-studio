import io
import json
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

import app.services.tea_package as tea_package
from app.services.tea_package import (
    TeaInterfaceTarget,
    TeaInterfaceV1,
    TeaManifestV1,
    apply_interface_values_to_workflow,
    create_tea_archive,
    ensure_manifest_defaults,
    parse_tea_archive,
)


def _build_manifest(name: str = "Flux Portrait Factory") -> TeaManifestV1:
    return TeaManifestV1.model_validate(
        {
            "tea_version": "1.0",
            "schema_version": 1,
            "pipe": {
                "id": "sts.pipe.123e4567-e89b-42d3-a456-426614174000",
                "name": name,
                "version": "1.2.0",
                "description": "test",
                "authors": [{"name": "Sweet Tea"}],
                "tags": [],
                "created_at": "2026-02-07T00:00:00Z",
                "updated_at": "2026-02-07T00:00:00Z",
                "license": "MIT",
                "source": {"type": "local"},
            },
            "compat": {
                "sweet_tea_min_version": "0.6.0",
                "sweet_tea_max_version": None,
                "comfyui_min_version": None,
                "comfyui_max_version": None,
                "platforms": ["windows-x64", "linux-x64"],
            },
            "entrypoints": {
                "workflow": "workflow.json",
                "interface": "interface.json",
                "preview": "preview.png",
            },
            "dependencies": {
                "models": [],
                "custom_nodes": [],
                "pip": [],
                "system": [],
            },
            "ui": {
                "form_layout": "default",
                "advanced_sections": True,
                "defaults_profile": None,
            },
            "extensions": {},
        }
    )


def _build_interface() -> TeaInterfaceV1:
    return TeaInterfaceV1.model_validate(
        {
            "tea_version": "1.0",
            "schema_version": 1,
            "fields": [
                {
                    "id": "prompt",
                    "label": "Prompt",
                    "type": "string",
                    "required": True,
                    "targets": [{"path": "/2/inputs/text"}],
                },
                {
                    "id": "seed",
                    "label": "Seed",
                    "type": "int",
                    "required": True,
                    "targets": [
                        {"path": "/1/inputs/seed"},
                        {"path": "/3/inputs/reseed"},
                    ],
                },
            ],
            "sections": [],
            "layout": {},
            "extensions": {},
        }
    )


def _build_workflow() -> dict:
    return {
        "1": {"class_type": "SeedNode", "inputs": {"seed": 1}},
        "2": {"class_type": "PromptNode", "inputs": {"text": "old"}},
        "3": {"class_type": "ReseedNode", "inputs": {"reseed": 0}},
    }


def test_manifest_validation_rejects_invalid_pipe_id():
    payload = _build_manifest().model_dump()
    payload["pipe"]["id"] = "invalid-id"
    with pytest.raises(Exception):
        TeaManifestV1.model_validate(payload)


def test_integrity_hash_verification_detects_tampering():
    manifest = ensure_manifest_defaults(
        manifest=_build_manifest(),
        workflow_name="Integrity Test",
        workflow_description="desc",
        workflow=_build_workflow(),
        mode="shareable",
        new_id=False,
    )
    interface = _build_interface()
    workflow = _build_workflow()
    export = create_tea_archive(
        manifest=manifest,
        workflow=workflow,
        interface=interface,
        preview_png=b"",
        optional_files={},
        mode="shareable",
    )

    parsed = parse_tea_archive(export.archive_bytes)
    assert parsed.integrity_mismatches == []

    # Tamper workflow.json while keeping manifest hash unchanged.
    tampered = io.BytesIO()
    with ZipFile(io.BytesIO(export.archive_bytes), "r") as original, ZipFile(tampered, "w", compression=ZIP_DEFLATED) as out:
        for info in original.infolist():
            data = original.read(info.filename)
            if info.filename == "workflow.json":
                workflow_obj = json.loads(data.decode("utf-8"))
                workflow_obj["1"]["inputs"]["seed"] = 999
                data = json.dumps(workflow_obj).encode("utf-8")
            out.writestr(info.filename, data)

    tampered_parsed = parse_tea_archive(tampered.getvalue())
    assert "workflow.json" in tampered_parsed.integrity_mismatches


def test_interface_mutation_is_deterministic_and_unambiguous():
    workflow = _build_workflow()
    interface = _build_interface()
    values = {"prompt": "a tea prompt", "seed": 42}

    updated = apply_interface_values_to_workflow(workflow, interface, values)
    assert updated["2"]["inputs"]["text"] == "a tea prompt"
    assert updated["1"]["inputs"]["seed"] == 42
    assert updated["3"]["inputs"]["reseed"] == 42
    # Original should remain untouched (pure transform).
    assert workflow["1"]["inputs"]["seed"] == 1


def test_interface_mutation_requires_required_fields():
    workflow = _build_workflow()
    interface = _build_interface()
    with pytest.raises(ValueError):
        apply_interface_values_to_workflow(workflow, interface, {"prompt": "only prompt"})


def test_interface_target_validation_rejects_non_pointer_paths():
    with pytest.raises(Exception):
        TeaInterfaceTarget.model_validate({"path": "not/a/pointer"})


def test_local_pipes_root_prefers_comfy_sweet_tea(monkeypatch, tmp_path):
    comfy_root = tmp_path / "ComfyUI"
    comfy_root.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(tea_package, "_detect_comfy_root", lambda session=None: comfy_root)

    roots = tea_package.get_local_pipes_roots()
    assert roots[0] == comfy_root / "sweet_tea" / "pipes"
    assert tea_package.get_local_pipes_root() == comfy_root / "sweet_tea" / "pipes"
    resolved = tea_package.get_local_pipe_dir("sts.pipe.123e4567-e89b-42d3-a456-426614174000")
    assert resolved == (comfy_root / "sweet_tea" / "pipes" / "sts.pipe.123e4567-e89b-42d3-a456-426614174000")
