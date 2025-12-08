# Sweet Tea Studio

A modern, local-first interface for **ComfyUI**. 

Sweet Tea Studio replaces the raw node graph with a user-friendly, project-based workflow management system, while keeping the full power of ComfyUI's engine under the hood.

## Features
- 🚀 **Simply Powerful**: Run complex workflows with simple, auto-generated forms.
- 👁️ **Vision Assist (VLM)**: Local image captioning and tag-based prompt expansion.
- 🔀 **Node Bypass**: Selectively disable specific nodes (like ControlNets) directly from the form.
- 🎨 **Workflow Composition**: Merge multiple workflows (e.g., Txt2Img + Upscale) into new custom pipelines.
- 🕸️ **Graph Visualization**: View the underlying node graph for any workflow with a single click.
- 🧩 **Extension Manager**: Auto-detect and install missing custom nodes with a smart fallback system.
- 🖼️ **Batch Generation**: Queue multiple images, auto-cleanup unkept results, and manage your gallery efficiently.
- 🛠️ **Local First**: Runs entirely on your machine. No cloud dependencies.

## Quick Start

### Prerequisites
- **ComfyUI** installed and running on default port `8188`.
- Python 3.10+
- Node.js 18+

### Backend
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

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173` to start.

## Documentation
- [Development Handoff (v0.5.0)](./HANDOFF_CONTEXT.md) - **Start Here for Development** (Architecture, Context, Roadmap)
- [Roadmap](./docs/ROADMAP.md) - Detailed Feature Status

## License
MIT
