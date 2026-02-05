"""
Migration: add archived_at column to workflowtemplate table.

Safe to run multiple times.
"""
import os
import sqlite3

from app.core.config import settings


def migrate() -> None:
    db_path = settings.database_path
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path} - will be created on first run")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        cursor.execute("PRAGMA table_info(workflowtemplate)")
        columns = {row[1] for row in cursor.fetchall()}

        if "archived_at" not in columns:
            print("Adding archived_at column to workflowtemplate...")
            cursor.execute("ALTER TABLE workflowtemplate ADD COLUMN archived_at TEXT")
            conn.commit()
            print("Added archived_at column")
        else:
            print("archived_at column already exists")
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
