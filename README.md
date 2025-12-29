# Sweet Tea Studio

A modern, local-first interface for **ComfyUI** that turns node graphs into project-based workflows with dynamic forms, rich galleries, and system tooling.

Sweet Tea Studio replaces the raw node graph with a user-friendly Prompt Studio while keeping ComfyUI as the execution engine under the hood.

## Highlights
- Dynamic Prompt Studio with auto-generated forms, prompt constructor blocks, and undo/redo in every field.
- Workflow Library for import/export, schema editing, node bypass toggles, pipe composition, and graph visualization.
- Projects with automatic folder management, per-project galleries, and run adoption.
- Running Gallery and Image Viewer with metadata, regeneration, keep/discard, and drag-to-input.
- Prompt Library and Snippets with tags, quick panel, and reusable presets.
- Models Manager for browsing local models and downloading from Hugging Face or Civitai.
- Extension Manager with missing-node detection and ComfyUI Manager integration.
- Vision Assist (local VLM) for captions, ranked tags, and tag-to-prompt expansion.
- ComfyUI control panel with launcher, watchdog health, and status bar indicators.
- Local-first by default; all data stays on your machine.

## Prompt Studio & Gestures
- Panel layout with resizable columns for forms, explorer, and running gallery.
- Form persistence per pipe keeps in-progress drafts between template switches.
- Prompt constructor supports drag-and-drop snippet blocks and inline edits.
- Gallery cards are draggable into file inputs or external tools.
- Multi-select gallery controls with `Ctrl/Cmd/Shift` + click.

## Workflow Library & Pipes
- Import or export workflows as JSON bundles.
- Edit schema annotations, mark fields as core or advanced, and hide nodes.
- Node bypass toggles allow you to mute specific nodes without deleting them.
- Compose multiple pipes into a single workflow and visualize the graph.

## Projects & Gallery
- Project-first organization with per-project folders and configurable inputs/outputs.
- Project sidebar for quick navigation between folders and runs.
- Gallery search, filters, keep/discard, bulk delete, and cleanup.
- Image Viewer with pan/zoom, prompt metadata, and one-click regeneration.

## Models, Extensions, and Vision Assist
- Models Manager lists installed models and supports download queues.
- Extension Manager installs missing custom nodes via ComfyUI Manager or git fallback.
- Vision Assist runs locally to caption images and expand tags into prompts.

## Status & Monitoring
- Status bar indicators for engine, queue, I/O, and model health.
- Performance HUD with system metrics and engine watchdog retries.
- ComfyUI control panel for path/args configuration and launch/stop.

## Keyboard Shortcuts
- Undo / Redo: `Cmd/Ctrl + Z` and `Cmd/Ctrl + Shift + Z` in any field.
- Gallery multi-select: Hold `Ctrl/Cmd/Shift` while clicking cards.
- Drag-and-drop: Drag gallery cards to file inputs or external editors.

## Quick Start

### Prerequisites
- **ComfyUI** installed and running on default port `8188` (or configure in Settings).
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
# Optional: download VLM models for Vision Assist
python scripts/download_models.py
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
- Cannot reach ComfyUI: Confirm ComfyUI is running on `http://localhost:8188` or use the ComfyUI control panel to set the path and URL.
- WebSocket drops during generation: The client retries with exponential backoff; restart ComfyUI if failures persist.
- Images not appearing: Use the running gallery refresh and verify the backend has access to the ComfyUI output directory.
- Extension installs stalled: Open the Extension Manager dialog to check queued installs and review ComfyUI logs.
- Vision Assist disabled: Run `python scripts/download_models.py` and reload the page.

## Documentation
- [Product Documentation](./docs/PRODUCT_DOCUMENTATION.md) - Comprehensive feature and architecture reference
- [Feature Inventory](./docs/feature_inventory.md) - Generated feature index with file pointers
- [Development Handoff (v0.6.0)](./HANDOFF_CONTEXT.md) - Architecture, context, roadmap notes
- [Roadmap](./docs/ROADMAP.md) - Detailed feature status

## License
MIT
