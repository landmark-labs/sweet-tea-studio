# Diffusion Studio - Development Context & Handoff

**Last Updated:** 2025-12-08
**Project:** Diffusion Studio
**Phase:** Feature Complete (Refinement & Extensions)

## 1. Project Overview
Diffusion Studio is a local-first web interface for managing and executing Stable Diffusion workflows using **ComfyUI** as the backend execution engine. It provides a user-friendly layer (projects, galleries, workflow templates) on top of the raw node graph.

### Core Philosophy
*   **State-Managed Wrapper**: ComfyUI is a stateless calculation engine. Diffusion Studio holds all persistent state (Projects, Jobs, History).
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

### A. Extensions & Node Installation (CRITICAL)
**Status:** COMPLETE (Robust Fallback Implemented)
**Files:** `backend/app/api/endpoints/extensions.py`, `backend/app/core/manager_client.py`

We integrated the **ComfyUI Manager API** to allow installing custom nodes directly from the UI.
*   **The Problem:** The Manager API is strict and sometimes reports success while failing to write files due to environment issues.
*   **The Fix ("Nuclear Option"):** 
    *   We first try the standard Manager API (`/manager/queue/install`).
    *   **Fallback:** If the API succeeds but the directory is missing, the backend infers the `custom_nodes` path and executes a **direct `git clone`**.
    *   **Dependency Handling:** If `requirements.txt` is found in the cloned repo, the backend automatically runs `pip install -r requirements.txt` using its own python executable.

### B. Self-Healing Workflow Validation
**Status:** COMPLETE
**Files:** `backend/app/api/endpoints/workflows.py`

Workflows store a static `description` that may contain a `[Missing Nodes: ...]` warning.
*   **The Problem:** This warning persisted even after installing the nodes because it was baked into the string.
*   **The Fix:**
    *   `read_workflow` and `read_workflows` endpoints now perform a **Lazy Re-validation**.
    *   If a workflow has the "Missing Nodes" tag, the backend checks the current ComfyUI `object_info`.
    *   If the nodes are present, the tag is **stripped from the database** and the UI updates immediately.

### C. Image Serving & Gallery
**Status:** STABLE
**Files:** `backend/app/api/endpoints/gallery.py`

*   Images are stored as absolute paths in the DB.
*   The backend provides a proxy endpoint `/api/v1/gallery/image/path?path=...` to serve these files safely to the browser.

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
