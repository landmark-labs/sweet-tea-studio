# Sweet Tea Studio - Development Context & Handoff

**Last Updated:** 2025-12-09
**Project:** Sweet Tea Studio
**Phase:** Feature Complete / Optimization & Distribution
**Version:** 0.6.0

## 1. Project Overview
Sweet Tea Studio is a local-first web interface for managing and executing Stable Diffusion workflows using **ComfyUI** as the backend execution engine. It replaces the complex node graph with user-friendly "Projects" and "Pipes" (workflow templates) that auto-generate forms.

### Core Philosophy
*   **State-Managed Wrapper**: ComfyUI is treated as a stateless calculation engine. Sweet Tea Studio manages all state (Projects, Jobs, History, Galleries).
*   **Pipe Abstraction**: We parse ComfyUI execution graphs into `Pipes` with an `input_schema` to render nice UI forms. (Note: internally called "WorkflowTemplates" in the database)
*   **Local First**: Designed to run entirely on `localhost`.

---

## 2. Architecture
*   **Frontend**: React (Vite) + TypeScript + TailwindCSS + Shadcn/UI.
    *   **State**: React Query + Local State.
    *   **Forms**: `DynamicForm.tsx` dynamically renders inputs based on the workflow schema.
    *   **Graphing**: `WorkflowGraphViewer.tsx` for topological visualization.
*   **Backend**: Python, FastAPI, Uvicorn.
    *   **Database**: SQLite (`database.db`) accessed via SQLModel.
    *   **Task Queue**: In-memory `BackgroundTasks` + Asyncio.
    *   **ComfyUI Client**: HTTP + WebSocket bridge (`app/core/comfy_client.py`).
    *   **VLM Service**: Local Transformers/vLLM integration for vision tasks (`app/services/vlm.py`).

---

## 3. Key Subsystems & Recent Features

### A. VLM & Vision Assist (NEW)
**Files:** `backend/app/services/vlm.py`, `frontend/src/features/prompt-studio/PromptStudioPage.tsx`
*   **Functionality**: Provides local image captioning and tag extraction.
*   **Implementation**: 
    *   Loads `WaitMsBeforeAsync` optimized models locally (no API calls).
    *   **Graceful Failure**: If models are missing, the UI automatically disables vision features and guides the user to run `download_models.py`.
    *   **Tagging**: Integrated with Prompt Library for "Tag -> Prompt" expansion.

### B. Node Bypass System (NEW)
**Files:** `backend/app/api/endpoints/jobs.py`, `frontend/src/pages/WorkflowLibrary.tsx`
*   **Functionality**: Allows users to selectively "Bypass" (disable) specific nodes in a workflow without deleting them.
*   **Implementation**:
    *   **Editor**: "Add Bypass" button injects a special `__bypass_NODEID` toggle into the schema.
    *   **Execution**: Backend detects these flags and sets the target node's `mode` to `4` (Muted/Bypassed) in the ComfyUI graph.
    *   **UI**: Renders as a Toggle Switch in the Configurator.

### C. Extension Manager & "Nuclear Fallback"
**Files:** `backend/app/api/endpoints/extensions.py`
*   **Functionality**: Robustly installs missing ComfyUI nodes.
*   **Logic**:
    1.  Try ComfyUI Manager API.
    2.  **Fallback**: `git clone` the repo directly -> `pip install`.
    3.  **Self-Healing**: Automatically clears "Missing Node" warnings from the DB upon successful install.

### D. Pipe Composition
**Files:** `backend/app/core/workflow_merger.py`
*   **Functionality**: Merges two independent pipes (e.g., "Txt2Img" + "Upscale") into one linear pipeline.
*   **Logic**: Intelligently re-maps IDs to avoid collisions and stitches the output of Source to the input of Target.

### E. Project Organization (NEW in 0.6.0)
**Files:** `backend/app/models/project.py`, `backend/app/api/endpoints/projects.py`, `frontend/src/pages/Projects.tsx`
*   **Functionality**: Organize generations into named projects with dedicated folders.
*   **Implementation**:
    *   Projects have id, slug, name, timestamps, and config JSON.
    *   Jobs can be associated with a project via `project_id`.
    *   Configurable `ROOT_DIR` (default: `~/.sweet-tea`) for file storage.

### F. Status Indicators (NEW in 0.6.0)
**Files:** `backend/app/api/endpoints/monitoring.py`, `frontend/src/components/StatusBar.tsx`
*   **Functionality**: Compact status bar showing system health at a glance.
*   **Implementation**:
    *   Four indicators: Engine, Queue, I/O, Models.
    *   Color-coded: green (ok), yellow (warn), red (error).
    *   Hover tooltips with detailed status.

### G. Models Manager (NEW in 0.6.0)
**Files:** `backend/app/api/endpoints/models.py`, `frontend/src/pages/Models.tsx`
*   **Functionality**: Discover installed models and download new ones.
*   **Implementation**:
    *   Scans ComfyUI model directories.
    *   Parses `.civitai.info` metadata files.
    *   Supports downloading from Hugging Face and Civitai.

### H. Portfolio Database Schema (NEW in 0.6.0)
**Files:** `backend/app/models/portfolio.py`
*   **Functionality**: Comprehensive generation tracking for future LLM querying.
*   **Models**:
    *   `ComfyWorkflow`: Stores raw ComfyUI graphs, deduplicated by hash.
    *   `Pipe`: User-facing wrappers with default params.
    *   `Run`: Each generation with metadata.
    *   `Output`: Output files with optional thumbnail blobs.
    *   `ModelCatalog`: All models used in generations.

---

## 4. Development Environment

### Backend
```powershell
cd backend
python -m venv venv
.\venv\Scripts\activate
# Install deps (including new ML libs)
pip install -r requirements.txt
# Download VLM models (Recommended)
python download_models.py
# Start Server
python -m uvicorn app.main:app --port 8000 --reload
```

### Frontend
```powershell
cd frontend
npm install
npm run dev
# Running on http://localhost:5173
```

---

## 5. Documentation Map
*   **`docs/ROADMAP.md`**: Detailed status of completed and planned features.
*   **`README.md`**: User-facing introduction.
*   **`.gemini/antigravity/brain/`**: Internal agent memory and task logs.

## 6. Known Issues / "Here be Dragons"
1.  **ComfyUI Stability**: The backend assumes ComfyUI is up. If it crashes, the backend may hang on connection.
2.  **VLM Memory**: Loading the Vision Model requires ~4GB VRAM/RAM. Ensure the user has hardware headroom.
3.  **Schema Heuristics**: `DynamicForm` guessing logic for grouping nodes ("Advanced" vs "Main") is heuristic-based and may need tuning for obscure custom nodes.
