"""
Migration: Add soft delete columns to Image table

Run this script to add is_deleted and deleted_at columns to existing databases.
This is safe to run multiple times - it will skip if columns already exist.

Usage:
    python -m app.db.migrations.add_soft_delete_to_images
"""
import sqlite3
import os
from app.core.config import settings


def migrate():
    db_path = settings.DATABASE_PATH
    
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path} - will be created on first run")
        return
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check if columns already exist
    cursor.execute("PRAGMA table_info(image)")
    columns = {row[1] for row in cursor.fetchall()}
    
    migrations_applied = 0
    
    if 'is_deleted' not in columns:
        print("Adding is_deleted column...")
        cursor.execute("ALTER TABLE image ADD COLUMN is_deleted BOOLEAN DEFAULT 0")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_image_is_deleted ON image(is_deleted)")
        migrations_applied += 1
        print("  ✓ Added is_deleted column with index")
    else:
        print("  - is_deleted column already exists")
    
    if 'deleted_at' not in columns:
        print("Adding deleted_at column...")
        cursor.execute("ALTER TABLE image ADD COLUMN deleted_at DATETIME DEFAULT NULL")
        migrations_applied += 1
        print("  ✓ Added deleted_at column")
    else:
        print("  - deleted_at column already exists")
    
    conn.commit()
    conn.close()
    
    if migrations_applied > 0:
        print(f"\nMigration complete: {migrations_applied} column(s) added")
    else:
        print("\nNo migration needed - all columns already exist")


if __name__ == "__main__":
    migrate()
