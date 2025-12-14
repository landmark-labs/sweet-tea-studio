from typing import Optional, Dict, Any
from datetime import datetime
from sqlmodel import Field, SQLModel
from sqlalchemy import JSON, Column

class ImageBase(SQLModel):
    job_id: int = Field(index=True)
    path: str
    filename: str
    format: str = "png"
    thumbnail_path: Optional[str] = None
    is_kept: bool = Field(default=False)
    is_deleted: bool = Field(default=False, index=True)  # Soft delete flag
    deleted_at: Optional[datetime] = Field(default=None)  # When soft-deleted
    caption: Optional[str] = None
    collection_id: Optional[int] = Field(default=None, index=True)
    extra_metadata: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))


class Image(ImageBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class ImageCreate(ImageBase):
    pass

class ImageRead(ImageBase):
    id: int
    created_at: datetime
