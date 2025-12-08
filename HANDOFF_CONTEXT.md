# Sweet Tea Studio - Development Context & Handoff

**Last Updated:** 2025-12-08
**Project:** Sweet Tea Studio
**Phase:** Feature Complete / Optimization & Distribution
**Version:** 0.5.0

## 1. Project Overview
Sweet Tea Studio is a local-first web interface for managing and executing Stable Diffusion workflows using **ComfyUI** as the backend execution engine. It replaces the complex node graph with user-friendly "Projects" and "Workflow Templates" that auto-generate forms.

### Core Philosophy
*   **State-Managed Wrapper**: ComfyUI is treated as a stateless calculation engine. Sweet Tea Studio manages all state (Projects, Jobs, History, Galleries).
*   **Workflow Abstraction**: We parse ComfyUI execution graphs into `WorkflowTemplates` with an `input_schema` to render nice UI forms.
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
**Files:** `backend/app/services/vlm.py`, `frontend/src/pages/PromptStudio.tsx`
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

### D. Workflow Composition
**Files:** `backend/app/core/workflow_merger.py`
*   **Functionality**: Merges two independent workflows (e.g., "Txt2Img" + "Upscale") into one linear pipeline.
*   **Logic**: Intelligently re-maps IDs to avoid collisions and stitches the output of Source to the input of Target.

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
