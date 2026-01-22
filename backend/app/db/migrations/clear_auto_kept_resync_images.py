"""
Migration: Clear auto-kept flags on resync-imported images

Earlier builds imported orphaned media discovered during gallery resync with
is_kept=1. That prevented Gallery Cleanup from removing them and created
confusing "kept" state without any explicit user action.

This migration unsets is_kept for rows that appear to have been created by the
resync importer (job_id=-1 + extra_metadata.recovered=true).

Safe to run multiple times.

Usage:
    python -m app.db.migrations.clear_auto_kept_resync_images
"""

from __future__ import annotations

import json
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

    cursor.execute("PRAGMA table_info(image)")
    columns = {row[1] for row in cursor.fetchall()}

    required = {"id", "job_id", "is_kept", "extra_metadata"}
    if not required.issubset(columns):
        print("No migration needed - image table missing required columns")
        conn.close()
        return

    cursor.execute(
        "SELECT id, extra_metadata FROM image "
        "WHERE is_kept = 1 AND job_id = -1 AND extra_metadata IS NOT NULL"
    )
    rows = cursor.fetchall()

    ids_to_clear: list[int] = []
    for image_id, extra_metadata in rows:
        if image_id is None:
            continue
        try:
            if isinstance(extra_metadata, (bytes, bytearray)):
                extra_metadata = extra_metadata.decode("utf-8", errors="ignore")
            meta = json.loads(extra_metadata) if isinstance(extra_metadata, str) else extra_metadata
        except Exception:
            continue
        if isinstance(meta, dict) and meta.get("recovered") is True:
            ids_to_clear.append(int(image_id))

    if not ids_to_clear:
        print("No migration needed - no auto-kept resync images found")
        conn.close()
        return

    cursor.executemany(
        "UPDATE image SET is_kept = 0 WHERE id = ?",
        [(img_id,) for img_id in ids_to_clear],
    )
    conn.commit()
    conn.close()
    print(f"Cleared is_kept for {len(ids_to_clear)} auto-kept resync image(s)")


if __name__ == "__main__":
    migrate()

