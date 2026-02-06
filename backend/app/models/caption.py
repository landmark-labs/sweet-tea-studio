from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class CaptionVersionBase(SQLModel):
    image_id: Optional[int] = Field(default=None, foreign_key="image.id", index=True)
    media_path: str = Field(index=True)
    caption: str
    source: str = Field(default="manual", index=True)
    is_active: bool = Field(default=True, index=True)
    meta: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    deactivated_at: Optional[datetime] = None


class CaptionVersion(CaptionVersionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class CaptionVersionRead(CaptionVersionBase):
    id: int
    created_at: datetime
