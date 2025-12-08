# Handoff & Context Document
**Date:** 2025-12-08
**Project:** Diffusion Studio

## Project Overview
Diffusion Studio is a local-first web interface for managing and executing Stable Diffusion workflows using ComfyUI as the backend engine. It features a React frontend (Vite + Tailwind) and a FastAPI backend (SQLite + SQLAlchemy).

## Architecture
- **Frontend**: React, TypeScript, Vite, TailwindCSS, Shadcn/UI.
  - **State**: Local component state + `api.ts` client.
  - **Routing**: React Router (implied structure).
  - **Key Pages**:
    - `PromptStudio` (`/`): Main generation interface. Configures engine/workflow, inputs params, runs jobs via WebSocket, displays results.
    - `Gallery` (`/gallery`): Grid view of all generated images.
    - `PromptLibrary` (`/library`): Management of saved prompts/presets.
- **Backend**: Python, FastAPI, Uvicorn.
  - **Database**: SQLite (`database.db`) using SQLModel/SQLAlchemy.
  - **Engine**: Wraps ComfyUI execution. `jobs.py` handles execution logic.
  - **API**: REST endpoints for Engines, Workflows, Jobs, Gallery, Library, Files.
  - **WebSocket**: Real-time job progress streaming.

## Current State
- **Feature Complete**:
  - Image Generation (Text/Image inputs).
  - Gallery with "Recent" sidebar and main grid.
  - Prompt Library (Save/Load/Delete).
  - File Explorer for input selection.
  - WebSocket progress streaming.
  - Image serving (Local file proxy).

- **Recent Fixes**:
  - **Image Serving**: Fixed 422 routing conflict in `gallery.py`. Fixed `PromptLibrary` and `RunningGallery` to use relative URLs.
  - **UI Interaction**: Refactored `RunningGallery` in `PromptStudio` to update the main preview pane instead of opening a lightbox.
  - **Database**: Restored `files.py` and `database.py`.

## Critical Context for Next Developer
1.  **Image Paths**: The application stores *absolute local paths* in the database. The frontend requests these via `/api/v1/gallery/image/path?path=...`.
    - **Note**: The backend `serve_image_by_path` endpoint is essential for this.
    - **Risk**: Moving the project/artifacts requires database path updates.
2.  **Proxy**: `vite.config.ts` proxies `/api` to `http://127.0.0.1:8000`. ALWAYS use `/api/...` in frontend code, never absolute localhost URLs.
3.  **ComfyUI Integration**: The backend assumes a ComfyUI installation exists. It communicates via HTTP to ComfyUI.
    - **Seed Data**: `seed_data.py` (or similar logic in `main.py`) initializes Engines/Workflows.

## Git / Version Control
- **Branch**: `main` (or current active).
- **Ignored**: `venv`, `node_modules`, `__pycache__`, `*.db` (check `.gitignore`).

## Next Steps / Roadmap
1.  **Refinement**:
    - Improve error handling for failed ComfyUI connections.
    - Add "Cancel Job" deeper integration (terminate ComfyUI execution).
2.  **Features**:
    - Workflow Editor (Node-based editor integration?).
    - Batch processing.
    - Folder management in Gallery.
3.  **Deployment**:
    - Package as a single executable (Electron or PyInstaller)?

## Environment Setup
### Backend
```bash
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```
