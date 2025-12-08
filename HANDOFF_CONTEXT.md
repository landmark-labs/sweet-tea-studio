# Sweet Tea Studio - Development Context & Handoff

**Last Updated:** 2025-12-08
**Project:** Sweet Tea Studio
**Phase:** Feature Complete (Refinement & Extensions)

## 1. Project Overview
Sweet Tea Studio is a local-first web interface for managing and executing Stable Diffusion workflows using **ComfyUI** as the backend execution engine. It provides a user-friendly layer (projects, galleries, workflow templates) on top of the raw node graph.

### Core Philosophy
*   **State-Managed Wrapper**: ComfyUI is a stateless calculation engine. Sweet Tea Studio holds all persistent state (Projects, Jobs, History).
*   **Workflow Templates**: We abstract complex node graphs into simplified `WorkflowTemplates` with `input_schema`s that generate dynamic UI forms.
*   **No "Remote" dependency**: The system is designed to run entirely on the user's localhost.

---

## 2. Architecture
*   **Frontend**: React (Vite), TypeScript, TailwindCSS, Shadcn/UI.
    *   State: React Query + Local Component State.
    *   API Client: `src/lib/api.ts` wrapping `fetch`.
*   **Backend**: Python, FastAPI, Uvicorn.
    *   Database: SQLite (`database.db`) accessed via SQLModel.
    *   Task Queue: In-memory `asyncio` background tasks (not Celery/Redis).
    *   ComfyUI Integration: HTTP + WebSocket client (`app/core/comfy_client.py`).

---

## 3. Key Systems & Recent Changes
(See `docs/ROADMAP.md` for full status)

### A. Extensions & Node Installation (Robust)
**Files:** `backend/app/api/endpoints/extensions.py`, `backend/app/core/manager_client.py`
We integrated the **ComfyUI Manager API** with a "Nuclear Fallback":
1.  Try Standard Manager API (`/manager/queue/install`).
2.  **Fallback:** Direct `git clone` + `pip install -r requirements.txt` (using backend's venv).
3.  **Self-Healing:** Workflows with `[Missing Nodes: ...]` tags are lazy-revalidated and cleaned.

### B. Workflow Composition (NEW)
**Files:** `backend/app/api/endpoints/workflows.py`, `backend/app/core/workflow_merger.py`
Allows merging two workflows (Source + Target) into a single pipeline.
*   **Logic:** `WorkflowMerger.merge()`:
    1.  **Re-ID:** Offsets Target node IDs to prevent collisions.
    2.  **Bridge:** Identifies Source's image output and Target's `LoadImage` nodes.
    3.  **Stitch:** Replaces Target's `LoadImage` with a direct link to Source's output.
*   **Result:** A new `WorkflowTemplate` is created with a unified graph and schema.

### C. Workflow Visualization (NEW)
**Files:** `frontend/src/components/WorkflowGraphViewer.tsx`
*   **Dual Format Support:** Handles both "UI Format" (with positions) and "API Format" (execution graph).
*   **Auto-Layout:** Implements a topological stratification algorithm to layout API-format graphs automatically.

### D. Batch Processing & Cleanup
**Files:** `frontend/src/components/ImageViewer.tsx`, `backend/app/api/endpoints/jobs.py`
*   **Job Flow:** Jobs now return a *list* of images.
*   **Auto-Cleanup:** Frontend toggle sends a signal to delete "unkept" images from previous batches to save disk space.
*   **Persistent Selection:** Users can "Keep" specific images, which flags them in the DB to be preserved.

### E. Image Serving & Gallery
**Files:** `backend/app/api/endpoints/gallery.py`
*   Images are served via proxy: `/api/v1/gallery/image/path?path=...`.
*   Includes `RunningGallery` context for session history.

---

## 4. Development Environment

### Backend
```powershell
cd backend
.\venv\Scripts\activate
# Start Server with auto-reload
python -m uvicorn app.main:app --port 8000 --reload
```
*   **Database:** `backend/database.db` (Created automatically).
*   **Logs:** Check console output for FastAPI and ComfyUI Client logs.

### Frontend
```powershell
cd frontend
npm install
npm run dev
# Running on http://localhost:5173
```

---

## 5. Roadmap & Next Steps
See `docs/ROADMAP.md` for the detailed future plan.

### Immediate Priorities
1.  **Workflow Editor**: Integrate a node-based visualizer for advanced users.
2.  **Batch Processing**: Allow queuing multiple jobs with variable inputs.
3.  **Electron Packaging**: Wrap the web app + python backend into a single executable for distribution.
