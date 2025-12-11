from sqlmodel import SQLModel, Session, select
from app.db.engine import engine, tags_engine
# Import models so they are registered with SQLModel.metadata
from app.models.engine import Engine
from app.models.workflow import WorkflowTemplate
from app.models.job import Job
from app.models.image import Image
from app.models.prompt import Prompt
from app.models.tag import Tag, TagSyncState
from app.models.project import Project
# Portfolio models for generation tracking
from app.models.portfolio import (
    ComfyWorkflow, Pipe, ModelCatalog, Run, RunModelLink, Output
)
from app.core.config import settings


def init_db():
    # Create main app tables in profile.db
    SQLModel.metadata.create_all(engine)
    
    # Create tag tables in dedicated tags.db (auto-creates file if missing)
    SQLModel.metadata.create_all(tags_engine, tables=[Tag.__table__, TagSyncState.__table__])
    
    # Ensure directory structure exists
    settings.ensure_dirs()
    
    with Session(engine) as session:
        # Seed default engine if empty
        if not session.exec(select(Engine)).first():
            # Use environment-configurable paths with sensible fallback detection
            output_dir = settings.COMFYUI_OUTPUT_DIR
            input_dir = settings.COMFYUI_INPUT_DIR
            
            # If paths not configured via environment, try to detect from COMFYUI_PATH
            if not output_dir or not input_dir:
                import os
                comfy_path = settings.COMFYUI_PATH
                if comfy_path and os.path.isdir(comfy_path):
                    output_dir = output_dir or os.path.join(comfy_path, "output")
                    input_dir = input_dir or os.path.join(comfy_path, "input")
                else:
                    # Last resort: use placeholders that will need to be configured
                    output_dir = output_dir or "/path/to/ComfyUI/output"
                    input_dir = input_dir or "/path/to/ComfyUI/input"
                    print("WARNING: ComfyUI paths not configured. Set SWEET_TEA_COMFYUI_OUTPUT_DIR and SWEET_TEA_COMFYUI_INPUT_DIR environment variables.")
            
            default_engine = Engine(
                name="Local ComfyUI",
                base_url=settings.COMFYUI_URL,
                output_dir=output_dir,
                input_dir=input_dir,
                is_active=True
            )
            session.add(default_engine)
            session.commit()
            print(f"Seeded default engine with output_dir={output_dir}, input_dir={input_dir}")
        
        # Seed default 'drafts' project if empty
        if not session.exec(select(Project)).first():
            drafts_project = Project(
                name="Drafts",
                slug="drafts",
                config_json={"is_default": True}
            )
            session.add(drafts_project)
            session.commit()
            print("Seeded drafts project.")

