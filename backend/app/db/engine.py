from pathlib import Path
from sqlmodel import create_engine

from app.core.config import settings

# Ensure the metadata directory exists before initializing the engine so that
# the SQLite file can live alongside other portable assets (manifest, exports).
settings.ensure_dirs()

sqlite_path: Path = settings.database_path
sqlite_url = f"sqlite:///{sqlite_path}"

# check_same_thread=False allows background tasks and request handlers to
# share the same SQLite file while keeping a single source of truth for all
# portfolio metadata.
engine = create_engine(sqlite_url, echo=True, connect_args={"check_same_thread": False})
