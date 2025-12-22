---
name: video-support-roadmap
description: Roadmap to add image-to-video and video-to-video support with media-aware UI and metadata.
---

# Plan

Upgrade Sweet Tea Studio to a media-aware pipeline (image + video) for image-to-video and video-to-video, reusing existing flows while keeping playback responsive.

## Requirements
- Support image-to-video and video-to-video with mixed inputs (multiple images/videos).
- Expose any node input that expects image/video data (type-based, not node-specific).
- Keep UI responsive during playback; avoid regressions to image workflows.
- Accept videos up to ~15s / 100 MB, multiple formats.
- Viewer supports play/pause; existing image viewer accommodates videos.
- Generate thumbnails/posters for videos.
- Bundle ffmpeg/ffprobe for video metadata and poster generation.
- Use JSON sidecar metadata for video outputs and persist metadata to SQLite (profile.db).
- Provide gallery filter for images vs videos (default both).
- Preserve existing schemas, storage, and UI patterns where possible.
- Embed/attach metadata after files are written.

## Scope
- In: schema generation, media upload, output processing, gallery/serving, viewer, metadata/thumbnails, project folder scanning.
- Out: streaming video preview, long video workflows, full video editing.

## Files and entry points
- Backend: backend/app/api/endpoints/workflows.py, backend/app/services/job_processor.py, backend/app/core/comfy_client.py, backend/app/api/endpoints/gallery.py, backend/app/api/endpoints/files.py, backend/app/api/endpoints/projects.py, backend/app/models/image.py, backend/app/models/portfolio.py
- Frontend: frontend/src/components/ImageUpload.tsx, frontend/src/components/ImageViewer.tsx, frontend/src/components/RunningGallery.tsx, frontend/src/components/ProjectGallery.tsx, frontend/src/pages/PromptStudio.tsx, frontend/src/pages/Gallery.tsx, frontend/src/lib/api.ts, frontend/src/lib/types.ts, frontend/src/lib/promptUtils.ts

## Data model / API changes
- Add media fields to Image (preferred to minimize churn): media_kind, mime_type, size_bytes, duration_ms, frame_count, fps, codec, audio_codec, bitrate, poster_path.
- Populate Output.kind = video and Output.meta_json with video details (duration, frames).
- Extend gallery and folder APIs to include media_kind and video metadata.
- Add media_kind filter param (images/videos/all).

## Action items
[ ] Update schema generation to detect media inputs by Comfy type (IMAGE/MASK/VIDEO/etc.), not node name; set widget: media_upload and x_media_kind so any node with media input is exposed.
[ ] Update prompt utils to map x_media_kind fields (image/video) for auto-fill and "use in pipe".
[ ] Extend upload UI to be media-aware (accept images/videos per field), reuse drag/drop and recent lists, and keep existing image defaults.
[ ] Enforce size/type limits in backend/app/api/endpoints/files.py, preserve file extension, and return mime info.
[ ] Bundle ffmpeg/ffprobe with the backend distribution and allow a configurable path override.
[ ] Update ComfyClient.get_images to get_outputs to parse video outputs from history; include kind, filename, subfolder, and optional url.
[ ] Extend process_job to save videos, generate poster thumbnails, write JSON sidecar, and persist metadata to DB; keep image path unchanged.
[ ] Expand gallery serving/metadata to return correct Content-Type and parse sidecar JSON for videos; update delete/cleanup to remove sidecars/posters.
[ ] Update viewers and lists: render <video> with play/pause, preload=metadata, and poster; add a media filter (default both) in gallery surfaces.
[ ] Add safeguards: feature flag for video, regression checks for image flows, and a fallback to image-only when metadata tools are missing.
[ ] Add perf instrumentation for playback jank and confirm prompt typing remains within targets.

## Testing and validation
- Backend: unit tests for media type detection, metadata extraction, and sidecar creation.
- API: integration tests for gallery filtering, file serving, and metadata endpoints for both images and videos.
- Frontend: manual smoke test for mixed inputs, playback controls, thumbnails, and drag/drop into pipes.
- Perf: verify playback does not regress prompt input latency; log diagnostics during playback.

## Risks and edge cases
- Bundled ffmpeg/ffprobe increases app size; ensure licensing and platform compatibility.
- Large file uploads causing UI stalls; keep postprocessing async.
- Mixed schemas with linked inputs; ensure only unlinked media inputs become fields.
- Gallery search/indexing assumes images; ensure video rows do not break FTS or metadata parsing.

## Open questions
- None.
