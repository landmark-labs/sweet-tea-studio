# Media File Management (Sweet Tea Studio)

This document explains every media ingestion, generation, management, display, and deletion flow that touches files on disk. It is written to make file behavior predictable and to keep the gallery, project gallery, projects page, and file explorer in lockstep.

## Canonical Media Roots

Sweet Tea treats the filesystem as the source of truth for project assignment. A file "belongs" to a project if its path lives under one of that project's known roots.

Project roots are discovered in this order:
1) ComfyUI input root: `/ComfyUI/input/<project>/`
2) Legacy Sweet Tea output root: `/ComfyUI/sweet_tea/<project>/`
3) Local fallback: `<SWEET_TEA_ROOT>/projects/<project>/`

If a file is under any of these roots, it is considered part of that project. If a path does not match any known root, it is treated as unassigned.

## Generation (New Files)

1) Frontend creates a Job with `project_id` and `output_dir` (folder name like "output" or "transform").
2) Backend `job_processor` generates outputs by:
   - Fetching ComfyUI outputs (local file or HTTP).
   - Writing the final output into `input/<project>/<output_dir>/` (canonical location).
   - Embedding provenance in EXIF (JPEG) or PNG text fields; if embedding fails, writes a sidecar `.json`.
   - Creating a DB Image record (path, filename, dimensions, thumbnail bytes, metadata).
3) Images are now in filesystem and indexed in the database.

No extra image files are created outside the managed folder except optional thumbnail cache in `meta/thumbnails` (see Thumbnails).

## Gallery Indexing and Resync

The gallery is driven by the Image table in the database. To guarantee that every media file on disk is reflected in the gallery and counts:

- `GET /gallery` triggers a throttled resync (`SWEET_TEA_MEDIA_RESYNC_INTERVAL_SECONDS`, default 60s).
- `GET /projects` also triggers the same resync.

Resync behavior:
1) Scans all known project roots (input + legacy output + local).
2) Skips `.trash`, `.cache`, `thumbnails`, `masks`, and obvious thumbnail/mask filenames.
3) Imports missing media files into the DB, extracting metadata from:
   - PNG text chunks / JPEG EXIF comments
   - Sweet Tea provenance fields
   - ComfyUI prompt metadata
   - Sidecar `.json` files
4) If a file was previously missing but is found again, it restores `file_exists` and clears `is_deleted`.

Resync never writes new media files. It only updates DB rows.

## Project Assignment Rules

Project assignment is path-first:
- If the file path matches a known project root, that project is used.
- If no roots exist (misconfigured engine), it falls back to `job.project_id`.
- Otherwise, the file is unassigned.

This keeps gallery filters, project gallery, and project counts consistent with the filesystem.

## Project Gallery (Prompt Studio Panel)

API: `GET /projects/{project_id}/folders/{folder}/images`

Behavior:
- Resolves the folder across all relevant roots (input + legacy output + local).
- Scans each folder and returns media files (images + videos).
- Excludes any file whose path is soft-deleted in the DB.
- Sorts by modification time (newest first).

The Project Gallery is filesystem-driven, so it always reflects what is on disk for that project folder.

## Image Viewer (Prompt Studio)

The ImageViewer's navigation list is intentionally source-scoped to prevent stale or mismatched navigation:
- `recent` source uses the main gallery list.
- `project_gallery` / `output_folder` sources use the current project folder list.
- `media_tray` uses the tray-derived list.

When deletes occur, the viewer list and recent gallery list are updated immediately using normalized path comparisons so deleted files cannot be paged to after removal. ProjectGallery polling also notifies the viewer list for the active project/folder so the UI stays in sync without requiring a navigation refresh.

## Projects Page Counts

API: `GET /projects`

Behavior:
- Uses DB images but resolves project membership from file paths (path-first).
- Ensures missing files are not counted (updates `file_exists` when unknown).
- Uses Job timestamps when available; otherwise uses Image created_at (file mtime during resync).

This keeps project counts aligned with the filesystem and the project gallery.

## File Explorer

API: `GET /files/tree`

Behavior:
- Without `project_id`, shows engine Input and Output roots.
- With `project_id`, shows:
  - Single root: direct project folder list
  - Multiple roots: separate roots for input, legacy output, and local storage
- Hidden entries (dotfiles like `.trash`) are not shown.

The file explorer is now consistent with the same project roots used by the gallery and counts.

## Uploads (New Files)

API: `POST /files/upload`

Use case: user uploads a file via the UI.
- Writes to `/ComfyUI/input/<project>/<subfolder>/` when project is selected.
- Adds a timestamp prefix to avoid collisions.
- Returns a ComfyUI-compatible relative path for LoadImage.

Uploads are user-initiated file creation (not generation).

## Copy-To-Input (Edge Case)

API: `POST /files/copy-to-input`

Use case: a file is outside the input directory (e.g., dragged from output or external disk).
- If already inside `/ComfyUI/input`, returns its relative path.
- Otherwise copies it into `/ComfyUI/input/<project>/<subfolder>/`, preserving filename.

This ensures external inputs become managed files and show up consistently.

## Mask Saving

API: `POST /files/save-mask`

Use case: inpaint editor saves a mask.
- If source image maps to a project, mask is saved to `/ComfyUI/input/<project>/masks/`.
- Otherwise saves next to the source image.

Masks are excluded from gallery/resync scans to avoid polluting galleries.

## Deletion and Trash

### Gallery Delete (by ID)
API: `DELETE /gallery/{image_id}` or bulk delete.
- Moves file to `.trash` inside the same folder.
- Renames to `timestamp_imageId_originalFilename`.
- Marks DB `is_deleted = True`.

### Delete by Path (for non-DB images)
API: `DELETE /gallery/image/path/delete`
- Removes file and sidecar `.json`.
- Soft-deletes DB record if it exists.

### Project Folder Delete
API: `POST /projects/{project_id}/folders/{folder}/delete-images`
- Removes file and sidecar `.json`.
- Soft-deletes DB record if it exists.

### Restore
API: `POST /gallery/restore`
- Moves `.trash` items back to original location.
- Clears `is_deleted` and `trash_path`.

### Empty Trash
API: `DELETE /projects/{project_id}/folders/{folder}/trash`
- Permanently deletes everything under `.trash` for that folder across all roots.

`.trash` folders are excluded from all scans and UI listing.

## Thumbnails and Metadata

- Inline thumbnails are stored in the DB for images (not videos).
- `GET /gallery/image/path/thumbnail` may write a cached JPEG thumbnail to `meta/thumbnails`.
- Metadata is embedded in images when possible and falls back to sidecar `.json` files.

## Known Guarantees

- Files in managed roots appear in the main gallery after automatic resync.
- Project gallery reflects the filesystem directly.
- Project counts match filesystem placement.
- `.trash` is excluded everywhere by default.

## Operational Notes

- For best path inference, keep engine input/output dirs configured.
- Legacy outputs under `/ComfyUI/sweet_tea` are still recognized.
- Manual filesystem changes are detected on the next resync (automatic or manual).
