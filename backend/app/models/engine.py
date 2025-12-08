from typing import Optional
from sqlmodel import Field, SQLModel

class EngineBase(SQLModel):
    name: str = Field(index=True)
    base_url: str
    output_dir: str = Field(description="Directory where ComfyUI saves images")
    input_dir: str = Field(description="Directory where ComfyUI looks for input images")
    auth_token: Optional[str] = None
    max_concurrent_jobs: int = 1
    allow_filesystem_delete: bool = False
    is_active: bool = True

class Engine(EngineBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

class EngineCreate(EngineBase):
    pass

class EngineRead(EngineBase):
    id: int

class EngineUpdate(SQLModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    output_dir: Optional[str] = None
    input_dir: Optional[str] = None
    auth_token: Optional[str] = None
    max_concurrent_jobs: Optional[int] = None
    allow_filesystem_delete: Optional[bool] = None
    is_active: Optional[bool] = None
