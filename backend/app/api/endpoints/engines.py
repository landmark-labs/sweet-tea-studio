from datetime import datetime
import time
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.db.engine import engine as db_engine
from app.models.engine import Engine, EngineCreate, EngineRead, EngineUpdate
from app.services.comfy_watchdog import watchdog

router = APIRouter()


class EngineHealth(BaseModel):
    engine_id: int
    engine_name: Optional[str]
    healthy: bool
    last_error: Optional[str]
    last_checked_at: Optional[datetime]
    next_check_in: int

@router.post("/", response_model=EngineRead)
def create_engine(engine_in: EngineCreate):
    with Session(db_engine) as session:
        db_obj = Engine.from_orm(engine_in)
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

@router.get("/", response_model=List[EngineRead])
def read_engines(skip: int = 0, limit: int = 100):
    with Session(db_engine) as session:
        statement = select(Engine).offset(skip).limit(limit)
        results = session.exec(statement).all()
        return results

@router.get("/health", response_model=List[EngineHealth])
def read_engine_health():
    with Session(db_engine) as session:
        engines = session.exec(select(Engine).where(Engine.is_active == True)).all()

    results: List[EngineHealth] = []
    for engine in engines:
        state = watchdog.state.get(engine.id)
        if not state:
            state = watchdog._check_engine(engine)

        last_checked_at = (
            datetime.fromtimestamp(state.last_checked_wall) if state.last_checked_wall else None
        )
        results.append(
            EngineHealth(
                engine_id=engine.id,
                engine_name=engine.name,
                healthy=state.healthy,
                last_error=state.last_error,
                last_checked_at=last_checked_at,
                next_check_in=max(int(state.next_check - time.monotonic()), 0),
            )
        )

    return results


@router.get("/{engine_id}", response_model=EngineRead)
def read_engine(engine_id: int):
    with Session(db_engine) as session:
        engine = session.get(Engine, engine_id)
        if not engine:
            raise HTTPException(status_code=404, detail="Engine not found")
        return engine
