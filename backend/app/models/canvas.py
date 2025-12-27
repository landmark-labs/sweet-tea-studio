from typing import Optional, Dict, Any
from datetime import datetime
from sqlmodel import Field, SQLModel, JSON


class CanvasBase(SQLModel):
    """Canvas snapshot metadata + payload."""
    name: str
    payload: Dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    project_id: Optional[int] = Field(default=None, index=True)
    workflow_template_id: Optional[int] = Field(default=None, index=True)


class Canvas(CanvasBase, table=True):
    """Persisted canvas snapshot."""
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CanvasCreate(CanvasBase):
    """Schema for creating a canvas."""
    pass


class CanvasUpdate(SQLModel):
    """Schema for updating a canvas."""
    name: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    project_id: Optional[int] = None
    workflow_template_id: Optional[int] = None


class CanvasRead(CanvasBase):
    """Schema for reading canvas data."""
    id: int
    created_at: datetime
    updated_at: datetime
