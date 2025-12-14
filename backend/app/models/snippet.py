"""Snippet model for persisting prompt snippets."""
from typing import Optional
from datetime import datetime
from sqlmodel import Field, SQLModel


class SnippetBase(SQLModel):
    label: str
    content: str
    color: Optional[str] = None
    sort_order: int = Field(default=0, index=True)


class Snippet(SnippetBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SnippetCreate(SnippetBase):
    pass


class SnippetUpdate(SQLModel):
    label: Optional[str] = None
    content: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None


class SnippetRead(SnippetBase):
    id: int
    created_at: datetime
    updated_at: datetime
