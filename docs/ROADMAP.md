# Project Roadmap

**Updated:** 2025-12-08

## Phase 1: Core Foundation (COMPLETE)
- [x] Backend Setup (FastAPI, SQLite, SQLModel)
- [x] Frontend Setup (React, Vite, Shadcn)
- [x] ComfyUI Communication Layer (HTTP/WS)
- [x] Basic Job Execution (Text-to-Image)
- [x] Gallery & History
- [x] Prompt Library

## Phase 2: User Experience & Reliability (COMPLETE)
- [x] **Node Installation Manager**:
    - Manage custom node dependencies directly from UI.
    - [x] Backend Fallback (Git Clone + pip install).
    - [x] Real-time Installation Logs.
- [x] **Self-Healing Validation**:
    - Auto-clear "Missing Nodes" warnings upon resolution.
- [x] **Batch Processing**:
    - [x] Generate batches of images.
    - [x] Auto-cleanup unkept images to save disk space.
    - [x] Group delete functionality.
- [ ] **Job Cancellation**:
    - Deep integration to interrupt ComfyUI generation.

## Phase 3: Advanced Features (IN PROGRESS)
- [x] **Workflow Visualizer**:
    - [x] Read-only graph view of the current workflow (UI & API formats).
    - [x] Auto-layout for API graphs.
- [x] **Workflow Composition**:
    - [x] Merge two workflows (Source -> Target).
    - [x] Intelligent node re-mapping and bridging.
- [ ] **Advanced Graph Editor**:
    - Full node editing capabilities within Sweet Tea Studio.
- [ ] **Folder/Collection Management**:
    - Organize Gallery images into folders/tags.
- [ ] **Folder/Collection Management**:
    - Organize Gallery images into folders/tags.

## Phase 4: Distribution
- [ ] **Packaging**:
    - Electron wrapper for Frontend.
    - PyInstaller for Backend.
    - One-click installer (MSI/NSIS).
