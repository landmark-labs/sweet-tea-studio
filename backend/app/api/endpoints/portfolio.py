from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.core.config import settings
from app.db.database import get_session
from app.models.engine import Engine
from app.services.portfolio_storage import PortfolioStorage

router = APIRouter()


@router.post("/export")
def export_database_to_comfyui(session: Session = Depends(get_session)):
    """Vacuum and export the portfolio database into ComfyUI/sweet_tea."""

    engine = session.exec(select(Engine).where(Engine.is_active == True)).first()
    if not engine:
        engine = session.exec(select(Engine).where(Engine.name == "Local ComfyUI")).first()

    if not engine or not engine.output_dir:
        raise HTTPException(status_code=400, detail="No active engine with an output directory configured")

    sweet_tea_dir = settings.get_sweet_tea_dir_from_engine_path(engine.output_dir)
    export_name = f"profile_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"
    export_path = sweet_tea_dir / export_name

    storage = PortfolioStorage()
    result_path = storage.export_database(
        export_path,
        include_manifest={"engine_id": engine.id, "engine_output_dir": engine.output_dir},
    )

    return {
        "path": str(result_path),
        "filename": result_path.name,
        "sweet_tea_dir": str(sweet_tea_dir),
    }
