from typing import Optional, Dict, Any
from datetime import datetime
from sqlmodel import Field, SQLModel, JSON


class ProjectBase(SQLModel):
    """Base model for projects."""
    slug: str = Field(unique=True, index=True)
    name: str
    config_json: Optional[Dict[str, Any]] = Field(default=None, sa_type=JSON)


class Project(ProjectBase, table=True):
    """Project table - organizes runs into named collections."""
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    archived_at: Optional[datetime] = None


class ProjectCreate(SQLModel):
    """Schema for creating a new project."""
    name: str
    slug: Optional[str] = None  # Auto-generated from name if not provided


class ProjectRead(ProjectBase):
    """Schema for reading project data."""
    id: int
    created_at: datetime
    updated_at: datetime
    archived_at: Optional[datetime]
