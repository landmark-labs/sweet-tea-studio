from typing import Optional, Dict, Any
from datetime import datetime
from sqlmodel import Field, SQLModel, JSON

class JobBase(SQLModel):
    engine_id: int
    workflow_template_id: int
    status: str = "queued"  # queued, running, completed, failed
    input_params: Dict[str, Any] = Field(sa_type=JSON)
    prompt_id: Optional[int] = None  # Link to canonical prompt
    comfy_prompt_id: Optional[str] = None
    title: Optional[str] = None
    # Project association - defaults to drafts project (id=1)
    project_id: Optional[int] = Field(default=None, index=True)
    # Directory paths relative to project folder
    output_dir: Optional[str] = None
    input_dir: Optional[str] = None
    mask_dir: Optional[str] = None

class Job(JobBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None

class JobCreate(JobBase):
    pass

class JobRead(JobBase):
    id: int
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    error: Optional[str] = None
