"""
Migration: Create caption_version table for caption history.

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

    # Guard: table already exists.
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='captionversion' LIMIT 1"
    )
    exists = cursor.fetchone() is not None
    if exists:
        print("  - captionversion table already exists")
        conn.close()
        return

    print("Creating captionversion table...")
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS captionversion (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id INTEGER,
            media_path TEXT NOT NULL,
            caption TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'manual',
            is_active BOOLEAN NOT NULL DEFAULT 1,
            meta JSON,
            deactivated_at DATETIME,
            created_at DATETIME NOT NULL,
            FOREIGN KEY(image_id) REFERENCES image(id)
        )
        """
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS ix_captionversion_image_id ON captionversion(image_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS ix_captionversion_media_path ON captionversion(media_path)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS ix_captionversion_source ON captionversion(source)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS ix_captionversion_is_active ON captionversion(is_active)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS ix_captionversion_created_at ON captionversion(created_at)"
    )

    conn.commit()
    conn.close()
    print("  ✓ Created captionversion table")


if __name__ == "__main__":
    migrate()
