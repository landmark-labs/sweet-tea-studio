#!/usr/bin/env python3
"""
Check node ordering in the database.
Run from the backend directory: python check_node_order.py
"""
from pathlib import Path
from sqlmodel import Session, create_engine, select

# Auto-detect database path
DB_PATH = Path.home() / ".sweet-tea" / "meta" / "profile.db"
if not DB_PATH.exists():
    # Fallback for Docker/Vast.ai
    DB_PATH = Path("/root/.sweet-tea/meta/profile.db")

print(f"Database: {DB_PATH}")
print(f"Exists: {DB_PATH.exists()}")

if DB_PATH.exists():
    DB_URL = f"sqlite:///{DB_PATH}"
    engine = create_engine(DB_URL)
    
    from app.models.workflow import WorkflowTemplate
    
    with Session(engine) as session:
        workflows = session.exec(select(WorkflowTemplate)).all()
        print(f"\nFound {len(workflows)} workflow(s):\n")
        
        for w in workflows:
            print(f"=" * 60)
            print(f"Workflow: {w.name} (ID: {w.id})")
            
            schema = w.input_schema or {}
            node_order = schema.get("__node_order")
            
            if node_order:
                print(f"  __node_order present: YES ({len(node_order)} nodes)")
                print(f"  First 10 node IDs in order: {node_order[:10]}")
                
                # Show what class_type each ID maps to
                graph = w.graph_json or {}
                print(f"  Mapping (first 10):")
                for nid in node_order[:10]:
                    node = graph.get(nid, {})
                    ctype = node.get("class_type", "???")
                    title = node.get("_meta", {}).get("title", ctype)
                    print(f"    {nid}: {title} ({ctype})")
            else:
                print(f"  __node_order present: NO (MISSING!)")
                print(f"  This workflow needs to be re-saved in the Pipes Editor.")
            
            print()
else:
    print("Database file not found!")
