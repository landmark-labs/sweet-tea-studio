"""
Migration: Backfill __node_order for existing WorkflowTemplate records.

This migration runs on startup and ensures all workflows have a valid
__node_order in their input_schema, which is required for correct
parameter ordering in the Prompt Studio.
"""

from sqlmodel import Session, select
from app.db.engine import engine
from app.models.workflow import WorkflowTemplate


def migrate():
    """Backfill __node_order for workflows missing it."""
    with Session(engine) as session:
        workflows = session.exec(select(WorkflowTemplate)).all()
        updated_count = 0
        
        for w in workflows:
            schema = w.input_schema or {}
            
            # Skip if already has __node_order
            if schema.get("__node_order"):
                continue
            
            # Generate order from graph_json
            graph = w.graph_json or {}
            if not graph:
                continue
            
            # Sort node IDs numerically
            node_ids = sorted(
                graph.keys(),
                key=lambda x: int(x) if str(x).isdigit() else x
            )
            
            # Update schema with new order
            schema["__node_order"] = [str(nid) for nid in node_ids]
            w.input_schema = schema
            
            session.add(w)
            updated_count += 1
        
        if updated_count > 0:
            session.commit()
            print(f"[Migration] Backfilled __node_order for {updated_count} workflow(s).")
        else:
            print("[Migration] All workflows already have __node_order.")


if __name__ == "__main__":
    migrate()
