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
    - [x] Backend Fallback (Git Clone + pip install).
    - [x] Real-time Installation Logs.
    - [x] Self-Healing Validation (Auto-clear missing warnings).
- [x] **Batch Processing**:
    - [x] Generate batches of images.
    - [x] Auto-cleanup unkept images.
- [x] **Backend Stability**:
    - [x] WebSocket Race Condition Fix.
    - [x] Thread-safe Broadcasting.
    - [x] Robust Job Cancellation.

## Phase 3: Advanced Features (COMPLETE)
- [x] **Workflow Visualizer**:
    - [x] Read-only graph view (UI & API formats).
    - [x] Auto-layout implementation.
- [x] **Workflow Composition**:
    - [x] Merge two workflows (Source -> Target).
- [x] **Vision Integration (VLM)**:
    - [x] Local Image Captioning service.
    - [x] Tag extraction and prompt expansion.
    - [x] Graceful failure handling (Offline mode).
- [x] **Node Bypass System**:
    - [x] "Bypass" toggle support in Configurator.
    - [x] Backend injection of ComfyUI `mode: 4`.

## Phase 4: Refinement & Distribution (NEXT)
- [ ] **Advanced Graph Editor**:
    - In-app node editing capabilities.
- [ ] **Collection Management**:
    - Organize Gallery images into folders/tags.
- [ ] **Packaging**:
    - Electron wrapper for Frontend.
    - PyInstaller for Backend.
    - One-click installer (MSI/NSIS).
