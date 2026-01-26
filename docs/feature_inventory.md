# Sweet Tea Studio - Comprehensive Feature Inventory

> **Project:** Sweet Tea Studio v0.6.0  
> **Description:** Local-first ComfyUI wrapper with project-based workflow management  
> **Generated:** 2025-12-15

---

## Table of Contents

1. [Application Shell & Navigation](#1-application-shell--navigation)
2. [Generation Engine (Prompt Studio)](#2-generation-engine-prompt-studio)
3. [Workflow/Pipe Management](#3-workflowpipe-management)
4. [Project Organization](#4-project-organization)
5. [Gallery System](#5-gallery-system)
6. [Models Manager](#6-models-manager)
7. [Vision Language Model (VLM)](#7-vision-language-model-vlm)
8. [Prompt Library & Snippets](#8-prompt-library--snippets)
9. [Extension Manager](#9-extension-manager)
10. [ComfyUI Integration](#10-comfyui-integration)
11. [Status & Monitoring](#11-status--monitoring)
12. [Database & Storage](#12-database--storage)
13. [Configuration & Settings](#13-configuration--settings)

---

## 1. Application Shell & Navigation

### 1.1 Layout System
Main application shell with sidebar navigation and content area.

| Feature | Description | Files |
|---------|-------------|-------|
| Sidebar Navigation | Collapsible sidebar with route links | `frontend/src/components/Layout.tsx` |
| Route Configuration | React Router setup with 7 main routes | `frontend/src/App.tsx` |
| Error Boundary | Global error catching wrapper | `frontend/src/components/ErrorBoundary.tsx` |
| Connection Banner | ComfyUI connection status banner | `frontend/src/components/ConnectionBanner.tsx` |
| Connection Indicator | Visual status of ComfyUI connection | `frontend/src/components/ConnectionIndicator.tsx` |

### 1.2 Application Routes

| Route | Page Component | Description |
|-------|----------------|-------------|
| `/` | `PromptStudio` | Main generation interface |
| `/projects` | `Projects` | Project management |
| `/pipes` | `WorkflowLibrary` | Workflow/pipe management |
| `/gallery` | `Gallery` | Image gallery browser |
| `/library` | `PromptLibrary` | Saved prompts library |
| `/models` | `Models` | Model management & downloads |
| `/settings` | `Settings` | Application settings |

---

## 2. Generation Engine (Prompt Studio)

### 2.1 Core Generation Interface
The main page for creating and running image generations.

| Feature | Description | Files |
|---------|-------------|-------|
| Prompt Studio Page | Main generation interface container | `frontend/src/features/prompt-studio/PromptStudioPage.tsx` |
| Dynamic Form System | Auto-generated forms from workflow schema | `frontend/src/components/DynamicForm.tsx` |
| Form Persistence | LocalStorage persistence of form data | `frontend/src/components/DynamicForm.tsx` |
| Undo/Redo Support | Ctrl+Z/Ctrl+Shift+Z in form fields | `frontend/src/lib/undoRedo.tsx` |

### 2.2 Prompt Construction

| Feature | Description | Files |
|---------|-------------|-------|
| Prompt Constructor | Drag-and-drop snippet/text blocks builder | `frontend/src/components/PromptConstructor.tsx` |
| Autocomplete Textarea | Tag/prompt autocomplete suggestions | `frontend/src/components/PromptAutocompleteTextarea.tsx` |
| Snippet Management | Reusable prompt presets | `frontend/src/components/PromptConstructor.tsx`, `backend/app/api/endpoints/snippets.py` |
| Snippet Drag/Drop | DnD-kit based reordering | `frontend/src/components/PromptConstructor.tsx` |

### 2.3 Image Input/Upload

| Feature | Description | Files |
|---------|-------------|-------|
| Image Upload Widget | File/drag-drop image input | `frontend/src/components/ImageUpload.tsx` |
| Inpaint Editor | Canvas-based mask painting | `frontend/src/components/InpaintEditor.tsx` |
| Gallery Drag-to-Input | Drag gallery images to form inputs | `frontend/src/components/ImageUpload.tsx`, `frontend/src/components/ImageViewer.tsx` |

### 2.4 Job Execution

| Feature | Description | Files |
|---------|-------------|-------|
| Job Creation | POST /jobs/ creates generation job | `backend/app/api/endpoints/jobs.py` |
| Job Processing | Background task execution | `backend/app/services/job_processor.py` |
| Job Cancellation | Interrupt running jobs | `backend/app/api/endpoints/jobs.py` |
| WebSocket Updates | Real-time progress streaming | `backend/app/api/endpoints/jobs.py`, `backend/app/core/websockets.py` |
| Progress Display | Progress bar in UI | `frontend/src/features/prompt-studio/PromptStudioPage.tsx` |
| Preview Images | Live generation previews | `frontend/src/components/GenerationFeed.tsx` |

### 2.5 Generation Feed & Results

| Feature | Description | Files |
|---------|-------------|-------|
| Generation Feed | Real-time results panel | `frontend/src/components/GenerationFeed.tsx` |
| Running Gallery | Floating panel with recent generations | `frontend/src/components/RunningGallery.tsx` |
| Image Viewer | Full-screen image preview with metadata | `frontend/src/components/ImageViewer.tsx` |
| Project Gallery | Project-specific image grid | `frontend/src/components/ProjectGallery.tsx` |

### 2.6 Generation Context

| Feature | Description | Files |
|---------|-------------|-------|
| Generation State | Global generation state management | `frontend/src/lib/GenerationContext.tsx` |
| Feed Store | Zustand-based feed state | `frontend/src/lib/stores/promptDataStore.ts` |
| Prompt Library Store | Global prompt suggestions | `frontend/src/lib/stores/promptDataStore.ts` |

---

## 3. Workflow/Pipe Management

### 3.1 Workflow Library Page

| Feature | Description | Files |
|---------|-------------|-------|
| Workflow List | Browse all saved pipes | `frontend/src/pages/WorkflowLibrary.tsx` |
| Workflow Import | Import from JSON files | `frontend/src/pages/WorkflowLibrary.tsx`, `backend/app/api/endpoints/workflows.py` |
| Workflow Export | Export to JSON bundle | `frontend/src/pages/WorkflowLibrary.tsx`, `backend/app/api/endpoints/workflows.py` |
| Workflow Delete | Remove pipes from library | `backend/app/api/endpoints/workflows.py` |

### 3.2 Pipe Editor

| Feature | Description | Files |
|---------|-------------|-------|
| Schema Editor | Edit input_schema annotations | `frontend/src/pages/WorkflowLibrary.tsx` |
| Node Cards | Visual node configuration | `frontend/src/pages/WorkflowLibrary.tsx` (NodeCard component) |
| Core/Advanced Toggle | Mark fields as core or advanced | `frontend/src/pages/WorkflowLibrary.tsx` |
| Node Ordering | Drag-and-drop node reordering | `frontend/src/pages/WorkflowLibrary.tsx` |
| Hide Nodes | Hide nodes from form | `frontend/src/pages/WorkflowLibrary.tsx` |

### 3.3 Pipe Composition

| Feature | Description | Files |
|---------|-------------|-------|
| Workflow Merging | Combine two pipes into one | `backend/app/core/workflow_merger.py` |
| Compose UI | Source/target selection dialog | `frontend/src/pages/WorkflowLibrary.tsx` |
| Auto-Bridge Detection | Find Save→Load connection points | `backend/app/core/workflow_merger.py` |

### 3.4 Graph Visualization

| Feature | Description | Files |
|---------|-------------|-------|
| Graph Viewer | Topological node graph display | `frontend/src/components/WorkflowGraphViewer.tsx` |
| Node Rendering | Visual node boxes with connections | `frontend/src/components/WorkflowGraphViewer.tsx` |

### 3.5 Schema Generation

| Feature | Description | Files |
|---------|-------------|-------|
| Schema from Graph | Parse ComfyUI graph to input_schema | `backend/app/api/endpoints/workflows.py` (generate_schema_from_graph) |
| Object Info Integration | Fetch node definitions from ComfyUI | `backend/app/api/endpoints/engines.py` (read_object_info) |

---

## 4. Project Organization

### 4.1 Project Management

| Feature | Description | Files |
|---------|-------------|-------|
| Projects Page | Project list and management | `frontend/src/pages/Projects.tsx` |
| Create Project | New project with slug generation | `backend/app/api/endpoints/projects.py` |
| Archive Project | Soft-delete (archive) projects | `backend/app/api/endpoints/projects.py` |
| Unarchive Project | Restore archived projects | `backend/app/api/endpoints/projects.py` |
| Project Config | JSON configuration per project | `backend/app/api/endpoints/projects.py` |

### 4.2 Project Folders

| Feature | Description | Files |
|---------|-------------|-------|
| Folder System | Input/output/masks/custom folders | `backend/app/api/endpoints/projects.py` |
| Add Folder | Create new project subfolders | `backend/app/api/endpoints/projects.py` (add_project_folder) |
| Folder Images | List images in project folders | `backend/app/api/endpoints/projects.py` (list_project_folder_images) |
| Folder Selection | UI to select destination folder | `frontend/src/features/prompt-studio/PromptStudioPage.tsx` |

### 4.3 Project Sidebar

| Feature | Description | Files |
|---------|-------------|-------|
| Project Sidebar | Collapsible project/folder tree | `frontend/src/components/ProjectSidebar.tsx` |
| Project Selection | Global project context | `frontend/src/lib/GenerationContext.tsx` |
| Collection Sidebar | Legacy collection navigation | `frontend/src/components/CollectionSidebar.tsx` |

### 4.4 Job Association

| Feature | Description | Files |
|---------|-------------|-------|
| Adopt Jobs | Move draft jobs to project | `backend/app/api/endpoints/projects.py` (adopt_jobs_into_project) |
| Convert Runs | Move runs between projects | `backend/app/api/endpoints/projects.py` (convert_runs_to_project) |

---

## 5. Gallery System

### 5.1 Main Gallery

| Feature | Description | Files |
|---------|-------------|-------|
| Gallery Page | Main image browsing interface | `frontend/src/features/gallery/GalleryPage.tsx` |
| Gallery API | Fetch images with search/filters | `backend/app/api/endpoints/gallery.py`, `backend/app/services/gallery/` |
| Search/Filter | Fuzzy text search across prompts | `backend/app/api/endpoints/gallery.py` |
| Project Filter | Filter by project assignment | `backend/app/api/endpoints/gallery.py` |

### 5.2 Image Operations

| Feature | Description | Files |
|---------|-------------|-------|
| Delete Image | Soft-delete images | `backend/app/api/endpoints/gallery.py` (delete_image) |
| Keep/Discard | Mark images as kept | `backend/app/api/endpoints/gallery.py` (keep_images) |
| Cleanup | Batch remove non-kept images | `backend/app/api/endpoints/gallery.py` (cleanup_images) |
| Multi-Select | Shift/Ctrl click selection | `frontend/src/features/gallery/GalleryPage.tsx` |
| Bulk Delete | Delete multiple selected images | `frontend/src/features/gallery/GalleryPage.tsx` |

### 5.3 Image Viewing

| Feature | Description | Files |
|---------|-------------|-------|
| Image Viewer | Full-screen modal with controls | `frontend/src/components/ImageViewer.tsx` |
| Pan/Zoom | Mouse wheel zoom, drag to pan | `frontend/src/components/ImageViewer.tsx` |
| Arrow Navigation | Left/right between images | `frontend/src/components/ImageViewer.tsx` |
| Download | Download original image | `frontend/src/components/ImageViewer.tsx` |
| Copy Prompts | Copy positive/negative to clipboard | `frontend/src/components/ImageViewer.tsx` |

### 5.4 Image Metadata

| Feature | Description | Files |
|---------|-------------|-------|
| Metadata Display | Show prompt/params in viewer | `frontend/src/components/ImageViewer.tsx` |
| Metadata API | Read PNG metadata | `backend/app/api/endpoints/gallery.py` (get_image_metadata_by_path) |
| Provenance Embedding | Embed Sweet Tea data in PNG | `backend/app/services/job_processor.py` |
| Regenerate | Re-run with same parameters | `frontend/src/components/ImageViewer.tsx` |

### 5.5 Image Serving

| Feature | Description | Files |
|---------|-------------|-------|
| Serve by ID | GET /gallery/{image_id}/file | `backend/app/api/endpoints/gallery.py` |
| Serve by Path | GET /gallery/file?path= | `backend/app/api/endpoints/gallery.py` |

---

## 6. Models Manager

### 6.1 Models Page

| Feature | Description | Files |
|---------|-------------|-------|
| Models Page | Model browser and downloader | `frontend/src/pages/Models.tsx` |
| Folder Browser | Browse model directories | `backend/app/api/endpoints/models.py` |
| Installed Models | List all installed models | `backend/app/api/endpoints/models.py` (list_installed_models) |

### 6.2 Model Downloading

| Feature | Description | Files |
|---------|-------------|-------|
| Download Manager | Background download service | `backend/app/services/download_manager.py` |
| Queue Downloads | Add URL to download queue | `backend/app/api/endpoints/models.py` (queue_download) |
| HuggingFace Support | Download from HF repos | `backend/app/services/download_manager.py` |
| Civitai Support | Download from Civitai | `backend/app/services/download_manager.py` |
| Progress Tracking | Download progress/speed | `backend/app/api/endpoints/models.py` (list_downloads) |
| Cancel Downloads | Cancel or remove downloads | `backend/app/api/endpoints/models.py` (cancel_or_remove_download) |

### 6.3 Model Directory Config

| Feature | Description | Files |
|---------|-------------|-------|
| Directory Override | Runtime models path override | `backend/app/api/endpoints/models.py` |
| Folder Contents | Lazy-load folder contents | `backend/app/api/endpoints/models.py` (get_folder_contents) |
| Caching | Cache model lists for performance | `backend/app/api/endpoints/models.py` |

---

## 7. Vision Language Model (VLM)

### 7.1 VLM Service

| Feature | Description | Files |
|---------|-------------|-------|
| VLM Integration | Local Transformers/vLLM models | `backend/app/services/vlm.py` |
| Model Loading | Lazy-load with quantization | `backend/app/services/vlm.py` |
| Concurrency Limiting | Semaphore-based limits | `backend/app/services/vlm.py` |

### 7.2 Image Captioning

| Feature | Description | Files |
|---------|-------------|-------|
| Caption Generation | Generate captions from images | `backend/app/api/endpoints/vlm.py` (caption_image) |
| Tag Extraction | Extract ranked tags from captions | `backend/app/services/vlm.py` |
| Caption Saving | Persist captions to database | `backend/app/api/endpoints/vlm.py` |

### 7.3 Tag-to-Prompt

| Feature | Description | Files |
|---------|-------------|-------|
| Tags to Prompt | Convert tags to prompt text | `backend/app/api/endpoints/vlm.py` (tags_to_prompt) |
| VLM Health Check | Check if VLM is available | `backend/app/api/endpoints/vlm.py` (health) |

---

## 8. Prompt Library & Snippets

### 8.1 Prompt Library

| Feature | Description | Files |
|---------|-------------|-------|
| Library Page | Browse saved prompts | `frontend/src/pages/PromptLibrary.tsx` |
| Library API | CRUD for prompts | `backend/app/api/endpoints/library.py` |
| Search Prompts | Fuzzy search with scoring | `backend/app/api/endpoints/library.py` |
| Create Prompt | Save new prompt preset | `backend/app/api/endpoints/library.py` (create_prompt) |
| Delete Prompt | Remove saved prompt | `backend/app/api/endpoints/library.py` (delete_prompt) |

### 8.2 Tag System

| Feature | Description | Files |
|---------|-------------|-------|
| Tag Suggestions | Autocomplete tag suggestions | `backend/app/api/endpoints/library.py` (suggest) |
| Tag Cache | Background tag cache refresh | `backend/app/api/endpoints/library_tags.py` |
| Tag Storage | Persistent tag database | `backend/app/models/tag.py` |

### 8.3 Snippets

| Feature | Description | Files |
|---------|-------------|-------|
| Snippet Model | Database model for snippets | `backend/app/models/snippet.py` |
| Snippet CRUD | Create/update/delete snippets | `backend/app/api/endpoints/snippets.py` |
| Reorder Snippets | Change snippet ordering | `backend/app/api/endpoints/snippets.py` (reorder_snippets) |
| Bulk Upsert | Migrate from localStorage | `backend/app/api/endpoints/snippets.py` (bulk_upsert_snippets) |
| Default Snippets | Seed defaults on first use | `backend/app/api/endpoints/snippets.py` |

### 8.4 Quick Panel

| Feature | Description | Files |
|---------|-------------|-------|
| Library Quick Panel | Floating prompt suggestions panel | `frontend/src/components/PromptLibraryQuickPanel.tsx` |

---

## 9. Extension Manager

### 9.1 Missing Node Detection

| Feature | Description | Files |
|---------|-------------|-------|
| Missing Node List | Identify missing custom nodes | `frontend/src/pages/WorkflowLibrary.tsx` (getMissingNodes) |
| Missing Node UI | Warning badges on workflows | `frontend/src/pages/WorkflowLibrary.tsx` |

### 9.2 Node Installation

| Feature | Description | Files |
|---------|-------------|-------|
| Install API | Background installation jobs | `backend/app/api/endpoints/extensions.py` |
| Manager Integration | ComfyUI Manager API calls | `backend/app/core/manager_client.py` |
| Git Clone Fallback | Direct git clone if Manager fails | `backend/app/api/endpoints/extensions.py` |
| Pip Install | Automatic dependency installation | `backend/app/api/endpoints/extensions.py` |
| Install Progress | Poll-based status tracking | `backend/app/api/endpoints/extensions.py` (get_install_status) |

### 9.3 Installation UI

| Feature | Description | Files |
|---------|-------------|-------|
| Install Dialog | Modal with progress display | `frontend/src/components/InstallStatusDialog.tsx` |
| Reboot Button | Trigger ComfyUI restart | `frontend/src/pages/WorkflowLibrary.tsx`, `backend/app/api/endpoints/extensions.py` |

---

## 10. ComfyUI Integration

### 10.1 ComfyUI Client

| Feature | Description | Files |
|---------|-------------|-------|
| HTTP Client | REST API calls to ComfyUI | `backend/app/core/comfy_client.py` |
| WebSocket Client | Real-time progress streaming | `backend/app/core/comfy_client.py` |
| Queue Prompt | Submit workflow for execution | `backend/app/core/comfy_client.py` (queue_prompt) |
| Interrupt | Cancel running execution | `backend/app/core/comfy_client.py` (interrupt) |
| Get History | Fetch execution history | `backend/app/core/comfy_client.py` (get_history) |
| Get Images | Retrieve generated images | `backend/app/core/comfy_client.py` (get_images) |
| System Stats | Get ComfyUI system info | `backend/app/core/comfy_client.py` (get_system_stats) |
| Object Info | Get node definitions | `backend/app/core/comfy_client.py` (get_object_info) |

### 10.2 Diagnostic Mode

| Feature | Description | Files |
|---------|-------------|-------|
| Diagnostic Client | Extended logging/debugging | `backend/app/core/comfy_diagnostics.py` |
| Mode Toggle | Switch between normal/diagnostic | `backend/app/api/endpoints/jobs.py` |

### 10.3 ComfyUI Launcher

| Feature | Description | Files |
|---------|-------------|-------|
| Auto-Detection | Find ComfyUI installation | `backend/app/services/comfy_launcher.py` |
| Python Detection | Find correct Python env | `backend/app/services/comfy_launcher.py` |
| Launch Process | Start ComfyUI subprocess | `backend/app/services/comfy_launcher.py` (launch) |
| Stop Process | Stop managed ComfyUI | `backend/app/services/comfy_launcher.py` (stop) |
| Status Tracking | Monitor process state | `backend/app/services/comfy_launcher.py` (get_status) |
| Configuration | Set path and args | `backend/app/api/endpoints/engines.py` |
| Cooldown | Prevent rapid start/stop | `backend/app/services/comfy_launcher.py` |
| Log File | Capture ComfyUI output | `backend/app/services/comfy_launcher.py` |

### 10.4 ComfyUI Watchdog

| Feature | Description | Files |
|---------|-------------|-------|
| Health Checking | Periodic engine health checks | `backend/app/services/comfy_watchdog.py` |
| State Tracking | Track engine health states | `backend/app/services/comfy_watchdog.py` |
| Auto-Retry | Exponential backoff on failures | `backend/app/services/comfy_watchdog.py` |

### 10.5 ComfyUI Control UI

| Feature | Description | Files |
|---------|-------------|-------|
| Control Panel | Configure/launch ComfyUI | `frontend/src/components/ComfyUIControl.tsx` |
| Path Configuration | Set ComfyUI path | `frontend/src/components/ComfyUIControl.tsx` |
| Launch Args | Configure launch arguments | `frontend/src/components/ComfyUIControl.tsx` |

---

## 11. Status & Monitoring

### 11.1 Status Bar

| Feature | Description | Files |
|---------|-------------|-------|
| Status Bar | Bottom status indicators | `frontend/src/components/StatusBar.tsx` |
| Engine Status | ComfyUI connection indicator | `frontend/src/components/StatusBar.tsx` |
| Queue Status | Pending jobs indicator | `frontend/src/components/StatusBar.tsx` |
| I/O Status | File write health | `frontend/src/components/StatusBar.tsx` |
| Models Status | Missing models indicator | `frontend/src/components/StatusBar.tsx` |

### 11.2 Status API

| Feature | Description | Files |
|---------|-------------|-------|
| Status Summary | Aggregated system status | `backend/app/api/endpoints/monitoring.py` (get_status_summary) |
| Engine Check | ComfyUI connectivity check | `backend/app/api/endpoints/monitoring.py` (get_status_summary) |
| Queue Check | Job queue status | `backend/app/api/endpoints/monitoring.py` (get_status_summary) |
| I/O Check | File I/O health | `backend/app/api/endpoints/monitoring.py` (get_status_summary) |
| Models Check | Model availability | `backend/app/api/endpoints/monitoring.py` (get_status_summary) |

### 11.3 Monitoring

| Feature | Description | Files |
|---------|-------------|-------|
| Monitoring API | System metrics endpoint | `backend/app/api/endpoints/monitoring.py` |
| Monitoring Service | System stats collection | `backend/app/services/monitoring.py` |

### 11.4 Performance HUD

| Feature | Description | Files |
|---------|-------------|-------|
| Performance Display | System metrics visualization | `frontend/src/components/PerformanceHUD.tsx` |

---

## 12. Database & Storage

### 12.1 Database Models

| Model | Description | File |
|-------|-------------|------|
| Engine | ComfyUI engine configuration | `backend/app/models/engine.py` |
| WorkflowTemplate | Saved pipes/workflows | `backend/app/models/workflow.py` |
| Project | Project organization | `backend/app/models/project.py` |
| Job | Generation job records | `backend/app/models/job.py` |
| Image | Generated image records | `backend/app/models/image.py` |
| Prompt | Saved prompt presets | `backend/app/models/prompt.py` |
| Snippet | Prompt snippets | `backend/app/models/snippet.py` |
| Tag | Tag database | `backend/app/models/tag.py` |
| Collection | Image collections (legacy) | `backend/app/models/collection.py` |

### 12.2 Portfolio Schema

| Model | Description | File |
|-------|-------------|------|
| ComfyWorkflow | Deduplicated raw graphs | `backend/app/models/portfolio.py` |
| Pipe | User-facing workflow wrapper | `backend/app/models/portfolio.py` |
| Run | Generation execution record | `backend/app/models/portfolio.py` |
| Output | Output file records | `backend/app/models/portfolio.py` |
| ModelCatalog | Model usage tracking | `backend/app/models/portfolio.py` |

### 12.3 Database Infrastructure

| Feature | Description | Files |
|---------|-------------|-------|
| SQLite Database | Main database file | `backend/database.db` |
| SQLModel Engine | Database connection | `backend/app/db/engine.py` |
| Session Management | Database sessions | `backend/app/db/database.py` |
| Initialization | Schema creation | `backend/app/db/init_db.py` |
| Migrations | Schema migrations | `backend/app/db/migrations/` |

### 12.4 Portfolio Storage

| Feature | Description | Files |
|---------|-------------|-------|
| Portfolio Service | Comprehensive generation tracking | `backend/app/services/portfolio_storage.py` |
| Portfolio API | Query portfolio data | `backend/app/api/endpoints/portfolio.py` |

---

## 13. Configuration & Settings

### 13.1 Settings Page

| Feature | Description | Files |
|---------|-------------|-------|
| Settings Page | Application settings | `frontend/src/features/settings/SettingsPage.tsx` |
| Database Export | Export database backup | `frontend/src/components/Layout.tsx` |

### 13.2 Backend Configuration

| Feature | Description | Files |
|---------|-------------|-------|
| Config Module | Environment/settings | `backend/app/core/config.py` |
| CORS Settings | Cross-origin configuration | `backend/app/main.py` |

### 13.3 Engine Configuration

| Feature | Description | Files |
|---------|-------------|-------|
| Engine CRUD | Create/read/update engines | `backend/app/api/endpoints/engines.py` |
| Engine Health | Health check endpoints | `backend/app/api/endpoints/engines.py` |
| Output Dir Config | Configure output directory | `backend/app/api/endpoints/engines.py` |
| Input Dir Config | Configure input directory | `backend/app/api/endpoints/engines.py` |

---

## UI Component Library

### Shadcn/UI Components

| Component | File |
|-----------|------|
| Accordion | `frontend/src/components/ui/accordion.tsx` |
| Alert | `frontend/src/components/ui/alert.tsx` |
| Badge | `frontend/src/components/ui/badge.tsx` |
| Button | `frontend/src/components/ui/button.tsx` |
| Card | `frontend/src/components/ui/card.tsx` |
| Checkbox | `frontend/src/components/ui/checkbox.tsx` |
| Command | `frontend/src/components/ui/command.tsx` |
| Context Menu | `frontend/src/components/ui/context-menu.tsx` |
| Dialog | `frontend/src/components/ui/dialog.tsx` |
| Draggable Panel | `frontend/src/components/ui/draggable-panel.tsx` |
| Hover Card | `frontend/src/components/ui/hover-card.tsx` |
| Input | `frontend/src/components/ui/input.tsx` |
| Label | `frontend/src/components/ui/label.tsx` |
| Popover | `frontend/src/components/ui/popover.tsx` |
| Progress | `frontend/src/components/ui/progress.tsx` |
| Scroll Area | `frontend/src/components/ui/scroll-area.tsx` |
| Select | `frontend/src/components/ui/select.tsx` |
| Separator | `frontend/src/components/ui/separator.tsx` |
| Slider | `frontend/src/components/ui/slider.tsx` |
| Switch | `frontend/src/components/ui/switch.tsx` |
| Table | `frontend/src/components/ui/table.tsx` |
| Tabs | `frontend/src/components/ui/tabs.tsx` |
| Textarea | `frontend/src/components/ui/textarea.tsx` |
| Tooltip | `frontend/src/components/ui/tooltip.tsx` |

---

## Shared Types & Utilities

| File | Description |
|------|-------------|
| `frontend/src/lib/types.ts` | Consolidated TypeScript type definitions |
| `frontend/src/lib/api.ts` | HTTP API client with all endpoints |
| `frontend/src/lib/utils.ts` | Utility functions (cn, etc.) |
| `frontend/src/lib/telemetry.ts` | Analytics/telemetry helpers |
| `frontend/src/lib/schema.ts` | Schema manipulation utilities |
| `frontend/src/ui/labels.ts` | UI label constants |

---

## Backend API Router Structure

```
/api/v1/
├── engines/           # Engine CRUD + ComfyUI control
├── workflows/         # Pipe management
├── projects/          # Project organization
├── jobs/              # Generation execution
├── gallery/           # Image browsing
├── files/             # File operations
├── library/           # Prompt library
│   └── tags/          # Tag suggestions
├── extensions/        # Node installation
├── vlm/               # Vision language model
├── collections/       # Legacy collections
├── monitoring/        # System metrics
│   └── status/        # Status endpoints
├── models/            # Model management
└── portfolio/         # Portfolio tracking
```

---

## File Count Summary

| Category | Count |
|----------|-------|
| Backend API Endpoints | 16 modules |
| Backend Services | 7 modules |
| Backend Core Modules | 8 modules |
| Backend Models | 11 models |
| Frontend Pages | 7 pages |
| Frontend Components | 25+ components |
| Frontend UI Components | 24 components |
| Frontend Lib Files | 8 files |

---

*Document generated by analyzing repository structure, source code, and existing documentation.*
