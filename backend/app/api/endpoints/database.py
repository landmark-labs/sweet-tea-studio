"""
Database health and backup management endpoints.

Provides visibility into SQLite database status, backup management,
and health monitoring for Sweet Tea Studio.
"""

from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.db.sqlite_health import (
    checkpoint_wal,
    create_rolling_backup,
    quick_check_path,
    BackupResult,
)

router = APIRouter()


class DatabaseFileInfo(BaseModel):
    """Info about a single database file."""
    name: str
    path: str
    size_bytes: int
    size_mb: float
    exists: bool
    health_status: str  # "ok", "missing", or error message
    wal_size_bytes: Optional[int] = None
    shm_size_bytes: Optional[int] = None


class BackupInfo(BaseModel):
    """Info about a backup file."""
    filename: str
    path: str
    size_bytes: int
    size_mb: float
    created_at: str


class DatabaseStatusResponse(BaseModel):
    """Full database status response."""
    databases: List[DatabaseFileInfo]
    backups_dir: str
    backups_count: int
    latest_backup: Optional[BackupInfo] = None
    total_size_mb: float


class BackupCreateResponse(BaseModel):
    """Response after creating a backup."""
    success: bool
    message: str
    backup: Optional[BackupInfo] = None


def _get_file_size(path: Path) -> int:
    """Get file size in bytes, or 0 if missing."""
    try:
        return path.stat().st_size if path.exists() else 0
    except OSError:
        return 0


def _get_db_info(db_path: Path, name: str) -> DatabaseFileInfo:
    """Get info about a database file."""
    exists = db_path.exists()
    size_bytes = _get_file_size(db_path)
    
    # Check WAL and SHM files
    wal_path = Path(str(db_path) + "-wal")
    shm_path = Path(str(db_path) + "-shm")
    wal_size = _get_file_size(wal_path) if wal_path.exists() else None
    shm_size = _get_file_size(shm_path) if shm_path.exists() else None
    
    # Health check
    health_status = quick_check_path(db_path) if exists else "missing"
    
    return DatabaseFileInfo(
        name=name,
        path=str(db_path),
        size_bytes=size_bytes,
        size_mb=round(size_bytes / (1024 * 1024), 2),
        exists=exists,
        health_status=health_status,
        wal_size_bytes=wal_size,
        shm_size_bytes=shm_size,
    )


def _get_backups() -> List[BackupInfo]:
    """Get list of backup files sorted by date (newest first)."""
    backups_dir = settings.meta_dir / "backups"
    if not backups_dir.exists():
        return []
    
    backups = []
    for path in backups_dir.glob("*.db"):
        if not path.is_file():
            continue
        try:
            stat = path.stat()
            backups.append(BackupInfo(
                filename=path.name,
                path=str(path),
                size_bytes=stat.st_size,
                size_mb=round(stat.st_size / (1024 * 1024), 2),
                created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            ))
        except OSError:
            continue
    
    # Sort by creation time, newest first
    backups.sort(key=lambda b: b.created_at, reverse=True)
    return backups


@router.get("/status", response_model=DatabaseStatusResponse)
async def get_database_status():
    """
    Get comprehensive database status including health, sizes, and backup info.
    """
    databases = [
        _get_db_info(settings.database_path, "profile.db"),
        _get_db_info(settings.meta_dir / "tags.db", "tags.db"),
    ]
    
    backups = _get_backups()
    backups_dir = settings.meta_dir / "backups"
    
    total_size = sum(db.size_bytes for db in databases)
    # Include WAL sizes
    for db in databases:
        if db.wal_size_bytes:
            total_size += db.wal_size_bytes
        if db.shm_size_bytes:
            total_size += db.shm_size_bytes
    
    return DatabaseStatusResponse(
        databases=databases,
        backups_dir=str(backups_dir),
        backups_count=len(backups),
        latest_backup=backups[0] if backups else None,
        total_size_mb=round(total_size / (1024 * 1024), 2),
    )


@router.post("/backup", response_model=BackupCreateResponse)
async def create_backup(database: str = "profile.db"):
    """
    Create an immediate backup of the specified database.
    
    Args:
        database: Which database to backup ("profile.db" or "tags.db")
    """
    if database == "profile.db":
        db_path = settings.database_path
    elif database == "tags.db":
        db_path = settings.meta_dir / "tags.db"
    else:
        raise HTTPException(status_code=400, detail=f"Unknown database: {database}")
    
    if not db_path.exists():
        raise HTTPException(status_code=404, detail=f"Database not found: {database}")
    
    backups_dir = settings.meta_dir / "backups"
    
    try:
        # Checkpoint WAL first to ensure backup is complete
        checkpoint_wal(db_path)
        
        # Create backup with no minimum interval (force immediate backup)
        result = create_rolling_backup(
            db_path,
            backups_dir=backups_dir,
            keep=20,
            min_interval=timedelta(seconds=0),
        )
        
        if result.created and result.path:
            stat = result.path.stat()
            backup_info = BackupInfo(
                filename=result.path.name,
                path=str(result.path),
                size_bytes=stat.st_size,
                size_mb=round(stat.st_size / (1024 * 1024), 2),
                created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            )
            return BackupCreateResponse(
                success=True,
                message=f"Backup created: {result.path.name}",
                backup=backup_info,
            )
        else:
            return BackupCreateResponse(
                success=False,
                message=f"Backup not created: {result.reason}",
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup failed: {e}")


@router.get("/backups", response_model=List[BackupInfo])
async def list_backups():
    """
    List all available database backups.
    """
    return _get_backups()


@router.post("/checkpoint")
async def checkpoint_databases():
    """
    Force WAL checkpoint on all databases.
    
    This folds WAL changes into the main database files, which is useful
    before syncing/copying the database or if WAL files are growing large.
    """
    results = {}
    
    for name, db_path in [
        ("profile.db", settings.database_path),
        ("tags.db", settings.meta_dir / "tags.db"),
    ]:
        if not db_path.exists():
            results[name] = "missing"
            continue
        try:
            checkpoint_wal(db_path)
            results[name] = "ok"
        except Exception as e:
            results[name] = f"error: {e}"
    
    return {"checkpoints": results}
