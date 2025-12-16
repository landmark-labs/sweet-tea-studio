import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.endpoints import collections, engines, extensions, files, gallery, jobs, library, models, monitoring, projects, workflows, portfolio, snippets, status
from app.api.endpoints.library_tags import start_tag_cache_refresh_background
from app.core.config import settings
from app.core.error_handlers import register_gallery_error_handlers
from app.core.websockets import manager
from app.services.comfy_watchdog import watchdog
from app.db.init_db import init_db

app = FastAPI(title="Sweet Tea Studio Backend")
register_gallery_error_handlers(app)

@app.on_event("startup")
async def on_startup():
    init_db()
    # start_tag_cache_refresh_background()  # TEMPORARILY DISABLED
    manager.loop = asyncio.get_running_loop()
    await watchdog.start()


@app.on_event("shutdown")
async def on_shutdown():
    await watchdog.stop()

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
app.include_router(projects.router, prefix="/api/v1/projects", tags=["projects"])
app.include_router(jobs.router, prefix="/api/v1/jobs", tags=["jobs"])
app.include_router(gallery.router, prefix="/api/v1/gallery", tags=["gallery"])
app.include_router(files.router, prefix="/api/v1/files", tags=["files"])
app.include_router(library.router, prefix="/api/v1/library", tags=["library"])
app.include_router(extensions.router, prefix="/api/v1/extensions", tags=["extensions"])
from app.api.endpoints import vlm
app.include_router(vlm.router, prefix="/api/v1/vlm", tags=["vlm"])
app.include_router(collections.router, prefix="/api/v1/collections", tags=["collections"])
app.include_router(monitoring.router, prefix="/api/v1/monitoring", tags=["monitoring"])
app.include_router(models.router, prefix="/api/v1/models", tags=["models"])
app.include_router(portfolio.router, prefix="/api/v1/portfolio", tags=["portfolio"])
app.include_router(snippets.router, prefix="/api/v1/snippets", tags=["snippets"])
app.include_router(status.router, prefix="/api/v1", tags=["status"])

@app.get("/")
def root():
    return {"message": "Welcome to Sweet Tea Studio API"}
