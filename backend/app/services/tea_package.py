"""Utilities for working with portable `.tea` pipe packages.

The `.tea` package is a ZIP archive with a strict core layout:
  - manifest.json
  - workflow.json
  - interface.json
  - preview.png

Optional files are preserved for round-trip exports.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path, PureWindowsPath
from typing import Any, Dict, Iterable, List, Literal, Optional, Sequence, Tuple
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlmodel import Session, select

from app.models.engine import Engine
from app.services.comfy_launcher import comfy_launcher

TEA_VERSION = "1.0"
TEA_SCHEMA_VERSION = 1
INTERFACE_SCHEMA_VERSION = 1

REQUIRED_ARCHIVE_FILES: tuple[str, ...] = (
    "manifest.json",
    "workflow.json",
    "interface.json",
    "preview.png",
)

OPTIONAL_ARCHIVE_FILES: tuple[str, ...] = (
    "lock.json",
    "README.md",
    "signatures/ed25519.sig",
    "signatures/publisher.json",
)

OPTIONAL_ARCHIVE_PREFIXES: tuple[str, ...] = (
    "assets/",
    "signatures/",
)

INTERNAL_STORAGE_DIRNAME = ".sts"
INTERNAL_STATE_FILENAME = "state.json"
INTERNAL_ORIGINAL_TEA_FILENAME = "original.tea"

PIPE_ID_RE = re.compile(
    r"^sts\.pipe\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
FIELD_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")

WINDOWS_PLATFORM = "windows-x64"
LINUX_PLATFORM = "linux-x64"

MODEL_EXTENSIONS = {
    ".safetensors",
    ".ckpt",
    ".pt",
    ".pth",
    ".bin",
    ".onnx",
    ".gguf",
}

MODEL_KIND_TO_DIRS: dict[str, tuple[str, ...]] = {
    "checkpoint": ("checkpoints",),
    "lora": ("loras",),
    "vae": ("vae",),
    "embedding": ("embeddings",),
    "controlnet": ("controlnet", "controlnets"),
    "clip": ("clip", "clip_vision"),
    "upscaler": ("upscale_models", "upscalers"),
}

ASSET_SHAREABLE_MAX_BYTES = 20 * 1024 * 1024

TeaSourceType = Literal["local", "civitai", "github", "sweettea-hub"]
TeaModelKind = Literal["checkpoint", "lora", "vae", "embedding", "controlnet", "clip", "upscaler"]
TeaCustomNodeSource = Literal["manager-registry", "github"]
TeaCustomNodeChannel = Literal["stable", "nightly", "recent"]
TeaPinType = Literal["none", "tag", "commit"]
TeaSystemKind = Literal["apt", "dnf", "pacman", "brew", "choco"]
TeaFieldType = Literal[
    "string",
    "int",
    "float",
    "bool",
    "enum",
    "multi-select",
    "file",
    "image",
    "lora-list",
    "controlnet-list",
]
TeaExportMode = Literal["shareable", "exact_clone"]


class TeaBaseModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class TeaManifestAuthor(TeaBaseModel):
    name: str
    handle: Optional[str] = None


class TeaManifestSource(TeaBaseModel):
    type: TeaSourceType
    url: Optional[str] = None
    external_id: Optional[str] = None


class TeaManifestPipe(TeaBaseModel):
    id: str
    name: str
    version: str
    description: Optional[str] = None
    authors: List[TeaManifestAuthor] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    created_at: str
    updated_at: str
    license: str
    homepage: Optional[str] = None
    source: Optional[TeaManifestSource] = None

    @model_validator(mode="after")
    def _validate_pipe(self) -> "TeaManifestPipe":
        if not PIPE_ID_RE.match(self.id):
            raise ValueError("pipe.id must match: sts.pipe.<uuid-v4>")
        return self


class TeaManifestCompat(TeaBaseModel):
    sweet_tea_min_version: str
    sweet_tea_max_version: Optional[str] = None
    comfyui_min_version: Optional[str] = None
    comfyui_max_version: Optional[str] = None
    platforms: List[str] = Field(default_factory=list)


class TeaManifestEntrypoints(TeaBaseModel):
    workflow: str
    interface: str
    preview: str


class TeaManifestModelDependency(TeaBaseModel):
    kind: TeaModelKind
    name: str
    air: Optional[str] = None
    preferred_filename: Optional[str] = None
    required: bool = True
    notes: Optional[str] = None


class TeaManifestCustomNodePin(TeaBaseModel):
    type: TeaPinType
    value: Optional[str] = None


class TeaManifestCustomNodeDependency(TeaBaseModel):
    repo: str
    source: TeaCustomNodeSource
    reference_url: str
    channel: TeaCustomNodeChannel
    required: bool = True
    pin: TeaManifestCustomNodePin = Field(default_factory=lambda: TeaManifestCustomNodePin(type="none", value=None))
    why: str
    declares_nodes: List[str] = Field(default_factory=list)


class TeaManifestPipDependency(TeaBaseModel):
    specifier: str
    required: bool = False
    why: Optional[str] = None


class TeaManifestSystemDependency(TeaBaseModel):
    kind: TeaSystemKind
    package: str
    required: bool = False
    why: Optional[str] = None


class TeaManifestDependencies(TeaBaseModel):
    models: List[TeaManifestModelDependency] = Field(default_factory=list)
    custom_nodes: List[TeaManifestCustomNodeDependency] = Field(default_factory=list)
    pip: List[TeaManifestPipDependency] = Field(default_factory=list)
    system: List[TeaManifestSystemDependency] = Field(default_factory=list)


class TeaManifestUI(TeaBaseModel):
    form_layout: str = "default"
    advanced_sections: bool = True
    defaults_profile: Optional[str] = None


class TeaManifestIntegrity(TeaBaseModel):
    sha256: Dict[str, str] = Field(default_factory=dict)


class TeaManifestV1(TeaBaseModel):
    tea_version: str
    schema_version: int
    pipe: TeaManifestPipe
    compat: TeaManifestCompat
    entrypoints: TeaManifestEntrypoints
    dependencies: TeaManifestDependencies = Field(default_factory=TeaManifestDependencies)
    ui: TeaManifestUI = Field(default_factory=TeaManifestUI)
    integrity: Optional[TeaManifestIntegrity] = None
    extensions: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_manifest(self) -> "TeaManifestV1":
        if self.tea_version != TEA_VERSION:
            raise ValueError(f"Unsupported tea_version '{self.tea_version}', expected '{TEA_VERSION}'")
        if self.schema_version != TEA_SCHEMA_VERSION:
            raise ValueError(
                f"Unsupported schema_version '{self.schema_version}', expected '{TEA_SCHEMA_VERSION}'"
            )
        if _normalize_archive_path(self.entrypoints.workflow) != "workflow.json":
            raise ValueError("entrypoints.workflow must be 'workflow.json'")
        if _normalize_archive_path(self.entrypoints.interface) != "interface.json":
            raise ValueError("entrypoints.interface must be 'interface.json'")
        if _normalize_archive_path(self.entrypoints.preview) != "preview.png":
            raise ValueError("entrypoints.preview must be 'preview.png'")
        return self


class TeaInterfaceTarget(TeaBaseModel):
    path: str

    @model_validator(mode="after")
    def _validate_target(self) -> "TeaInterfaceTarget":
        if not self.path or not self.path.startswith("/"):
            raise ValueError("interface field target path must be an absolute JSON pointer (starts with '/')")
        # Parse eagerly so malformed pointers fail import.
        _split_json_pointer(self.path)
        return self


class TeaInterfaceField(TeaBaseModel):
    id: str
    label: str
    type: TeaFieldType
    description: Optional[str] = None
    section: str = "default"
    group: Optional[str] = None
    advanced: bool = False
    required: bool = True
    default: Any = None
    options: List[str] = Field(default_factory=list)
    constraints: Dict[str, Any] = Field(default_factory=dict)
    targets: List[TeaInterfaceTarget] = Field(default_factory=list)
    extensions: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_field(self) -> "TeaInterfaceField":
        if not FIELD_ID_RE.match(self.id):
            raise ValueError("interface field id must use only [A-Za-z0-9._-]")
        if not self.targets:
            raise ValueError(f"interface field '{self.id}' must declare at least one target")
        if self.type in ("enum", "multi-select") and not self.options:
            raise ValueError(f"interface field '{self.id}' with type '{self.type}' requires non-empty options")
        return self


class TeaInterfaceSection(TeaBaseModel):
    id: str
    title: str
    description: Optional[str] = None
    advanced: bool = False
    fields: List[str] = Field(default_factory=list)


class TeaInterfaceV1(TeaBaseModel):
    tea_version: str
    schema_version: int
    fields: List[TeaInterfaceField]
    sections: List[TeaInterfaceSection] = Field(default_factory=list)
    layout: Dict[str, Any] = Field(default_factory=dict)
    extensions: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_interface(self) -> "TeaInterfaceV1":
        if self.tea_version != TEA_VERSION:
            raise ValueError(f"Unsupported interface tea_version '{self.tea_version}', expected '{TEA_VERSION}'")
        if self.schema_version != INTERFACE_SCHEMA_VERSION:
            raise ValueError(
                f"Unsupported interface schema_version '{self.schema_version}', expected '{INTERFACE_SCHEMA_VERSION}'"
            )
        ids = [field.id for field in self.fields]
        if len(ids) != len(set(ids)):
            raise ValueError("interface field ids must be unique")
        return self


@dataclass
class TeaArchivePayload:
    manifest: TeaManifestV1
    workflow: Dict[str, Any]
    interface: TeaInterfaceV1
    preview_png: bytes
    optional_files: Dict[str, bytes]
    all_files: Dict[str, bytes]
    integrity_mismatches: List[str]


@dataclass
class TeaExportResult:
    archive_bytes: bytes
    filename: str
    manifest: TeaManifestV1
    warnings: List[str]


def manifest_json_schema_v1() -> Dict[str, Any]:
    """Return JSON schema for manifest.json v1."""

    return TeaManifestV1.model_json_schema()


def interface_json_schema_v1() -> Dict[str, Any]:
    """Return JSON schema for interface.json v1."""

    return TeaInterfaceV1.model_json_schema()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def canonical_json_dumps(data: Any) -> str:
    """Deterministic JSON output used by `.tea` export."""

    return json.dumps(
        data,
        ensure_ascii=False,
        sort_keys=True,
        indent=2,
        separators=(",", ": "),
    ) + "\n"


def canonical_json_bytes(data: Any) -> bytes:
    return canonical_json_dumps(data).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _normalize_archive_path(path: str) -> str:
    normalized = (path or "").replace("\\", "/").lstrip("/")
    while "//" in normalized:
        normalized = normalized.replace("//", "/")
    if normalized == ".":
        return ""
    return normalized


def _is_safe_relative_path(path: str) -> bool:
    if not path:
        return False
    rel = Path(path)
    if rel.is_absolute():
        return False
    return all(part not in ("..", "") for part in rel.parts)


def _split_json_pointer(pointer: str) -> List[str]:
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise ValueError(f"invalid JSON pointer: {pointer}")
    tokens = pointer[1:].split("/")
    return [token.replace("~1", "/").replace("~0", "~") for token in tokens]


def _join_json_pointer(tokens: Sequence[str]) -> str:
    escaped = [token.replace("~", "~0").replace("/", "~1") for token in tokens]
    return "/" + "/".join(escaped)


def _set_json_pointer_value(document: Dict[str, Any], pointer: str, value: Any) -> None:
    tokens = _split_json_pointer(pointer)
    if not tokens:
        raise ValueError("cannot assign to root JSON pointer")

    current: Any = document
    for token in tokens[:-1]:
        if not isinstance(current, dict):
            raise ValueError(f"non-object at pointer segment '{token}' for pointer '{pointer}'")
        if token not in current:
            raise ValueError(f"missing pointer segment '{token}' for pointer '{pointer}'")
        current = current[token]

    leaf = tokens[-1]
    if not isinstance(current, dict):
        raise ValueError(f"cannot set pointer '{pointer}' on non-object parent")
    current[leaf] = value


def _pointer_to_runtime_target(pointer: str) -> Dict[str, str]:
    tokens = _split_json_pointer(pointer)
    if len(tokens) < 2:
        return {"json_pointer": pointer}

    node_id = tokens[0]
    if tokens[1] != "inputs":
        return {"json_pointer": pointer}

    field = ".".join(tokens[1:])
    return {"node_id": str(node_id), "field": field}


def runtime_target_from_pointer(pointer: str) -> Dict[str, str]:
    """Public helper to convert an interface JSON-pointer target into runtime mapping format."""

    return _pointer_to_runtime_target(pointer)


def _runtime_target_to_pointer(target: Dict[str, Any]) -> Optional[str]:
    node_id = target.get("node_id")
    field = target.get("field")
    if not isinstance(node_id, str) or not isinstance(field, str):
        json_pointer = target.get("json_pointer")
        return json_pointer if isinstance(json_pointer, str) else None

    tokens = [node_id] + [part for part in field.split(".") if part]
    if len(tokens) < 2:
        return None
    return _join_json_pointer(tokens)


def verify_manifest_integrity(manifest: TeaManifestV1, archive_files: Dict[str, bytes]) -> List[str]:
    """Verify manifest integrity hashes and return mismatching filenames."""

    if not manifest.integrity or not manifest.integrity.sha256:
        return []

    mismatches: List[str] = []
    for filename, expected in manifest.integrity.sha256.items():
        normalized = _normalize_archive_path(filename)
        payload = archive_files.get(normalized)
        if payload is None:
            mismatches.append(normalized)
            continue
        actual = sha256_bytes(payload)
        if actual.lower() != str(expected).lower():
            mismatches.append(normalized)
    return mismatches


def parse_tea_archive(archive_bytes: bytes) -> TeaArchivePayload:
    """Parse and validate a `.tea` archive payload."""

    all_files: Dict[str, bytes] = {}
    with ZipFile(BytesIO(archive_bytes), mode="r") as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            normalized = _normalize_archive_path(info.filename)
            if not _is_safe_relative_path(normalized):
                continue
            all_files[normalized] = archive.read(info.filename)

    missing = [name for name in REQUIRED_ARCHIVE_FILES if name not in all_files]
    if missing:
        raise ValueError(f".tea archive missing required files: {', '.join(sorted(missing))}")

    try:
        manifest_data = json.loads(all_files["manifest.json"].decode("utf-8"))
    except Exception as exc:
        raise ValueError(f"Invalid manifest.json: {exc}") from exc
    manifest = TeaManifestV1.model_validate(manifest_data)

    try:
        workflow_data = json.loads(all_files["workflow.json"].decode("utf-8"))
    except Exception as exc:
        raise ValueError(f"Invalid workflow.json: {exc}") from exc
    if not isinstance(workflow_data, dict):
        raise ValueError("workflow.json must be a JSON object")

    try:
        interface_data = json.loads(all_files["interface.json"].decode("utf-8"))
    except Exception as exc:
        raise ValueError(f"Invalid interface.json: {exc}") from exc
    interface = TeaInterfaceV1.model_validate(interface_data)

    mismatches = verify_manifest_integrity(manifest, all_files)

    optional_files = {
        path: payload
        for path, payload in all_files.items()
        if path not in REQUIRED_ARCHIVE_FILES
    }

    return TeaArchivePayload(
        manifest=manifest,
        workflow=workflow_data,
        interface=interface,
        preview_png=all_files["preview.png"],
        optional_files=optional_files,
        all_files=all_files,
        integrity_mismatches=mismatches,
    )


def apply_interface_values_to_workflow(
    workflow: Dict[str, Any],
    interface: TeaInterfaceV1,
    values: Dict[str, Any],
) -> Dict[str, Any]:
    """Deterministically apply interface values to workflow JSON using JSON pointers."""

    result = deepcopy(workflow)
    incoming = values or {}

    for field in interface.fields:
        if field.id in incoming:
            value = incoming[field.id]
        elif field.default is not None:
            value = deepcopy(field.default)
        elif field.required:
            raise ValueError(f"Missing required interface field '{field.id}'")
        else:
            continue

        coerced = _coerce_interface_field_value(field, value)
        # Stable pointer order ensures deterministic mutation for multi-target fields.
        for target in sorted(field.targets, key=lambda item: item.path):
            _set_json_pointer_value(result, target.path, deepcopy(coerced))

    return result


def _coerce_interface_field_value(field: TeaInterfaceField, value: Any) -> Any:
    field_type = field.type

    if field_type == "string":
        return "" if value is None else str(value)
    if field_type == "int":
        if isinstance(value, bool):
            raise ValueError(f"Field '{field.id}' expects int, got bool")
        return int(value)
    if field_type == "float":
        if isinstance(value, bool):
            raise ValueError(f"Field '{field.id}' expects float, got bool")
        return float(value)
    if field_type == "bool":
        return bool(value)
    if field_type == "enum":
        text = "" if value is None else str(value)
        if field.options and text not in field.options:
            raise ValueError(f"Field '{field.id}' has invalid enum value '{text}'")
        return text
    if field_type == "multi-select":
        if value is None:
            selected: List[str] = []
        elif isinstance(value, list):
            selected = [str(item) for item in value]
        else:
            selected = [str(value)]
        if field.options:
            invalid = [item for item in selected if item not in field.options]
            if invalid:
                raise ValueError(f"Field '{field.id}' has invalid multi-select values: {invalid}")
        return selected
    if field_type in ("file", "image"):
        text = "" if value is None else str(value)
        return _strip_abs_path(text)
    if field_type in ("lora-list", "controlnet-list"):
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError(f"Field '{field.id}' expects a list")
        return value

    return value


def build_runtime_mapping_from_interface(interface: TeaInterfaceV1) -> Dict[str, Any]:
    mapping: Dict[str, Any] = {}
    for field in interface.fields:
        targets = [_pointer_to_runtime_target(target.path) for target in field.targets]
        if len(targets) == 1 and "node_id" in targets[0]:
            mapping[field.id] = targets[0]
        else:
            mapping[field.id] = {"targets": targets}
    return mapping


def _coerce_constraints(constraints: Dict[str, Any]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    if not isinstance(constraints, dict):
        return result
    for key in ("minimum", "maximum", "step", "min", "max"):
        if key in constraints:
            result[key] = constraints[key]
    return result


def build_input_schema_from_interface(interface: TeaInterfaceV1) -> Dict[str, Any]:
    """Convert `.tea` interface schema into Sweet Tea dynamic-form schema."""

    schema: Dict[str, Any] = {}
    ordered_node_ids: List[str] = []

    for field in interface.fields:
        field_schema: Dict[str, Any] = {
            "title": field.label,
            "description": field.description,
            "x_tea_field_id": field.id,
            "x_tea_type": field.type,
            "x_tea_targets": [target.path for target in field.targets],
            "x_form": {
                "section": "nodes",
                "groupId": field.group or field.section,
                "groupTitle": field.group or field.section or "Pipe Controls",
            },
            "x_core": not field.advanced,
        }

        if field.default is not None:
            field_schema["default"] = deepcopy(field.default)

        constraints = _coerce_constraints(field.constraints)
        if "min" in constraints and "minimum" not in constraints:
            constraints["minimum"] = constraints.pop("min")
        if "max" in constraints and "maximum" not in constraints:
            constraints["maximum"] = constraints.pop("max")
        field_schema.update(constraints)

        if field.type == "string":
            field_schema["type"] = "string"
            field_schema["widget"] = "textarea"
        elif field.type == "int":
            field_schema["type"] = "integer"
        elif field.type == "float":
            field_schema["type"] = "number"
        elif field.type == "bool":
            field_schema["type"] = "boolean"
            field_schema["widget"] = "toggle"
        elif field.type == "enum":
            field_schema["type"] = "string"
            field_schema["enum"] = list(field.options)
        elif field.type == "multi-select":
            field_schema["type"] = "array"
            field_schema["widget"] = "multiselect"
            field_schema["enum"] = list(field.options)
        elif field.type in ("file", "image"):
            field_schema["type"] = "string"
            field_schema["widget"] = "media_upload"
            field_schema["x_media_kind"] = "image" if field.type == "image" else "file"
        elif field.type in ("lora-list", "controlnet-list"):
            field_schema["type"] = "array"
            field_schema["widget"] = "textarea"
        else:
            field_schema["type"] = "string"

        first_target = field.targets[0] if field.targets else None
        if first_target:
            parsed = _pointer_to_runtime_target(first_target.path)
            node_id = parsed.get("node_id")
            node_field = parsed.get("field")
            if isinstance(node_id, str):
                field_schema["x_node_id"] = node_id
                if node_id not in ordered_node_ids:
                    ordered_node_ids.append(node_id)
            if isinstance(node_field, str):
                leaf = node_field.split(".")[-1]
                field_schema["mock_field"] = leaf

        schema[field.id] = field_schema

    schema["__schema_version"] = 3
    schema["__node_order"] = _sort_node_ids(ordered_node_ids)
    schema["__tea_interface_version"] = INTERFACE_SCHEMA_VERSION
    return schema


def build_interface_from_workflow_schema(
    input_schema: Dict[str, Any],
    node_mapping: Optional[Dict[str, Any]] = None,
) -> TeaInterfaceV1:
    """Build a `.tea` interface schema from legacy Sweet Tea input schema."""

    mapping = node_mapping or {}
    fields: List[TeaInterfaceField] = []

    for field_id in sorted(input_schema.keys()):
        if not isinstance(field_id, str) or field_id.startswith("__"):
            continue
        field_def = input_schema.get(field_id)
        if not isinstance(field_def, dict):
            continue

        mapped_targets = _extract_targets_from_mapping(mapping.get(field_id))
        if not mapped_targets:
            mapped_targets = _extract_targets_from_schema_field(field_def)
        if not mapped_targets:
            continue

        field_type = _infer_interface_field_type(field_def)
        options = []
        if isinstance(field_def.get("enum"), list):
            options = [str(item) for item in field_def["enum"]]

        section_info = field_def.get("x_form") if isinstance(field_def.get("x_form"), dict) else {}
        constraints: Dict[str, Any] = {}
        for key in ("minimum", "maximum", "step"):
            if key in field_def:
                constraints[key] = field_def[key]

        fields.append(
            TeaInterfaceField(
                id=field_id,
                label=str(field_def.get("title") or field_id),
                type=field_type,
                description=(
                    str(field_def.get("description"))
                    if isinstance(field_def.get("description"), str)
                    else None
                ),
                section=str(section_info.get("section") or "default"),
                group=(
                    str(section_info.get("groupTitle"))
                    if isinstance(section_info.get("groupTitle"), str)
                    else None
                ),
                advanced=not bool(field_def.get("x_core", True)),
                required=False,
                default=deepcopy(field_def.get("default")),
                options=options,
                constraints=constraints,
                targets=[TeaInterfaceTarget(path=pointer) for pointer in mapped_targets],
            )
        )

    return TeaInterfaceV1(
        tea_version=TEA_VERSION,
        schema_version=INTERFACE_SCHEMA_VERSION,
        fields=fields,
        sections=[],
        layout={"style": "default"},
        extensions={},
    )


def _extract_targets_from_mapping(mapping_entry: Any) -> List[str]:
    if not isinstance(mapping_entry, dict):
        return []

    results: List[str] = []
    if "targets" in mapping_entry and isinstance(mapping_entry["targets"], list):
        for target in mapping_entry["targets"]:
            if not isinstance(target, dict):
                continue
            pointer = _runtime_target_to_pointer(target)
            if pointer:
                results.append(pointer)
    else:
        pointer = _runtime_target_to_pointer(mapping_entry)
        if pointer:
            results.append(pointer)
    return sorted(set(results))


def _extract_targets_from_schema_field(field_def: Dict[str, Any]) -> List[str]:
    targets = field_def.get("x_tea_targets")
    if isinstance(targets, list):
        valid = [str(item) for item in targets if isinstance(item, str) and item.startswith("/")]
        if valid:
            return sorted(set(valid))

    node_id = field_def.get("x_node_id")
    if node_id is None:
        return []
    field_name = field_def.get("mock_field")
    if not isinstance(field_name, str) or not field_name:
        return []
    return [_join_json_pointer([str(node_id), "inputs", field_name])]


def _infer_interface_field_type(field_def: Dict[str, Any]) -> TeaFieldType:
    widget = str(field_def.get("widget") or "").lower()
    field_type = str(field_def.get("type") or "").lower()

    if widget == "media_upload":
        media_kind = str(field_def.get("x_media_kind") or "").lower()
        return "image" if media_kind == "image" else "file"
    if widget == "toggle" or field_type == "boolean":
        return "bool"
    if widget == "multiselect" or field_type == "array":
        if str(field_def.get("x_tea_type") or "").lower() in ("lora-list", "controlnet-list"):
            return field_def["x_tea_type"]
        return "multi-select"
    if isinstance(field_def.get("enum"), list) and field_type != "array":
        return "enum"
    if field_type in ("integer", "int"):
        return "int"
    if field_type in ("number", "float"):
        return "float"
    return "string"


def _sort_node_ids(node_ids: Iterable[str]) -> List[str]:
    unique = {str(node_id) for node_id in node_ids}

    def _sort_key(value: str) -> Tuple[int, str]:
        if value.isdigit():
            return (0, f"{int(value):020d}")
        return (1, value)

    return sorted(unique, key=_sort_key)


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")


def _is_abs_path_like(value: str) -> bool:
    if not isinstance(value, str) or not value:
        return False
    if value.startswith(("http://", "https://", "air:", "urn:")):
        return False
    if value.startswith("\\\\"):
        return True
    if re.match(r"^[a-zA-Z]:[\\/]", value):
        return True
    if value.startswith("/"):
        return True
    return False


def _strip_abs_path(value: str) -> str:
    if not _is_abs_path_like(value):
        return value

    candidate = value.replace("\\", "/")
    if re.match(r"^[a-zA-Z]:/", candidate):
        return Path(PureWindowsPath(candidate)).name
    return Path(candidate).name


def sanitize_workflow_for_shareable(workflow: Dict[str, Any]) -> Dict[str, Any]:
    """Strip machine-specific absolute paths from workflow payload."""

    def _sanitize(value: Any) -> Any:
        if isinstance(value, dict):
            return {k: _sanitize(v) for k, v in value.items()}
        if isinstance(value, list):
            return [_sanitize(item) for item in value]
        if isinstance(value, str):
            return _strip_abs_path(value)
        return value

    return _sanitize(workflow)


def sanitize_interface_defaults_for_shareable(interface: TeaInterfaceV1) -> TeaInterfaceV1:
    payload = interface.model_dump()
    for field in payload.get("fields", []):
        if not isinstance(field, dict):
            continue
        if field.get("type") in ("file", "image") and isinstance(field.get("default"), str):
            field["default"] = _strip_abs_path(field["default"])
    return TeaInterfaceV1.model_validate(payload)


def _legacy_local_pipes_root() -> Path:
    """Legacy per-OS fallback location for imported pipes."""

    if os.name == "nt":
        appdata = os.getenv("APPDATA")
        base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return base / "SweetTea" / "pipes"

    return Path.home() / ".config" / "sweettea" / "pipes"


def _normalize_path_identity(path: Path) -> str:
    return os.path.normcase(os.path.normpath(str(path)))


def _preferred_local_pipes_root(session: Optional[Session] = None) -> Optional[Path]:
    comfy_root = _detect_comfy_root(session=session)
    if not comfy_root:
        return None
    if not comfy_root.is_absolute():
        return None
    # User-facing location next to ComfyUI content.
    return comfy_root / "sweet_tea" / "pipes"


def get_local_pipes_roots(session: Optional[Session] = None) -> List[Path]:
    """Return candidate pipe roots ordered by preference."""

    roots: List[Path] = []
    preferred = _preferred_local_pipes_root(session=session)
    if preferred is not None:
        roots.append(preferred)
    roots.append(_legacy_local_pipes_root())

    deduped: List[Path] = []
    seen: set[str] = set()
    for root in roots:
        ident = _normalize_path_identity(root)
        if ident in seen:
            continue
        seen.add(ident)
        deduped.append(root)
    return deduped


def get_local_pipes_root(session: Optional[Session] = None) -> Path:
    """Resolve primary imported-pipe storage root.

    Preference:
    1) `<ComfyUI>/sweet_tea/pipes` (when ComfyUI root is detectable)
    2) Legacy OS config fallback
    """

    roots = get_local_pipes_roots(session=session)
    return roots[0]


def get_local_pipe_dir(pipe_id: str, session: Optional[Session] = None) -> Path:
    """Resolve concrete pipe directory, honoring legacy locations for existing pipes."""

    for root in get_local_pipes_roots(session=session):
        candidate = root / pipe_id
        if candidate.exists():
            return candidate
    return get_local_pipes_root(session=session) / pipe_id


def _safe_pipe_file_path(pipe_dir: Path, relative_path: str) -> Path:
    normalized = _normalize_archive_path(relative_path)
    if not _is_safe_relative_path(normalized):
        raise ValueError(f"Unsafe archive path '{relative_path}'")

    target = (pipe_dir / Path(normalized)).resolve()
    root = pipe_dir.resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"Path '{relative_path}' escapes pipe directory")
    return target


def store_local_pipe_payload(
    *,
    pipe_id: str,
    manifest: TeaManifestV1,
    workflow: Dict[str, Any],
    interface: TeaInterfaceV1,
    preview_png: bytes,
    optional_files: Dict[str, bytes],
    original_archive: Optional[bytes],
    workflow_id: Optional[int],
    unverified: bool,
    integrity_mismatches: List[str],
) -> Path:
    """Persist imported `.tea` payload to local pipe storage."""

    root = get_local_pipes_root()
    root.mkdir(parents=True, exist_ok=True)
    pipe_dir = get_local_pipe_dir(pipe_id)
    # Ensure new writes land in the preferred root (not legacy fallback).
    preferred_pipe_dir = root / pipe_id
    pipe_dir = preferred_pipe_dir
    if pipe_dir.exists():
        shutil.rmtree(pipe_dir)
    pipe_dir.mkdir(parents=True, exist_ok=True)

    _safe_pipe_file_path(pipe_dir, "manifest.json").write_bytes(canonical_json_bytes(manifest.model_dump()))
    _safe_pipe_file_path(pipe_dir, "workflow.json").write_bytes(canonical_json_bytes(workflow))
    _safe_pipe_file_path(pipe_dir, "interface.json").write_bytes(canonical_json_bytes(interface.model_dump()))
    _safe_pipe_file_path(pipe_dir, "preview.png").write_bytes(preview_png)

    for rel_path, payload in optional_files.items():
        normalized = _normalize_archive_path(rel_path)
        if normalized in REQUIRED_ARCHIVE_FILES:
            continue
        target = _safe_pipe_file_path(pipe_dir, normalized)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)

    internal_dir = pipe_dir / INTERNAL_STORAGE_DIRNAME
    internal_dir.mkdir(parents=True, exist_ok=True)
    state = {
        "pipe_id": pipe_id,
        "workflow_id": workflow_id,
        "unverified": bool(unverified),
        "integrity_mismatches": list(integrity_mismatches),
        "updated_at": _utc_now_iso(),
    }
    (internal_dir / INTERNAL_STATE_FILENAME).write_bytes(canonical_json_bytes(state))

    if original_archive is not None:
        (internal_dir / INTERNAL_ORIGINAL_TEA_FILENAME).write_bytes(original_archive)

    return pipe_dir


def read_local_pipe_files(pipe_id: str) -> Dict[str, bytes]:
    """Read persisted pipe files as archive-relative map."""

    pipe_dir = get_local_pipe_dir(pipe_id)
    if not pipe_dir.exists():
        return {}

    files: Dict[str, bytes] = {}
    for path in pipe_dir.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(pipe_dir).as_posix()
        if rel.startswith(f"{INTERNAL_STORAGE_DIRNAME}/"):
            continue
        files[rel] = path.read_bytes()
    return files


def read_local_pipe_manifest(pipe_id: str) -> Optional[TeaManifestV1]:
    payload = read_local_pipe_files(pipe_id)
    raw = payload.get("manifest.json")
    if raw is None:
        return None
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    try:
        return TeaManifestV1.model_validate(data)
    except Exception:
        return None


def _detect_comfy_root(session: Optional[Session] = None) -> Optional[Path]:
    config = comfy_launcher.get_config()
    if config.path:
        candidate = Path(config.path)
        if candidate.exists():
            return candidate

    created_session = False
    local_session = session
    if local_session is None:
        try:
            from app.db.engine import engine as db_engine

            local_session = Session(db_engine)
            created_session = True
        except Exception:
            local_session = None

    try:
        if local_session is not None:
            engine = local_session.exec(select(Engine).where(Engine.is_active == True)).first()  # noqa: E712
            if not engine:
                engine = local_session.exec(select(Engine)).first()
            if engine:
                if engine.input_dir:
                    path = Path(engine.input_dir)
                    if path.is_absolute():
                        return path.parent
                if engine.output_dir:
                    path = Path(engine.output_dir)
                    if path.is_absolute():
                        return path.parent
    finally:
        if created_session and local_session is not None:
            local_session.close()

    return None


def _detect_models_root(comfy_root: Optional[Path]) -> Optional[Path]:
    if comfy_root:
        candidate = comfy_root / "models"
        if candidate.exists():
            return candidate
    return None


def _index_model_files(models_root: Path) -> Dict[str, Dict[str, str]]:
    by_name: Dict[str, str] = {}
    by_stem: Dict[str, str] = {}

    if not models_root.exists():
        return {"by_name": by_name, "by_stem": by_stem}

    for path in models_root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in MODEL_EXTENSIONS:
            continue
        relative = path.relative_to(models_root).as_posix()
        by_name[path.name.lower()] = relative
        by_stem[path.stem.lower()] = relative

    return {"by_name": by_name, "by_stem": by_stem}


def compute_dependency_readiness(
    manifest: TeaManifestV1,
    *,
    session: Optional[Session] = None,
) -> Dict[str, Any]:
    comfy_root = _detect_comfy_root(session=session)
    models_root = _detect_models_root(comfy_root)
    model_index = _index_model_files(models_root) if models_root else {"by_name": {}, "by_stem": {}}

    model_results: List[Dict[str, Any]] = []
    missing_models: List[Dict[str, Any]] = []

    for dep in manifest.dependencies.models:
        required = bool(dep.required)
        found_rel: Optional[str] = None
        candidates: List[str] = []
        if dep.preferred_filename:
            candidates.append(Path(dep.preferred_filename).name.lower())
            candidates.append(Path(dep.preferred_filename).stem.lower())
        if dep.name:
            candidates.append(dep.name.lower())
            candidates.append(Path(dep.name).stem.lower())

        for candidate in candidates:
            if candidate in model_index["by_name"]:
                found_rel = model_index["by_name"][candidate]
                break
            if candidate in model_index["by_stem"]:
                found_rel = model_index["by_stem"][candidate]
                break

        item = {
            "kind": dep.kind,
            "name": dep.name,
            "air": dep.air,
            "preferred_filename": dep.preferred_filename,
            "required": required,
            "status": "ok" if found_rel else "missing",
            "found_path": str(models_root / found_rel) if found_rel and models_root else None,
        }
        model_results.append(item)
        if required and not found_rel:
            missing_models.append(item)

    custom_nodes_root = (comfy_root / "custom_nodes") if comfy_root else None
    node_dirs = []
    if custom_nodes_root and custom_nodes_root.exists():
        node_dirs = [entry.name for entry in custom_nodes_root.iterdir() if entry.is_dir()]
    node_dir_slugs = {_slugify(name): name for name in node_dirs}

    custom_node_results: List[Dict[str, Any]] = []
    missing_custom_nodes: List[Dict[str, Any]] = []

    for dep in manifest.dependencies.custom_nodes:
        required = bool(dep.required)
        repo_slug = _slugify(dep.repo)
        ref_slug = _slugify(Path(dep.reference_url.rstrip("/")).name)
        found_name = None

        if repo_slug in node_dir_slugs:
            found_name = node_dir_slugs[repo_slug]
        elif ref_slug and ref_slug in node_dir_slugs:
            found_name = node_dir_slugs[ref_slug]
        else:
            # Soft match for repos with prefixes/suffixes.
            for slug, original in node_dir_slugs.items():
                if repo_slug and (repo_slug in slug or slug in repo_slug):
                    found_name = original
                    break
                if ref_slug and (ref_slug in slug or slug in ref_slug):
                    found_name = original
                    break

        item = {
            "repo": dep.repo,
            "source": dep.source,
            "reference_url": dep.reference_url,
            "channel": dep.channel,
            "required": required,
            "status": "ok" if found_name else "missing",
            "found_path": str(custom_nodes_root / found_name) if found_name and custom_nodes_root else None,
            "why": dep.why,
        }
        custom_node_results.append(item)
        if required and not found_name:
            missing_custom_nodes.append(item)

    ready = not missing_models and not missing_custom_nodes
    return {
        "ready": ready,
        "models": model_results,
        "custom_nodes": custom_node_results,
        "missing_models": missing_models,
        "missing_custom_nodes": missing_custom_nodes,
    }


def _try_read_git_head(path: Path) -> Optional[str]:
    git_dir = path / ".git"
    if not git_dir.exists():
        return None
    try:
        result = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=3,
        )
        commit = result.stdout.strip()
        return commit if commit else None
    except Exception:
        return None


def detect_custom_node_lock(manifest: TeaManifestV1, *, session: Optional[Session] = None) -> Dict[str, Any]:
    comfy_root = _detect_comfy_root(session=session)
    custom_nodes_root = (comfy_root / "custom_nodes") if comfy_root else None
    if not custom_nodes_root or not custom_nodes_root.exists():
        return {
            "schema_version": 1,
            "generated_at": _utc_now_iso(),
            "custom_nodes": [],
        }

    available_dirs = [entry for entry in custom_nodes_root.iterdir() if entry.is_dir()]
    slug_to_dir = {_slugify(entry.name): entry for entry in available_dirs}

    lock_entries: List[Dict[str, Any]] = []
    for dep in manifest.dependencies.custom_nodes:
        repo_slug = _slugify(dep.repo)
        ref_slug = _slugify(Path(dep.reference_url.rstrip("/")).name)

        matched_dir = slug_to_dir.get(repo_slug) or slug_to_dir.get(ref_slug)
        if matched_dir is None:
            for slug, candidate in slug_to_dir.items():
                if repo_slug and (repo_slug in slug or slug in repo_slug):
                    matched_dir = candidate
                    break
        if matched_dir is None:
            continue

        commit = _try_read_git_head(matched_dir)
        if not commit:
            continue

        lock_entries.append(
            {
                "repo": dep.repo,
                "path": str(matched_dir),
                "commit": commit,
            }
        )

    return {
        "schema_version": 1,
        "generated_at": _utc_now_iso(),
        "custom_nodes": lock_entries,
    }


def _placeholder_preview_png() -> bytes:
    try:
        from PIL import Image

        image = Image.new("RGB", (512, 512), color=(238, 225, 201))
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()
    except Exception:
        # Transparent 1x1 PNG fallback.
        return bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
            "0000000a49444154789c6360000002000154a24f5b0000000049454e44ae426082"
        )


def _infer_model_dependencies_from_workflow(workflow: Dict[str, Any]) -> List[TeaManifestModelDependency]:
    if not isinstance(workflow, dict):
        return []

    dependency_map: Dict[Tuple[str, str], TeaManifestModelDependency] = {}
    class_input_to_kind = {
        ("CheckpointLoaderSimple", "ckpt_name"): "checkpoint",
        ("LoraLoader", "lora_name"): "lora",
        ("VAELoader", "vae_name"): "vae",
        ("ControlNetLoader", "control_net_name"): "controlnet",
        ("CLIPLoader", "clip_name"): "clip",
        ("UpscaleModelLoader", "model_name"): "upscaler",
    }

    for node in workflow.values():
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type") or "")
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue
        for (expected_class, input_name), kind in class_input_to_kind.items():
            if class_type != expected_class:
                continue
            value = inputs.get(input_name)
            if not isinstance(value, str) or not value.strip():
                continue
            filename = Path(_strip_abs_path(value.strip())).name
            key = (kind, filename.lower())
            dependency_map[key] = TeaManifestModelDependency(
                kind=kind,  # type: ignore[arg-type]
                name=filename,
                preferred_filename=filename,
                required=True,
                air=None,
                notes=None,
            )

    return sorted(
        dependency_map.values(),
        key=lambda dep: (dep.kind, dep.preferred_filename or dep.name),
    )


def ensure_manifest_defaults(
    *,
    manifest: Optional[TeaManifestV1],
    workflow_name: str,
    workflow_description: Optional[str],
    workflow: Optional[Dict[str, Any]] = None,
    seed_pipe_id: Optional[str] = None,
    mode: TeaExportMode,
    new_id: bool,
) -> TeaManifestV1:
    now = _utc_now_iso()
    base_manifest = manifest.model_dump() if manifest else {}

    pipe_data = dict(base_manifest.get("pipe") or {})
    compat_data = dict(base_manifest.get("compat") or {})
    entrypoints_data = dict(base_manifest.get("entrypoints") or {})
    dependencies_data = dict(base_manifest.get("dependencies") or {})

    pipe_id = pipe_data.get("id")
    if (not isinstance(pipe_id, str) or not pipe_id) and seed_pipe_id:
        pipe_id = seed_pipe_id
    if not isinstance(pipe_id, str) or new_id:
        pipe_id = f"sts.pipe.{uuid4()}"

    created_at = pipe_data.get("created_at") if isinstance(pipe_data.get("created_at"), str) else now
    updated_at = pipe_data.get("updated_at") if isinstance(pipe_data.get("updated_at"), str) else now
    if mode == "shareable":
        updated_at = now

    pipe_data.update(
        {
            "id": pipe_id,
            "name": workflow_name or pipe_data.get("name") or "Untitled Pipe",
            "version": pipe_data.get("version") or "1.0.0",
            "description": workflow_description
            if workflow_description is not None
            else (pipe_data.get("description") or ""),
            "authors": pipe_data.get("authors") or [],
            "tags": pipe_data.get("tags") or [],
            "created_at": created_at,
            "updated_at": updated_at,
            "license": pipe_data.get("license") or "Proprietary",
            "homepage": pipe_data.get("homepage"),
            "source": pipe_data.get("source") or {"type": "local"},
        }
    )

    compat_data.update(
        {
            "sweet_tea_min_version": compat_data.get("sweet_tea_min_version") or "0.6.0",
            "sweet_tea_max_version": compat_data.get("sweet_tea_max_version"),
            "comfyui_min_version": compat_data.get("comfyui_min_version"),
            "comfyui_max_version": compat_data.get("comfyui_max_version"),
            "platforms": compat_data.get("platforms") or [WINDOWS_PLATFORM, LINUX_PLATFORM],
        }
    )

    entrypoints_data.update(
        {
            "workflow": "workflow.json",
            "interface": "interface.json",
            "preview": "preview.png",
        }
    )

    base_manifest.update(
        {
            "tea_version": TEA_VERSION,
            "schema_version": TEA_SCHEMA_VERSION,
            "pipe": pipe_data,
            "compat": compat_data,
            "entrypoints": entrypoints_data,
            "dependencies": dependencies_data or {},
            "ui": base_manifest.get("ui") or {"form_layout": "default", "advanced_sections": True},
            "integrity": base_manifest.get("integrity") or {"sha256": {}},
            "extensions": base_manifest.get("extensions") or {},
        }
    )

    validated = TeaManifestV1.model_validate(base_manifest)
    if not validated.dependencies.models:
        inferred = _infer_model_dependencies_from_workflow(workflow or {})
        if inferred:
            payload = validated.model_dump()
            payload.setdefault("dependencies", {})
            payload["dependencies"]["models"] = [dep.model_dump() for dep in inferred]
            validated = TeaManifestV1.model_validate(payload)
    return validated


def create_tea_archive(
    *,
    manifest: TeaManifestV1,
    workflow: Dict[str, Any],
    interface: TeaInterfaceV1,
    preview_png: bytes,
    optional_files: Optional[Dict[str, bytes]] = None,
    mode: TeaExportMode = "shareable",
) -> TeaExportResult:
    warnings: List[str] = []

    export_workflow = deepcopy(workflow)
    export_interface = TeaInterfaceV1.model_validate(interface.model_dump())
    extra_files = dict(optional_files or {})

    if mode == "shareable":
        export_workflow = sanitize_workflow_for_shareable(export_workflow)
        export_interface = sanitize_interface_defaults_for_shareable(export_interface)

        # Shareable exports should not include machine-local lock metadata by default.
        if "lock.json" in extra_files:
            extra_files.pop("lock.json", None)

        for rel_path in list(extra_files.keys()):
            normalized = _normalize_archive_path(rel_path)
            if normalized.startswith("assets/") and len(extra_files[rel_path]) > ASSET_SHAREABLE_MAX_BYTES:
                warnings.append(f"Skipping large asset '{normalized}' in shareable export")
                extra_files.pop(rel_path, None)

    workflow_bytes = canonical_json_bytes(export_workflow)
    interface_bytes = canonical_json_bytes(export_interface.model_dump())
    preview_bytes = preview_png if preview_png else _placeholder_preview_png()

    manifest_payload = manifest.model_dump()
    manifest_payload.setdefault("integrity", {})
    manifest_payload["integrity"]["sha256"] = {
        "workflow.json": sha256_bytes(workflow_bytes),
        "interface.json": sha256_bytes(interface_bytes),
        "preview.png": sha256_bytes(preview_bytes),
    }
    export_manifest = TeaManifestV1.model_validate(manifest_payload)
    manifest_bytes = canonical_json_bytes(export_manifest.model_dump())

    archive_buffer = BytesIO()
    with ZipFile(archive_buffer, mode="w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", manifest_bytes)
        archive.writestr("workflow.json", workflow_bytes)
        archive.writestr("interface.json", interface_bytes)
        archive.writestr("preview.png", preview_bytes)

        for rel_path in sorted(extra_files.keys()):
            normalized = _normalize_archive_path(rel_path)
            if not _is_safe_relative_path(normalized):
                warnings.append(f"Skipping unsafe archive path '{rel_path}'")
                continue
            if normalized in REQUIRED_ARCHIVE_FILES:
                continue
            archive.writestr(normalized, extra_files[rel_path])

    slug = _slugify(export_manifest.pipe.name) or "pipe"
    filename = f"{slug}-{export_manifest.pipe.version}.tea"
    return TeaExportResult(
        archive_bytes=archive_buffer.getvalue(),
        filename=filename,
        manifest=export_manifest,
        warnings=warnings,
    )
