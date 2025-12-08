from typing import Optional, Dict, Any
from datetime import datetime
from sqlmodel import Field, SQLModel, JSON

class PromptBase(SQLModel):
    workflow_id: int
    name: str # e.g. "Cyberpunk City" or auto-generated
    description: Optional[str] = None
    content_hash: Optional[str] = None # MD5 of positive+negative
    positive_text: Optional[str] = None
    negative_text: Optional[str] = None
    parameters: Dict[str, Any] = Field(default={}, sa_type=JSON)
    preview_image_path: Optional[str] = None

class Prompt(PromptBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class PromptCreate(PromptBase):
    pass

class PromptRead(PromptBase):
    id: int
    created_at: datetime
    updated_at: datetime
