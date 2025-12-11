from pathlib import Path
from sqlmodel import create_engine
from sqlalchemy import event

from app.core.config import settings

# Ensure the metadata directory exists before initializing the engine so that
# the SQLite file can live alongside other portable assets (manifest, exports).
settings.ensure_dirs()

sqlite_path: Path = settings.database_path
sqlite_url = f"sqlite:///{sqlite_path}"

# Tags database - separate file to avoid write contention
tags_db_path: Path = settings.meta_dir / "tags.db"
tags_db_url = f"sqlite:///{tags_db_path}"

# check_same_thread=False allows background tasks and request handlers to
# share the same SQLite file while keeping a single source of truth for all
# portfolio metadata.
from sqlalchemy.pool import QueuePool, NullPool

# App Engine: Read-heavy, frequent short requests.
# Use NullPool with SQLite so connections are closed immediately and not hoarded.
engine = create_engine(
    sqlite_url, 
    echo=False, 
    connect_args={"check_same_thread": False, "timeout": 5.0},
    poolclass=NullPool
)

# Tags Engine: Dedicated database for tag cache (separate file = no lock contention)
# The background sync writes here, autocomplete reads from here.
tags_engine = create_engine(
    tags_db_url,
    echo=False,
    connect_args={"check_same_thread": False, "timeout": 5.0},
    poolclass=NullPool
)

# Ingestion Engine: For other write-heavy background tasks on main DB.
# Use a restricted pool to serialize writes and prevent starving the app.
ingestion_engine = create_engine(
    sqlite_url,
    echo=False,
    connect_args={"check_same_thread": False, "timeout": 5.0},
    poolclass=QueuePool,
    pool_size=1,
    max_overflow=0,
    pool_timeout=30
)

@event.listens_for(engine, "connect")
def set_sqlite_pragma_main(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()

@event.listens_for(tags_engine, "connect")
def set_sqlite_pragma_tags(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()

@event.listens_for(ingestion_engine, "connect")
def set_sqlite_pragma_ingestion(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()
