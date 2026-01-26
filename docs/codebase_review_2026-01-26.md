# Sweet Tea Studio Codebase Review (2026-01-26)

## Scope
- Repository: sweet-tea-studio
- Areas reviewed: backend/app, frontend/src, docs, scripts
- Focus: structure, scalability, redundancy, hard-coded values, and refactoring opportunities

## Findings (ordered by severity)

### High
- (Resolved) Status endpoints have been consolidated under `backend/app/api/endpoints/monitoring.py`; the legacy `status.py` router was removed to prevent drift and runtime errors.

### Medium
- UI port editor is disconnected: `ConnectionIndicator` stores `ds_comfyui_port` in localStorage but nothing consumes it, so changing the port has no effect. This is misleading for users. File: `frontend/src/components/ConnectionIndicator.tsx:23-53`.
- (Resolved) Client diagnostics logs are written under the configured meta directory (`settings.meta_dir/logs`) instead of the repo tree.
- (Resolved) Hard-coded, user-specific ComfyUI path in detection list was removed.

### Low
- (Resolved) Type definitions duplicated across `frontend/src/lib/api.ts` and `frontend/src/lib/types.ts` were consolidated into `lib/types`.
- (Resolved) Path normalization logic is centralized in `backend/app/services/media_paths.py` and reused by gallery services.
- (Resolved) `frontend/src/components/ImageUpload.backup.tsx` removed.
- Large modules remain (e.g., `backend/app/api/endpoints/gallery.py`, `backend/app/services/job_processor.py`), but `DynamicForm` has been split into `frontend/src/components/dynamic-form/` subcomponents and Prompt Studio/Gallery/Settings were moved into feature folders.

## Structure / Scalability Assessment
- Overall repo layout is coherent: `backend/`, `frontend/`, `docs/`, and `scripts/` are clear and conventional.
- Backend layering is partially in place (`api/`, `services/`, `models/`, `db/`), but heavy business logic still lives in endpoint modules, which hurts readability and testability at scale.
- Frontend structure is reasonable (`pages/`, `components/`, `lib/`, `ui/`), but several pages/components are monolithic and mix UI, state, and data fetching.

## Refactoring Opportunities
- Consolidated “status” behavior under `monitoring.py`; removed the legacy router.
- File-system, metadata, and search logic moved out of `gallery.py` into `backend/app/services/gallery/` modules.
- Prompt Studio, Gallery, and Settings split into feature folders with shared utils/components.
- Job processor sequence naming/cache helpers extracted to `backend/app/services/job_processor_sequence.py`.
- Path utilities centralized on the frontend (`frontend/src/lib/pathUtils.ts`) and backend gallery paths reuse `media_paths.normalize_fs_path`.
- Portfolio storage now normalizes stored paths to POSIX separators for cross-platform portability.
- Aria2c auto-download is gated to Windows; other platforms fall back to PATH.
- Duplicated TS interfaces removed from `lib/api.ts` in favor of `lib/types`.
- Configuration defaults normalized by removing user-specific ComfyUI paths.

## Suggested Target Organization (one viable option)

### Backend
```
backend/app/
  api/
    routers/
  core/
  db/
  domains/
    gallery/
      service.py
      repo.py
      schemas.py
      router.py
    jobs/
    workflows/
    projects/
  services/
```

### Frontend
```
frontend/src/
  app/            # providers, routing
  features/
    prompt-studio/
    gallery/
    workflows/
    projects/
    models/
    settings/
  shared/
    components/
    ui/
    hooks/
    lib/
```

## Testing Gaps
- Backend: minimal unit coverage around the heavy `gallery` and `job_processor` logic; add tests for path normalization, media indexing, and queue status behavior.
- Frontend: few tests around large feature pages; prioritize Prompt Studio, Gallery, and Settings flows, plus path-handling utilities.

## Notes
- This review is structural and maintainability-focused. It does not validate runtime behavior of ComfyUI itself.
