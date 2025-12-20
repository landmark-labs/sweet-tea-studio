#!/usr/bin/env python3
"""
Migration: Add thumbnail_data column to image table.

Run this after deploying the updated code:
    cd /opt/sweet-tea-studio/backend
    python -m app.db.migrations.add_thumbnail_column
"""

import sqlite3
import sys
from pathlib import Path


def migrate(db_path: str = "profile.db"):
    """Add thumbnail_data column if it doesn't exist."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check if column exists
    cursor.execute("PRAGMA table_info(image)")
    columns = [row[1] for row in cursor.fetchall()]
    
    if "thumbnail_data" in columns:
        print("Column 'thumbnail_data' already exists. Nothing to do.")
        conn.close()
        return
    
    print("Adding 'thumbnail_data' column to image table...")
    cursor.execute("ALTER TABLE image ADD COLUMN thumbnail_data BLOB")
    conn.commit()
    print("Migration complete!")
    
    conn.close()


if __name__ == "__main__":
    db_path = sys.argv[1] if len(sys.argv) > 1 else "profile.db"
    if not Path(db_path).exists():
        print(f"Database not found: {db_path}")
        sys.exit(1)
    migrate(db_path)
