from typing import Optional
from datetime import datetime
from sqlmodel import Field, SQLModel, Relationship
from typing import List

class CollectionBase(SQLModel):
    name: str = Field(index=True, unique=True)
    description: Optional[str] = None

class Collection(CollectionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    # We will define the relationship back reference in the Image model if needed,
    # or just keep it simple with the foreign key in Image.

class CollectionCreate(CollectionBase):
    pass

class CollectionRead(CollectionBase):
    id: int
    created_at: datetime
    item_count: Optional[int] = 0
