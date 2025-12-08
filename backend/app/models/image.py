from typing import Optional, Dict, Any
from datetime import datetime
from sqlmodel import Field, SQLModel, JSON

class ImageBase(SQLModel):
    job_id: int = Field(index=True)
    path: str
    filename: str
    format: str = "png"
    thumbnail_path: Optional[str] = None
    is_kept: bool = Field(default=False)
    caption: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict, sa_type=JSON)


class Image(ImageBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class ImageCreate(ImageBase):
    pass

class ImageRead(ImageBase):
    id: int
    created_at: datetime
