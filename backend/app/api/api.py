from fastapi import APIRouter
from app.api.endpoints import (
    auth_client,
    canvases,
    database,
    engines,
    files,
    gallery,
    jobs,
    library,
    models,
    portfolio,
    projects,
    snippets,
    status,
    tea_pipes,
    vlm,
    workflows,
)

api_router = APIRouter()
api_router.include_router(engines.router, prefix="/engines", tags=["engines"])
api_router.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
api_router.include_router(workflows.router, prefix="/workflows", tags=["workflows"])
api_router.include_router(canvases.router, prefix="/canvases", tags=["canvases"])
api_router.include_router(gallery.router, prefix="/gallery", tags=["gallery"])
api_router.include_router(library.router, prefix="/library", tags=["library"])
api_router.include_router(files.router, prefix="/files", tags=["files"])
api_router.include_router(vlm.router, prefix="/vlm", tags=["vlm"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(status.router, tags=["status"])
api_router.include_router(models.router, tags=["models"])
api_router.include_router(portfolio.router, prefix="/portfolio", tags=["portfolio"])
api_router.include_router(snippets.router, prefix="/snippets", tags=["snippets"])
api_router.include_router(database.router, prefix="/database", tags=["database"])
api_router.include_router(auth_client.router, tags=["auth-client"])
api_router.include_router(tea_pipes.router, prefix="/tea-pipes", tags=["tea-pipes"])
