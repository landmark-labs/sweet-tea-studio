import os
import sys
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT_DIR))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.api.endpoints import gallery
from app.core.error_handlers import register_gallery_error_handlers
from app.db.database import get_session


@pytest.fixture(scope="session")
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    yield engine


@pytest.fixture()
def session(engine):
    with Session(engine) as session:
        yield session
        session.rollback()
        for table in reversed(SQLModel.metadata.sorted_tables):
            session.execute(table.delete())
        session.commit()


@pytest.fixture()
def client(engine):
    app = FastAPI()
    app.include_router(gallery.router, prefix="/api/v1/gallery", tags=["gallery"])
    register_gallery_error_handlers(app)

    def override_get_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    return TestClient(app)


@pytest.fixture()
def temp_file_path():
    fd, path = tempfile.mkstemp()
    os.close(fd)
    try:
        yield path
    finally:
        if os.path.exists(path):
            os.remove(path)
