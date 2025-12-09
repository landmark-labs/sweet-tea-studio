from fastapi import APIRouter

from app.services.monitoring import monitor


router = APIRouter()


@router.get("/metrics")
def read_metrics():
    return monitor.get_metrics()
