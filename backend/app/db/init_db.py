from sqlmodel import SQLModel, Session, select
from app.db.engine import engine
# Import models so they are registered with SQLModel.metadata
from app.models.engine import Engine
from app.models.workflow import WorkflowTemplate
from app.models.job import Job
from app.models.image import Image
from app.models.prompt import Prompt
from app.models.tag import Tag

def init_db():
    SQLModel.metadata.create_all(engine)
    
    with Session(engine) as session:
        # Seed default engine if empty
        if not session.exec(select(Engine)).first():
            default_engine = Engine(
                name="Local ComfyUI",
                base_url="http://127.0.0.1:8188",
                output_dir="C:\\Users\\jkoti\\sd\\Data\\Packages\\ComfyUI\\output",
                input_dir="C:\\Users\\jkoti\\sd\\Data\\Packages\\ComfyUI\\input",
                is_active=True
            )
            session.add(default_engine)
            session.commit()
            print("Seeded default engine.")
