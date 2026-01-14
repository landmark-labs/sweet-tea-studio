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
from app.models.snippet import Snippet
from app.models.app_setting import AppSetting
from app.models.canvas import Canvas
# Portfolio models for generation tracking
from app.models.portfolio import (
    ComfyWorkflow, Pipe, ModelCatalog, Run, RunModelLink, Output
)
from app.core.config import settings
from app.db.sqlite_health import ensure_sqlite_database_or_raise


def init_db():
    # Ensure directory structure exists before doing any DB checks/IO.
    settings.ensure_dirs()

    backups_dir = settings.meta_dir / "backups"
    recovery_dir = settings.meta_dir / "recovery"

    # Validate/backup/recover SQLite files before SQLAlchemy connects (connect() sets pragmas).
    ensure_sqlite_database_or_raise(
        settings.database_path,
        label=f"profile.db ({settings.database_path})",
        backups_dir=backups_dir,
        recovery_dir=recovery_dir,
    )
    ensure_sqlite_database_or_raise(
        settings.meta_dir / "tags.db",
        label=f"tags.db ({settings.meta_dir / 'tags.db'})",
        backups_dir=backups_dir,
        recovery_dir=recovery_dir,
        allow_recreate=True,  # tags.db is a cache and can be rebuilt if unrecoverable
    )

    # Create main app tables in profile.db
    SQLModel.metadata.create_all(engine)
    
    # Create tag tables in dedicated tags.db (auto-creates file if missing)
    SQLModel.metadata.create_all(tags_engine, tables=[Tag.__table__, TagSyncState.__table__])
    
    # Run migrations to add any new columns to existing databases
    from app.db.migrations.add_soft_delete_to_images import migrate as migrate_soft_delete
    migrate_soft_delete()
    
    # Add display_order column to workflow templates (must run before backfill_node_order)
    from app.db.migrations.add_display_order_to_workflows import migrate as migrate_display_order
    migrate_display_order()
    
    # Add display_order column to projects
    from app.db.migrations.add_display_order_to_projects import migrate as migrate_project_display_order
    migrate_project_display_order()
    
    # Backfill __node_order for existing workflows
    from app.db.migrations.backfill_node_order import migrate as migrate_node_order
    migrate_node_order()
    
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
        
        # Seed default starter pipes if empty
        if not session.exec(select(WorkflowTemplate)).first():
            from app.db.default_workflows import DEFAULT_T2I_WORKFLOW, DEFAULT_I2I_WORKFLOW
            
            t2i_pipe = WorkflowTemplate(
                name="sts_t2i_basic",
                description="basic text-to-image starter pipe",
                graph_json=DEFAULT_T2I_WORKFLOW["graph"],
                input_schema=DEFAULT_T2I_WORKFLOW["input_schema"],
                node_mapping=DEFAULT_T2I_WORKFLOW.get("node_mapping")
            )
            i2i_pipe = WorkflowTemplate(
                name="sts_i2i_basic",
                description="basic image-to-image starter pipe",
                graph_json=DEFAULT_I2I_WORKFLOW["graph"],
                input_schema=DEFAULT_I2I_WORKFLOW["input_schema"],
                node_mapping=DEFAULT_I2I_WORKFLOW.get("node_mapping")
            )
            
            session.add(t2i_pipe)
            session.add(i2i_pipe)
            session.commit()
            print("Seeded default starter pipes (sts_t2i_basic, sts_i2i_basic).")

