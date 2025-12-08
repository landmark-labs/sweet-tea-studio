from typing import Optional
from datetime import datetime
from sqlmodel import Field, SQLModel


class TagBase(SQLModel):
    name: str = Field(index=True, unique=True)
    source: str = Field(default="custom", index=True)
    frequency: int = Field(default=0, index=True)
    description: Optional[str] = None


class Tag(TagBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TagCreate(TagBase):
    pass


class TagRead(TagBase):
    id: int
    created_at: datetime
    updated_at: datetime
