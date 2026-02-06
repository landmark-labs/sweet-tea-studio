import json
from pathlib import Path

from sqlmodel import SQLModel, Session, select
from app.db.engine import engine, tags_engine
# Import models so they are registered with SQLModel.metadata
from app.models.engine import Engine
from app.models.workflow import WorkflowTemplate
from app.models.job import Job
from app.models.image import Image
from app.models.prompt import Prompt
from app.models.caption import CaptionVersion
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

STARTUP_PIPE_EXPORT_DIR = Path(__file__).resolve().parent / "starter_pipes"
STARTUP_PIPE_EXPORTS = [
    STARTUP_PIPE_EXPORT_DIR / "sts_t2i_basic_pipe.json",
    STARTUP_PIPE_EXPORT_DIR / "sts_i2i_resample.json",
    STARTUP_PIPE_EXPORT_DIR / "sts_inpainter_pipe.json",
]


def _build_workflow_from_startup_bundle(path: Path, display_order: int) -> WorkflowTemplate | None:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"Failed to parse startup pipe {path}: {exc}")
        return None

    if not isinstance(raw, dict):
        return None

    graph_json = None
    input_schema = {}
    node_mapping = None
    name = path.stem
    description = "seeded starter pipe"

    metadata = raw.get("_sweet_tea")
    if isinstance(metadata, dict):
        maybe_graph = raw.get("workflow")
        if not isinstance(maybe_graph, dict):
            return None
        graph_json = maybe_graph

        meta_name = metadata.get("name")
        if isinstance(meta_name, str) and meta_name.strip():
            name = meta_name.strip()

        meta_description = metadata.get("description")
        if isinstance(meta_description, str) and meta_description.strip():
            description = meta_description.strip()

        meta_schema = metadata.get("input_schema")
        if isinstance(meta_schema, dict):
            input_schema = meta_schema

        meta_mapping = metadata.get("node_mapping")
        if isinstance(meta_mapping, dict):
            node_mapping = meta_mapping
    else:
        if "nodes" in raw and isinstance(raw.get("nodes"), list):
            return None
        graph_json = raw

    if not isinstance(graph_json, dict) or not graph_json:
        return None

    return WorkflowTemplate(
        name=name[:255],
        description=description[:500] if description else None,
        graph_json=graph_json,
        input_schema=input_schema if isinstance(input_schema, dict) else {},
        node_mapping=node_mapping if isinstance(node_mapping, dict) else None,
        display_order=display_order,
    )


def _seed_startup_pipes(session: Session) -> int:
    seeded = 0
    seen_names: set[str] = set()

    for path in STARTUP_PIPE_EXPORTS:
        if not path.exists():
            continue

        workflow = _build_workflow_from_startup_bundle(path, display_order=seeded)
        if workflow is None:
            continue

        base_name = workflow.name
        suffix = 2
        while workflow.name.lower() in seen_names:
            workflow.name = f"{base_name}_{suffix}"
            suffix += 1

        seen_names.add(workflow.name.lower())
        session.add(workflow)
        seeded += 1

    if seeded > 0:
        session.commit()

    return seeded


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
        portable_snapshot_path=settings.portable_db_path if settings.PORTABLE_DB_ENABLED else None,
    )
    ensure_sqlite_database_or_raise(
        settings.meta_dir / "tags.db",
        label=f"tags.db ({settings.meta_dir / 'tags.db'})",
        backups_dir=backups_dir,
        recovery_dir=recovery_dir,
        allow_recreate=True,  # tags.db is a cache and can be rebuilt if unrecoverable
        backup_mode="overwrite",
        backup_name="tags.backup.db",
    )

    # Create main app tables in profile.db
    SQLModel.metadata.create_all(engine)
    
    # Create tag tables in dedicated tags.db (auto-creates file if missing)
    SQLModel.metadata.create_all(tags_engine, tables=[Tag.__table__, TagSyncState.__table__])
    
    # Run migrations to add any new columns to existing databases
    from app.db.migrations.add_soft_delete_to_images import migrate as migrate_soft_delete
    migrate_soft_delete()

    # Data cleanup: older resync logic auto-marked recovered images as kept
    from app.db.migrations.clear_auto_kept_resync_images import migrate as migrate_clear_auto_kept_resync_images
    migrate_clear_auto_kept_resync_images()
    
    # Add display_order column to workflow templates (must run before backfill_node_order)
    from app.db.migrations.add_display_order_to_workflows import migrate as migrate_display_order
    migrate_display_order()

    # Add archived_at column to workflow templates
    from app.db.migrations.add_archived_at_to_workflows import migrate as migrate_workflow_archive
    migrate_workflow_archive()
    
    # Add display_order column to projects
    from app.db.migrations.add_display_order_to_projects import migrate as migrate_project_display_order
    migrate_project_display_order()
    
    # Add cached stats columns to projects (image_count, last_activity)
    from app.db.migrations.add_cached_stats_to_projects import migrate as migrate_cached_stats
    migrate_cached_stats()

    # Add caption_versions table for caption history/versioning.
    from app.db.migrations.create_caption_versions_table import migrate as migrate_caption_versions
    migrate_caption_versions()
    
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
            seeded_startup_count = _seed_startup_pipes(session)
            if seeded_startup_count > 0:
                print(f"Seeded {seeded_startup_count} starter pipes from bundled exports.")
            else:
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
