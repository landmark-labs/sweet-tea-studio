from typing import Optional, List
from datetime import datetime
from sqlmodel import Field, SQLModel, JSON

class ImageBase(SQLModel):
    job_id: int = Field(index=True)
    path: str
    filename: str
    format: str = "png"
    thumbnail_path: Optional[str] = None
    caption: Optional[str] = None
    tags: Optional[List[str]] = Field(default=None, sa_type=JSON)

class Image(ImageBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class ImageCreate(ImageBase):
    pass

class ImageRead(ImageBase):
    id: int
    created_at: datetime
