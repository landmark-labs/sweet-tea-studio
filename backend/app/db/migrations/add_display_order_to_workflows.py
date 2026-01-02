"""
Migration: Add display_order column to WorkflowTemplate table

Run this script to add display_order column to existing databases.
This is safe to run multiple times - it will skip if column already exists.

Usage:
    python -m app.db.migrations.add_display_order_to_workflows
"""
import sqlite3
import os
from app.core.config import settings


def migrate():
    db_path = settings.database_path
    
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path} - will be created on first run")
        return
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check if columns already exist
    cursor.execute("PRAGMA table_info(workflowtemplate)")
    columns = {row[1] for row in cursor.fetchall()}
    
    migrations_applied = 0
    
    if 'display_order' not in columns:
        print("Adding display_order column to workflowtemplate...")
        cursor.execute("ALTER TABLE workflowtemplate ADD COLUMN display_order INTEGER DEFAULT 0")
        migrations_applied += 1
        print("  ✓ Added display_order column")
    else:
        print("  - display_order column already exists")
    
    conn.commit()
    conn.close()
    
    if migrations_applied > 0:
        print(f"\nMigration complete: {migrations_applied} column(s) added")
    else:
        print("\nNo migration needed - display_order column already exists")


if __name__ == "__main__":
    migrate()
