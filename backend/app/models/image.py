from typing import Optional
from datetime import datetime
from sqlmodel import Field, SQLModel

class ImageBase(SQLModel):
    job_id: int = Field(index=True)
    path: str
    filename: str
    format: str = "png"
    thumbnail_path: Optional[str] = None
    is_kept: bool = Field(default=False)
    caption: Optional[str] = None


class Image(ImageBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class ImageCreate(ImageBase):
    pass

class ImageRead(ImageBase):
    id: int
    created_at: datetime
