# Diffusion Studio

A modern, local-first interface for **ComfyUI**. 

Diffusion Studio replaces the raw node graph with a user-friendly, project-based workflow management system, while keeping the full power of ComfyUI's engine under the hood.

## Features
- 🚀 **Simply Powerful**: Run complex workflows with simple, auto-generated forms.
- 🧩 **Extension Manager**: Auto-detect and install missing custom nodes with a single click.
- 🖼️ **Gallery**: Built-in image history, parameter inspection, and organization.
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
- [Development Context & Handoff](./HANDOFF_CONTEXT.md) - **Start Here for Development**
- [Roadmap](./docs/ROADMAP.md) - Future Plans

## License
MIT
