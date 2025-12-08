# Project Roadmap

**Updated:** 2025-12-08

## Phase 1: Core Foundation (COMPLETE)
- [x] Backend Setup (FastAPI, SQLite, SQLModel)
- [x] Frontend Setup (React, Vite, Shadcn)
- [x] ComfyUI Communication Layer (HTTP/WS)
- [x] Basic Job Execution (Text-to-Image)
- [x] Gallery & History
- [x] Prompt Library

## Phase 2: User Experience & Reliability (CURRENT)
- [x] **Node Installation Manager**:
    - Manage custom node dependencies directly from UI.
    - [x] Backend Fallback (Git Clone + pip install).
    - [x] Real-time Installation Logs.
- [x] **Self-Healing Validation**:
    - Auto-clear "Missing Nodes" warnings upon resolution.
- [ ] **Job Cancellation**:
    - Deep integration to interrupt ComfyUI generation.
- [ ] **Error Handling**:
    - Better UI feedback for ComfyUI disconnection.

## Phase 3: Advanced Features
- [ ] **Workflow Visualizer**:
    - Read-only graph view of the current workflow.
    - Highlight active nodes during execution.
- [ ] **Batch Processing**:
    - "Grid Search" / XYZ Plot style execution.
    - Queue management improvements.
- [ ] **Folder/Collection Management**:
    - Organize Gallery images into folders/tags.

## Phase 4: Distribution
- [ ] **Packaging**:
    - Electron wrapper for Frontend.
    - PyInstaller for Backend.
    - One-click installer (MSI/NSIS).
