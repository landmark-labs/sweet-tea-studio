"""
Migration: Add cached_image_count and cached_last_activity columns to Project table

These columns cache image statistics for fast project listing.
This is safe to run multiple times - it will skip if columns already exist.

Usage:
    python -m app.db.migrations.add_cached_stats_to_projects
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
    cursor.execute("PRAGMA table_info(project)")
    columns = {row[1] for row in cursor.fetchall()}
    
    migrations_applied = 0
    
    if 'cached_image_count' not in columns:
        print("Adding cached_image_count column to project...")
        cursor.execute("ALTER TABLE project ADD COLUMN cached_image_count INTEGER DEFAULT 0")
        migrations_applied += 1
        print("  ✓ Added cached_image_count column")
    else:
        print("  - cached_image_count column already exists")
    
    if 'cached_last_activity' not in columns:
        print("Adding cached_last_activity column to project...")
        cursor.execute("ALTER TABLE project ADD COLUMN cached_last_activity DATETIME")
        migrations_applied += 1
        print("  ✓ Added cached_last_activity column")
    else:
        print("  - cached_last_activity column already exists")
    
    conn.commit()
    conn.close()
    
    if migrations_applied > 0:
        print(f"\nMigration complete: {migrations_applied} column(s) added")
    else:
        print("\nNo migration needed - cached stats columns already exist")


if __name__ == "__main__":
    migrate()
