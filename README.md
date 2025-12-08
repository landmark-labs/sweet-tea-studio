# Diffusion Studio
**Local-First Stable Diffusion Interface**

Diffusion Studio is a modern web interface for managing and executing Stable Diffusion workflows powered by ComfyUI.

## Features
- **Visual Prompt Studio**: Configure params, select checkpoints (engines), and execute workflows.
- **Workflow Agnostic**: Backend dynamically loads inputs based on ComfyUI workflow JSON.
- **Gallery**: View, delete, and save generated images.
- **Prompt Library**: Save your favorite prompts and settings.
- **File Explorer**: Browse local input directories.
- **Real-time Progress**: WebSocket integration for generation status.

## Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+
- ComfyUI Installation (Local)

### Backend Setup
1. Navigate to `/backend`.
2. Create virtual environment: `python -m venv venv`.
3. Activate: `.\venv\Scripts\activate`.
4. Install dependencies: `pip install -r requirements.txt`.
5. Run server: `python -m uvicorn app.main:app --reload`.
   - The server runs on `http://127.0.0.1:8000`.

### Frontend Setup
1. Navigate to `/frontend`.
2. Install dependencies: `npm install`.
3. Run dev server: `npm run dev`.
4. Open `http://localhost:5173`.

## Architecture
See `handoff.md` for detailed architecture and development context.
