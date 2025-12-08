from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.db.init_db import init_db
from app.api.endpoints import engines, workflows, jobs, gallery, files, library, extensions, collections
from app.api.endpoints.library import start_tag_cache_refresh_background
import asyncio
from app.core.websockets import manager

app = FastAPI(title="Sweet Tea Studio Backend")

@app.on_event("startup")
def on_startup():
    init_db()
    start_tag_cache_refresh_background()
    manager.loop = asyncio.get_running_loop()

# CORS
# Set all CORS enabled origins
if settings.BACKEND_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(engines.router, prefix="/api/v1/engines", tags=["engines"])
app.include_router(workflows.router, prefix="/api/v1/workflows", tags=["workflows"])
app.include_router(jobs.router, prefix="/api/v1/jobs", tags=["jobs"])
app.include_router(gallery.router, prefix="/api/v1/gallery", tags=["gallery"])
app.include_router(files.router, prefix="/api/v1/files", tags=["files"])
app.include_router(library.router, prefix="/api/v1/library", tags=["library"])
app.include_router(extensions.router, prefix="/api/v1/extensions", tags=["extensions"])
from app.api.endpoints import vlm
app.include_router(vlm.router, prefix="/api/v1/vlm", tags=["vlm"])
app.include_router(collections.router, prefix="/api/v1/collections", tags=["collections"])

@app.get("/")
def root():
    return {"message": "Welcome to Sweet Tea Studio API"}
