from fastapi import APIRouter
from app.api.endpoints import engines, jobs, workflows, gallery, library, files, vlm, projects, status, models, portfolio, snippets

api_router = APIRouter()
api_router.include_router(engines.router, prefix="/engines", tags=["engines"])
api_router.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
api_router.include_router(workflows.router, prefix="/workflows", tags=["workflows"])
api_router.include_router(gallery.router, prefix="/gallery", tags=["gallery"])
api_router.include_router(library.router, prefix="/library", tags=["library"])
api_router.include_router(files.router, prefix="/files", tags=["files"])
api_router.include_router(vlm.router, prefix="/vlm", tags=["vlm"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(status.router, tags=["status"])
api_router.include_router(models.router, tags=["models"])
api_router.include_router(portfolio.router, prefix="/portfolio", tags=["portfolio"])
api_router.include_router(snippets.router, tags=["snippets"])



