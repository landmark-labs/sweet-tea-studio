import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.endpoints import (
    auth_client,
    canvases,
    collections,
    engines,
    extensions,
    files,
    gallery,
    jobs,
    library,
    models,
    monitoring,
    portfolio,
    projects,
    snippets,
    tea_pipes,
    workflows,
)
from app.api.endpoints.library_tags import start_tag_cache_refresh_background
from app.core.config import settings
from app.core.error_handlers import register_gallery_error_handlers
from app.core.websockets import manager
from app.core.version import get_git_sha_short
from app.services.comfy_watchdog import watchdog
from app.services.comfy_launcher import comfy_launcher
from app.core.comfy_client import ComfyConnectionError
from fastapi.responses import JSONResponse
from app.db.init_db import init_db

app = FastAPI(title="Sweet Tea Studio Backend")
register_gallery_error_handlers(app)

@app.exception_handler(ComfyConnectionError)
async def comfy_connection_error_handler(request, exc):
    return JSONResponse(
        status_code=503,
        content={"detail": str(exc)},
    )

@app.on_event("startup")
async def on_startup():
    init_db()
    from app.db.portable_snapshot import start_portable_snapshot_service
    start_portable_snapshot_service()
    start_tag_cache_refresh_background()  # Populate tags.db for autocomplete
    manager.loop = asyncio.get_running_loop()
    await watchdog.start()
    
    # Adopt externally-started ComfyUI for log visibility
    if comfy_launcher.is_externally_running():
        print("[Startup] Detected externally-running ComfyUI, adopting for log capture...")
        result = await comfy_launcher.adopt()
        if result.get("adopted"):
            print(f"[Startup] {result.get('message')}")
        else:
            print(f"[Startup] Adoption failed: {result.get('error', result.get('message'))}")
    else:
        # Check if we should auto-start
        config = comfy_launcher.get_config()
        if config.should_auto_start:
            print("[Startup] Auto-starting ComfyUI based on previous session...")
            asyncio.create_task(comfy_launcher.launch())

@app.on_event("shutdown")
async def on_shutdown():
    try:
        from app.db.portable_snapshot import stop_portable_snapshot_service
        stop_portable_snapshot_service()
    except Exception as exc:
        print(f"[Shutdown] Portable snapshot shutdown skipped: {exc}")

    # 1. Dispose SQLAlchemy engines to release their locks on the files
    try:
        from app.db.engine import dispose_all_engines
        dispose_all_engines()
    except Exception as exc:
        print(f"[Shutdown] Engine disposal failed: {exc}")

    # 2. Clean up WAL files so backups/copies are single-file consistent.
    # We use remove_wal (journal_mode=DELETE) to force the merge and deletion of -wal files.
    try:
        from app.db.sqlite_health import remove_wal

        remove_wal(settings.database_path)
        remove_wal(settings.meta_dir / "tags.db")
    except Exception as exc:
        print(f"[Shutdown] SQLite WAL cleanup skipped: {exc}")

    await watchdog.stop()
    
    print("[Shutdown] Stopping ComfyUI...")
    await comfy_launcher.stop(preserve_intent=True)

# Helps confirm which backend build is running (especially in container deployments).
@app.middleware("http")
async def _add_build_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Sweet-Tea-Version"] = settings.APP_VERSION
    sha = get_git_sha_short()
    if sha:
        response.headers["X-Sweet-Tea-Git-Sha"] = sha
    return response

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
app.include_router(canvases.router, prefix="/api/v1/canvases", tags=["canvases"])
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
app.include_router(tea_pipes.router, prefix="/api/v1", tags=["tea-pipes"])
app.include_router(auth_client.router, prefix="/api/v1", tags=["auth-client"])
from app.api.endpoints import settings as settings_endpoints
app.include_router(settings_endpoints.router, prefix="/api/v1", tags=["settings"])
from app.api.endpoints import database
app.include_router(database.router, prefix="/api/v1/database", tags=["database"])

@app.get("/")
def root():
    return {"message": "Welcome to Sweet Tea Studio API"}
