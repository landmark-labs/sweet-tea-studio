# Sweet Tea Studio

A modern, local-first interface for **ComfyUI**.

Sweet Tea Studio replaces the raw node graph with a user-friendly, project-based workflow management system, while keeping the full power of ComfyUI's engine under the hood.

## Feature Overview
- 🚀 **Simply Powerful**: Run complex workflows with simple, auto-generated forms.
- 🎛️ **Prompt Builder UI**: Resizable panels, drag handles, and quick switches for swapping workflows and engines without losing in-progress form data.
- 🧩 **Workflow Composition**: Merge multiple workflows (e.g., Txt2Img + Upscale) into new custom pipelines.
- ✂️ **Snippet Editing**: Save prompt presets with tags, reapply them to any compatible workflow, and edit snippets inline before running.
- 👁️ **Vision Assist (VLM)**: Local image captioning and tag-based prompt expansion.
- 🕸️ **Graph Visualization**: View the underlying node graph for any workflow with a single click.
- 🔀 **Node Bypass**: Selectively disable specific nodes (like ControlNets) directly from the form.
- 🖼️ **Generation Preview**: Live progress, queued runs, and an always-on running gallery for reviewing, reloading params, or dragging outputs back into new prompts.
- 📊 **Performance HUD**: Engine health checks with retry timers, in-flight job status, and quick error surfacing.
- ⌨️ **Shortcuts**: Use standard **Undo**/**Redo** (`Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z`) in prompt fields, multi-select gallery cards with `Ctrl/Cmd/Shift` + click, and drag gallery items directly into file inputs.
- 🧩 **Extension Manager**: Auto-detect and install missing custom nodes with a smart fallback system.
- 🛠️ **Local First**: Runs entirely on your machine. No cloud dependencies.

## Prompt Builder & Gestures
- **Panel gestures**: The Prompt Studio splits into resizable panels (prompt form, file explorer, running gallery). Drag the vertical handles to favor prompt authoring or preview space.
- **Form persistence**: Workflow inputs persist per-workflow in local storage so swapping templates or engines does not blow away the current draft.
- **Drag interactions**: Gallery cards are draggable; drop their URLs into external tools or upload widgets to re-use outputs. Context menus avoid screen edges to stay visible.
- **Multi-select controls**: Hold `Ctrl/Cmd/Shift` while clicking gallery cards to keep or delete batches.

## Snippet Editing & Prompt Library
- Save any filled form as a **prompt preset** (with tags) and reload it later for the same workflow.
- Type ahead in the prompt library search box to fetch suggestions; applying a preset restores fields, previews, and prompt metadata.
- Vision Assist captions and ranked tags can be merged into your draft prompt to quickly build reusable snippets.

## Generation Preview Flow
1. **Select an engine and workflow**: Health indicators show whether ComfyUI is reachable before you launch a job.
2. **Fill the dynamic form**: Inputs mirror the workflow schema; undo/redo works in every field.
3. **Submit and monitor**: A job progress bar reports execution status. The running gallery streams new results and flags kept images.
4. **Review outputs**: Click a card to preview, right-click to regenerate with the same params, or drag it into another workflow.

## Performance HUD & Status
- **Engine health cards**: Each engine reports its last error, last check timestamp, and the seconds until the next automatic retry.
- **Job watchdogs**: The UI interrupts unreachable jobs gracefully and surfaces clear connection errors for quick recovery.
- **Install feedback**: The extension manager dialog polls progress so you know when custom nodes finish installing or fail with actionable messages.

## Keyboard Shortcuts
- **Undo / Redo**: `Cmd/Ctrl + Z` and `Cmd/Ctrl + Shift + Z` in any prompt or text field.
- **Gallery multi-select**: Hold `Ctrl/Cmd/Shift` while clicking cards to select multiple images for batch delete or reuse.
- **Drag-and-drop**: Drag gallery cards to file inputs or external editors; drag handles resize panels without breaking input focus.

## Quick Start

### Prerequisites
- **ComfyUI** installed and running on default port `8188`.
- Python 3.10+
- Node.js 18+

### Backend (API & Workers)
```bash
cd backend
python -m venv venv
# Windows
.\venv\Scripts\activate
# Linux/Mac
source venv/bin/activate

pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

### Frontend (Prompt Studio UI)
```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173` to start.

## Troubleshooting
- **Cannot reach ComfyUI**: Verify ComfyUI is running on `http://localhost:8188`. The engine health card shows the last error and when the next retry will occur.
- **WebSocket drops during generation**: The client retries with exponential backoff automatically. If failures persist, restart ComfyUI and click **Run** again.
- **Images not appearing**: Use the refresh action in the running gallery. If files are missing on disk, ensure the backend has access to the ComfyUI `output` directory.
- **Extension installs stalled**: Open the Extension Manager dialog to see queued installs. Check ComfyUI logs for permission issues and rerun the install.
- **VLM disabled**: Captioning depends on local model availability; confirm the VLM service starts without errors and reload the page to recheck health.

## Documentation
- [Development Handoff (v0.5.0)](./HANDOFF_CONTEXT.md) - **Start Here for Development** (Architecture, Context, Roadmap)
- [Roadmap](./docs/ROADMAP.md) - Detailed Feature Status

## License
MIT
