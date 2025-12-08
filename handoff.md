# 📦 Sweet Tea Studio - Development Handoff (Dec 2025)

**Status:** Stable Alpha  
**Version:** 0.4.0  
**Last Updated:** Dec 8, 2025

---

## 🚀 Executive Summary

Sweet Tea Studio is a **local-first, modern interface for ComfyUI**. It abstracts the complexity of node graphs into user-friendly, auto-generated forms while keeping the full power of ComfyUI's engine under the hood.

We have just completed a major milestone: **The Prompt Constructor**. This feature allows users to build prompts dynamically using text snippets and drag-and-drop mechanics, moving beyond simple text fields.

The system is currently **stable**. Critical backend race conditions and WebSocket disconnects have been resolved.

---

## 🏗️ System Architecture

### 1. Frontend (`/frontend`)
*   **Framework:** React (Vite) + TypeScript + TailwindCSS.
*   **Core Components:**
    *   `DynamicForm.tsx`: The heart of the app. Dynamically renders UI based on ComfyUI execution graphs.
    *   `PromptConstructor.tsx`: **[NEW]** A rich text/snippet builder for prompt engineering. Features drag-and-drop and library integration.
    *   `Layout.tsx`: Main application shell with sidebar navigation.
*   **UI Library:** Radix UI primitives (via `shadcn/ui` pattern).

### 2. Backend (`/backend`)
*   **Framework:** FastAPI (Python).
*   **Database:** SQLite (via SQLModel).
*   **Key Services:**
    *   `jobs.py`: Orchestrates execution. Handles "Fast" vs "Slow" execution race conditions.
    *   `websockets.py`: **[CRITICAL]** Thread-safe broadcast manager. Bridges the gap between async WebSockets and sync background threads.
    *   `comfy_client.py`: Synchronous client for communicating with the local ComfyUI instance.

---

## ✅ Recent Achievements (The "Green Context")

The following systems are **verified working** and recently touched:

1.  **Prompt Constructor:**
    *   Fully implemented with Library integration.
    *   Smart "Add vs Edit" interaction (Single click add, Double click edit).
    *   "Ghost Text" on clear fixed.
2.  **Backend Stability:**
    *   **WebSocket Fix:** Implemented `manager.broadcast_sync` using `asyncio.run_coroutine_threadsafe`. No more "Connection Lost" errors.
    *   **Race Condition Fix:** We now connect to the WebSocket *before* queuing the prompt. This catches "0.00s" execution events.
    *   **Random Seeds:** Logic updated to detect *any* parameter with "seed" in the name. `-1` is robustly converted to a random integer.
3.  **UI Polish:**
    *   Model/Checkpoint selectors are optimized for space.
    *   Dropdowns use Radix Portals to avoid being clipped by containers.

---

## 🗺️ Roadmap & Next Steps

### Immediate Priorities (Phase 1)
- [ ] **Autocomplete:** Add standard autocomplete to the `PromptConstructor` text areas (Danbooru tags, etc.).
- [ ] **Library-Editor Interaction:** Dragging snippets *back* to the library to save them.
- [ ] **Workflow Import:** Better UI for importing raw `.json` workflows from ComfyUI.

### Mid-Term Goals (Phase 2)
- [ ] **In-Painting Support:** Dedicated UI for mask drawing.
- [ ] **Batch Manager:** Queue multiple jobs with permutations (Grid search).
- [ ] **Model Manager:** UI for downloading/installing CivitAI models directly.

---

## 🛠️ Onboarding Quick-Start

1.  **Start ComfyUI:** Ensure it's running on `localhost:8188`.
2.  **Start Backend:**
    ```bash
    cd backend
    .\venv\Scripts\activate
    python -m uvicorn app.main:app --port 8000 --reload
    ```
3.  **Start Frontend:**
    ```bash
    cd frontend
    npm run dev
    ```
4.  **Verify:** Open `localhost:5173`. Go to "Sweet Tea Studio". Try clicking a library snippet. It should add to the prompt box instantly. Run a generation with Seed `-1`. It should work without crashing.

---

## ⚠️ Known Quirks / "Here be Dragons"

*   **ComfyUI Connection:** The backend assumes ComfyUI is stable. If ComfyUI crashes, the backend might hang on `client.connect()`.
*   **Schema Parsing:** The `DynamicForm` relies on heuristics to group nodes (e.g., checking for "Loader" in the title). If a custom node has a weird name, it might end up in the "Advanced" accordion.

**Good luck, and happy coding!** 🚀
