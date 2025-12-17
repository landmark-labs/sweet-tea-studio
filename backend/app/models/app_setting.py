"""AppSetting model for persisting app-wide configuration."""
from typing import Optional
from datetime import datetime
from sqlmodel import Field, SQLModel


class AppSetting(SQLModel, table=True):
    """Key-value store for app settings like API keys."""
    id: Optional[int] = Field(default=None, primary_key=True)
    key: str = Field(unique=True, index=True)
    value: str = ""
    updated_at: datetime = Field(default_factory=datetime.utcnow)
