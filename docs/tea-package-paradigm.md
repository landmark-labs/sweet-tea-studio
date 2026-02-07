# `.tea` Package Paradigm

Sweet Tea Studio supports portable pipe packages via `.tea` files.

## Format

`.tea` is a ZIP container with a strict required layout:

- `manifest.json`
- `workflow.json`
- `interface.json`
- `preview.png`

Optional entries are preserved when available:

- `assets/*`
- `lock.json`
- `signatures/ed25519.sig`
- `signatures/publisher.json`
- `README.md`
- Unknown extra files (ignored on import, preserved for round-trip export)

## Validation

- `manifest.json` is validated against schema v1 (`tea_version: "1.0"`, `schema_version: 1`).
- `interface.json` is validated against schema v1 and requires stable unique field IDs.
- Integrity hashes in `manifest.integrity.sha256` are verified on import when present.
- Imports continue on hash mismatch and are marked unverified.

## Interface Mapping

`interface.json` field targets use absolute JSON pointers into `workflow.json`
(for example: `/12/inputs/seed`).

This mapping is deterministic:

- Import compiles target pointers into runtime mapping metadata.
- Run-time parameter application supports single-target and multi-target fields.
- Export keeps mapping stable and reproducible.

## Import Flow

API: `POST /api/v1/tea-pipes/import` (multipart form)

- Validates ZIP + required files.
- Parses/validates manifest and interface schemas.
- Verifies integrity (when hashes are present).
- Registers a workflow entry in the DB.
- Stores normalized `.tea` contents on local disk.
- Computes dependency readiness (models + custom nodes).

## Export Flow

API: `GET /api/v1/tea-pipes/{workflow_id}/export?mode=shareable|exact_clone&new_id=false|true`

Modes:

- `shareable`
  - strips machine-specific absolute paths
  - removes machine lock metadata
  - skips very large `assets/*` payloads
- `exact_clone`
  - preserves local metadata
  - includes `lock.json` with detected custom-node commits when available

Both modes produce deterministic JSON (`UTF-8`, stable key ordering, LF) and write
fresh `integrity.sha256` values for required files.

## Local Persistence

Imported pipes are persisted outside the DB:

- Preferred (when ComfyUI is detected): `<ComfyUI>/sweet_tea/pipes/<pipeId>/...`
- Legacy fallback on Windows: `%APPDATA%/SweetTea/pipes/<pipeId>/...`
- Legacy fallback on Linux: `~/.config/sweettea/pipes/<pipeId>/...`

Internal metadata is stored under `.sts/` inside each pipe folder.
Original `.tea` blob persistence is configurable via app setting:
`pipes_store_original_blob`.

## Frontend Integration

Workflow Library now supports:

- importing `.tea` files (plus legacy ComfyUI API JSON)
- viewing per-pipe metadata/readiness
- dependency fix action hooks (models/custom nodes)
- exporting `.tea` in `shareable` or `exact_clone` mode
