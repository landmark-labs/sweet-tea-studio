from typing import Optional, Dict, Any, List
from sqlmodel import Field, SQLModel, JSON

class WorkflowTemplateBase(SQLModel):
    name: str
    description: Optional[str] = None
    graph_json: Dict[str, Any] = Field(sa_type=JSON)
    input_schema: Dict[str, Any] = Field(sa_type=JSON)
    node_mapping: Optional[Dict[str, Any]] = Field(default=None, sa_type=JSON)

class WorkflowTemplate(WorkflowTemplateBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

class WorkflowTemplateCreate(WorkflowTemplateBase):
    pass

class WorkflowTemplateRead(WorkflowTemplateBase):
    id: int
