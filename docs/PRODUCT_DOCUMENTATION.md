# Sweet Tea Studio Product Documentation (Draft)

Status: Draft. This is a living, comprehensive reference built from the current codebase and existing docs.

## Purpose
This document captures the product surface area, UX flows, architecture, APIs, and file map for Sweet Tea Studio. It is intended to be a long-form foundation for future official documentation.

## Table of Contents
1. Overview
2. Core Concepts
3. Architecture
4. User Workflows
5. Feature Reference
6. Data and Storage
7. API Overview
8. Frontend Reference
9. Backend Reference
10. Operational Notes
11. Related Documents

## 1. Overview
Sweet Tea Studio is a local-first web interface for ComfyUI that replaces node graphs with project-based workflows and dynamic forms. It keeps ComfyUI as the execution engine while Sweet Tea manages projects, prompts, runs, galleries, models, and system health.

## 2. Core Concepts
- Engine: A configured ComfyUI instance used to execute workflows.
- Workflow Template (Pipe): A user-facing wrapper around a ComfyUI graph that includes input schema for dynamic forms.
- Project: A named workspace with folders and metadata for organizing runs and outputs.
- Job: A queued generation request submitted to ComfyUI.
- Run: A stored record of a generation execution (portfolio schema).
- Output: A generated file produced by a run.
- Prompt: A saved preset used to reapply form values.
- Snippet: A reusable prompt fragment used in the prompt constructor.
- Canvas: A snapshot of prompt construction state (optional, stored via API).
- Gallery: The browsing surface for generated images and metadata.
- Tags: Structured keywords used for prompt suggestions and VLM output.

## 3. Architecture
### 3.1 Frontend
- React + Vite + TypeScript.
- TailwindCSS and Shadcn/UI for styling and components.
- State management uses React Query + local stores for generation data.

### 3.2 Backend
- FastAPI app providing REST and WebSocket endpoints.
- SQLModel with SQLite for persistence.
- Background tasks for job processing, downloads, tag cache, and monitoring.

### 3.3 Storage and File System
- Root directory defaults to `~/.sweet-tea` (override with `SWEET_TEA_ROOT_DIR`).
- Metadata is stored under `~/.sweet-tea/meta/` (profile database, tags database).
- Project folders under `~/.sweet-tea/projects/<project>/`.
- A flat output mirror at `~/.sweet-tea/outputs_all/`.
- ComfyUI input/output directories are configurable and mapped to project folders.

### 3.4 ComfyUI Integration
- HTTP and WebSocket clients bridge ComfyUI REST and live progress.
- A launcher manages start/stop and arguments for a local ComfyUI process.
- A watchdog monitors engine health and retries connectivity.

### 3.5 Vision Assist (VLM)
- Optional local vision language model for captioning and tag extraction.
- Runs locally via `backend/app/services/vlm.py` with concurrency limits.

## 4. User Workflows
### 4.1 Configure ComfyUI
1. Set ComfyUI path and URL from the Settings page or the ComfyUI control panel.
2. Confirm engine health via status indicators.

### 4.2 Create or Import a Pipe
1. Import a ComfyUI workflow JSON in the Workflow Library.
2. Edit schema annotations and mark fields as core/advanced.
3. Save the workflow as a Pipe for Prompt Studio.

### 4.3 Generate Images
1. Choose an engine and pipe in Prompt Studio.
2. Fill the dynamic form and prompt constructor blocks.
3. Submit a job and monitor progress in the running gallery.

### 4.4 Organize Projects
1. Create a project in the Projects page.
2. Route jobs and outputs into project folders.
3. Use the project sidebar to navigate inputs and outputs.

### 4.5 Review Outputs
1. Open Gallery for search and filtering.
2. Use Image Viewer for metadata, pan/zoom, and regeneration.
3. Mark outputs as kept or discard and clean up non-kept images.

### 4.6 Save and Reuse Prompts
1. Save prompt presets to the Prompt Library.
2. Reapply presets across compatible workflows.
3. Reuse snippets and tags to build prompts quickly.

### 4.7 Manage Models and Extensions
1. Browse local model directories in Models Manager.
2. Queue model downloads from Hugging Face or Civitai.
3. Install missing custom nodes via Extension Manager.

### 4.8 Use Vision Assist
1. Run `python scripts/download_models.py` to install VLM models.
2. Caption images or convert tags into prompt text in Prompt Studio.

## 5. Feature Reference
### 5.1 Application Shell and Navigation
**User experience**
- Sidebar navigation with routes for Prompt Studio, Projects, Pipes, Gallery, Library, Models, and Settings.
- Connection banners and indicators for engine status.

**Key UI files**
- `frontend/src/components/Layout.tsx`
- `frontend/src/App.tsx`
- `frontend/src/components/ErrorBoundary.tsx`
- `frontend/src/components/ConnectionBanner.tsx`
- `frontend/src/components/ConnectionIndicator.tsx`
- `frontend/src/components/StatusBar.tsx`

### 5.2 Prompt Studio (Generation Engine)
**User experience**
- Dynamic, schema-driven forms for each pipe.
- Prompt constructor with reorderable blocks and tag autocomplete.
- Live job progress, previews, and running gallery.

**Key UI files**
- `frontend/src/pages/PromptStudio.tsx`
- `frontend/src/components/DynamicForm.tsx`
- `frontend/src/lib/undoRedo.tsx`
- `frontend/src/components/PromptConstructor.tsx`
- `frontend/src/components/PromptAutocompleteTextarea.tsx`
- `frontend/src/components/PromptLibraryQuickPanel.tsx`
- `frontend/src/components/ImageUpload.tsx`
- `frontend/src/components/InpaintEditor.tsx`
- `frontend/src/components/GenerationFeed.tsx`
- `frontend/src/components/RunningGallery.tsx`
- `frontend/src/components/ImageViewer.tsx`
- `frontend/src/components/ProjectGallery.tsx`
- `frontend/src/lib/GenerationContext.tsx`
- `frontend/src/lib/stores/promptDataStore.ts`

**Backend endpoints and services**
- `backend/app/api/endpoints/jobs.py` (job creation, cancellation, progress)
- `backend/app/services/job_processor.py` (job execution pipeline)
- `backend/app/core/websockets.py` (real-time updates)
- `backend/app/api/endpoints/canvases.py` (canvas snapshots)

**Related data models**
- `backend/app/models/job.py`
- `backend/app/models/image.py`
- `backend/app/models/canvas.py`

### 5.3 Workflow Library and Pipes
**User experience**
- Import/export ComfyUI workflows as JSON.
- Edit schema, reorder nodes, mark core/advanced fields, and hide nodes.
- Compose multiple pipes and visualize graph connections.

**Key UI files**
- `frontend/src/pages/WorkflowLibrary.tsx`
- `frontend/src/components/WorkflowGraphViewer.tsx`

**Backend endpoints and services**
- `backend/app/api/endpoints/workflows.py`
- `backend/app/core/workflow_merger.py`
- `backend/app/api/endpoints/engines.py` (object info for schema generation)

**Related data models**
- `backend/app/models/workflow.py`

### 5.4 Projects
**User experience**
- Create, archive, and manage projects.
- Browse project folder structure via the sidebar.
- Associate jobs and runs with projects.

**Key UI files**
- `frontend/src/pages/Projects.tsx`
- `frontend/src/components/ProjectSidebar.tsx`
- `frontend/src/components/CollectionSidebar.tsx` (legacy)

**Backend endpoints and services**
- `backend/app/api/endpoints/projects.py`
- `backend/app/core/config.py` (project directories)

**Related data models**
- `backend/app/models/project.py`

### 5.5 Gallery System
**User experience**
- Search, filter, and browse images across projects.
- Keep/discard, delete, or cleanup images in bulk.
- View metadata, pan/zoom, and regenerate.

**Key UI files**
- `frontend/src/pages/Gallery.tsx`
- `frontend/src/components/ImageViewer.tsx`

**Backend endpoints and services**
- `backend/app/api/endpoints/gallery.py`
- `backend/app/services/gallery_search.py`

**Related data models**
- `backend/app/models/image.py`

### 5.6 Models Manager
**User experience**
- Browse local model folders and metadata.
- Queue downloads from Hugging Face or Civitai.
- Track progress, speed, and cancel downloads.

**Key UI files**
- `frontend/src/pages/Models.tsx`

**Backend endpoints and services**
- `backend/app/api/endpoints/models.py`
- `backend/app/services/download_manager.py`

### 5.7 Vision Assist (VLM)
**User experience**
- Generate captions or tag lists from images.
- Convert tags into prompt-ready text.

**Backend endpoints and services**
- `backend/app/api/endpoints/vlm.py`
- `backend/app/services/vlm.py`

### 5.8 Prompt Library and Snippets
**User experience**
- Save prompts as reusable presets with tags.
- Quick panel suggestions while editing prompts.
- Drag and reorder snippet blocks in Prompt Studio.

**Key UI files**
- `frontend/src/pages/PromptLibrary.tsx`
- `frontend/src/components/PromptLibraryQuickPanel.tsx`

**Backend endpoints and services**
- `backend/app/api/endpoints/library.py`
- `backend/app/api/endpoints/library_tags.py`
- `backend/app/api/endpoints/snippets.py`

**Related data models**
- `backend/app/models/prompt.py`
- `backend/app/models/snippet.py`
- `backend/app/models/tag.py`

### 5.9 Extension Manager
**User experience**
- Detect missing custom nodes in workflows.
- Install missing nodes with progress feedback.

**Key UI files**
- `frontend/src/components/InstallStatusDialog.tsx`
- `frontend/src/pages/WorkflowLibrary.tsx` (missing node warnings)

**Backend endpoints and services**
- `backend/app/api/endpoints/extensions.py`
- `backend/app/core/manager_client.py`

### 5.10 ComfyUI Integration and Control
**User experience**
- Manage ComfyUI path, args, and launch status.
- View connection indicators and error banners.

**Key UI files**
- `frontend/src/components/ComfyUIControl.tsx`
- `frontend/src/components/ConnectionBanner.tsx`
- `frontend/src/components/ConnectionIndicator.tsx`

**Backend endpoints and services**
- `backend/app/core/comfy_client.py`
- `backend/app/core/comfy_diagnostics.py`
- `backend/app/services/comfy_launcher.py`
- `backend/app/services/comfy_watchdog.py`

### 5.11 Status and Monitoring
**User experience**
- Status bar indicators for engine, queue, I/O, and models.
- Performance HUD with system metrics.

**Key UI files**
- `frontend/src/components/StatusBar.tsx`
- `frontend/src/components/PerformanceHUD.tsx`

**Backend endpoints and services**
- `backend/app/api/endpoints/status.py`
- `backend/app/api/endpoints/monitoring.py`
- `backend/app/services/monitoring.py`

### 5.12 Settings and Configuration
**User experience**
- Adjust app settings and API keys from Settings page.

**Key UI files**
- `frontend/src/pages/Settings.tsx`

**Backend endpoints and services**
- `backend/app/api/endpoints/settings.py`
- `backend/app/services/app_settings.py`
- `backend/app/core/config.py`

## 6. Data and Storage
### 6.1 Database Files
- Main portfolio database: `~/.sweet-tea/meta/profile.db`.
- Tag cache database: `~/.sweet-tea/meta/tags.db`.

### 6.2 Project File Layout
- Project metadata and folders in `~/.sweet-tea/projects/<slug>/`.
- Default project folders: `inputs/`, `outputs/`, `masks/`.
- ComfyUI input/output folders are configured via engine settings and mapped to project subfolders.

### 6.3 Primary Data Models
- Engine: `backend/app/models/engine.py`
- WorkflowTemplate (Pipe): `backend/app/models/workflow.py`
- Project: `backend/app/models/project.py`
- Job: `backend/app/models/job.py`
- Image: `backend/app/models/image.py`
- Prompt: `backend/app/models/prompt.py`
- Snippet: `backend/app/models/snippet.py`
- Tag: `backend/app/models/tag.py`
- Collection (legacy): `backend/app/models/collection.py`
- Canvas: `backend/app/models/canvas.py`
- AppSetting: `backend/app/models/app_setting.py`

### 6.4 Portfolio Schema Models
- ComfyWorkflow, Pipe, Run, Output, ModelCatalog in `backend/app/models/portfolio.py`

### 6.5 Database Infrastructure
- Engine configuration: `backend/app/db/engine.py`
- Session helpers: `backend/app/db/database.py`
- Initialization: `backend/app/db/init_db.py`
- Migrations: `backend/app/db/migrations/`

## 7. API Overview
All endpoints are under `/api/v1`.

- `engines/`: Engine CRUD and ComfyUI control.
- `workflows/`: Pipe management, import/export, schema generation.
- `canvases/`: Canvas snapshot CRUD.
- `projects/`: Project management and folder operations.
- `jobs/`: Generation job execution and cancellation.
- `gallery/`: Image browsing, metadata, keep/discard, cleanup, and file serving.
- `files/`: File operations for upload and retrieval.
- `library/`: Prompt library CRUD and search.
- `snippets/`: Prompt snippet CRUD and ordering.
- `extensions/`: Missing node installs and status tracking.
- `vlm/`: Vision Assist captioning, tags, and health checks.
- `collections/`: Legacy collections.
- `monitoring/`: System metrics endpoints.
- `models/`: Model discovery and download queue.
- `portfolio/`: Portfolio run/output query endpoints.
- `status`: Status summary and subsystem health checks.
- `settings`: API keys and app settings management.

## 8. Frontend Reference
### 8.1 Pages and Routes
- `/` -> `frontend/src/pages/PromptStudio.tsx`
- `/projects` -> `frontend/src/pages/Projects.tsx`
- `/pipes` -> `frontend/src/pages/WorkflowLibrary.tsx`
- `/gallery` -> `frontend/src/pages/Gallery.tsx`
- `/library` -> `frontend/src/pages/PromptLibrary.tsx`
- `/models` -> `frontend/src/pages/Models.tsx`
- `/settings` -> `frontend/src/pages/Settings.tsx`

### 8.2 Key Components
- Dynamic forms and prompts: `frontend/src/components/DynamicForm.tsx`, `frontend/src/components/PromptConstructor.tsx`
- Gallery and viewer: `frontend/src/components/RunningGallery.tsx`, `frontend/src/components/ImageViewer.tsx`
- Workflow graph: `frontend/src/components/WorkflowGraphViewer.tsx`
- ComfyUI control: `frontend/src/components/ComfyUIControl.tsx`
- Status and performance: `frontend/src/components/StatusBar.tsx`, `frontend/src/components/PerformanceHUD.tsx`

### 8.3 Shared Libraries
- API client: `frontend/src/lib/api.ts`
- Types: `frontend/src/lib/types.ts`
- Schema utilities: `frontend/src/lib/schema.ts`
- Telemetry helpers: `frontend/src/lib/telemetry.ts`
- UI labels: `frontend/src/ui/labels.ts`

### 8.4 UI Component Library
Shadcn-based components in `frontend/src/components/ui/`, including `accordion.tsx`, `dialog.tsx`, `tabs.tsx`, `tooltip.tsx`, and others.

## 9. Backend Reference
### 9.1 Core Modules
- ComfyUI client: `backend/app/core/comfy_client.py`
- Diagnostics: `backend/app/core/comfy_diagnostics.py`
- Workflow merging: `backend/app/core/workflow_merger.py`
- Manager client: `backend/app/core/manager_client.py`
- WebSockets: `backend/app/core/websockets.py`

### 9.2 Services
- Job processor: `backend/app/services/job_processor.py`
- Download manager: `backend/app/services/download_manager.py`
- Portfolio storage: `backend/app/services/portfolio_storage.py`
- Monitoring: `backend/app/services/monitoring.py`
- VLM: `backend/app/services/vlm.py`
- ComfyUI launcher: `backend/app/services/comfy_launcher.py`
- ComfyUI watchdog: `backend/app/services/comfy_watchdog.py`
- App settings: `backend/app/services/app_settings.py`

### 9.3 API Endpoints (Files)
- `backend/app/api/endpoints/engines.py`
- `backend/app/api/endpoints/workflows.py`
- `backend/app/api/endpoints/projects.py`
- `backend/app/api/endpoints/jobs.py`
- `backend/app/api/endpoints/gallery.py`
- `backend/app/api/endpoints/files.py`
- `backend/app/api/endpoints/library.py`
- `backend/app/api/endpoints/library_tags.py`
- `backend/app/api/endpoints/snippets.py`
- `backend/app/api/endpoints/extensions.py`
- `backend/app/api/endpoints/vlm.py`
- `backend/app/api/endpoints/models.py`
- `backend/app/api/endpoints/status.py`
- `backend/app/api/endpoints/monitoring.py`
- `backend/app/api/endpoints/portfolio.py`
- `backend/app/api/endpoints/canvases.py`
- `backend/app/api/endpoints/collections.py`
- `backend/app/api/endpoints/settings.py`

### 9.4 Scripts
- VLM model download: `backend/scripts/download_models.py`

## 10. Operational Notes
- ComfyUI must be reachable at the configured URL for generation to work.
- The watchdog retries engine health checks and surfaces errors in the UI.
- Tag autocomplete relies on the background tag cache refresh (`library_tags.py`).
- VLM requires local model downloads and adequate RAM/VRAM.
- Environment variables are prefixed with `SWEET_TEA_` and override defaults.

## 11. Related Documents
- `README.md`
- `docs/feature_inventory.md`
- `docs/ROADMAP.md`
- `HANDOFF_CONTEXT.md`
