"""
Migration: Clear auto-kept flags on resync-imported images

Earlier builds imported orphaned media discovered during gallery resync with
is_kept=1. That prevented Gallery Cleanup from removing them and created
confusing "kept" state without any explicit user action.

This migration unsets is_kept for rows that appear to have been created by the
resync importer (job_id=-1 and/or extra_metadata contains recovered markers).

Safe to run multiple times.

Usage:
    python -m app.db.migrations.clear_auto_kept_resync_images
"""

from __future__ import annotations

import ast
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

    cursor.execute("SELECT id, job_id, extra_metadata FROM image WHERE is_kept = 1")
    rows = cursor.fetchall()

    ids_to_clear: set[int] = set()
    parsed = 0
    parse_failed = 0

    def _is_truthy(value: object) -> bool:
        if value is True:
            return True
        if value in (1, "1"):
            return True
        if isinstance(value, str) and value.strip().lower() in {"true", "yes", "y", "on"}:
            return True
        return False

    for image_id, job_id, extra_metadata in rows:
        if image_id is None:
            continue

        # Most auto-kept rows came from resync imports which used job_id=-1.
        # Clear these even if extra_metadata is missing or malformed.
        if job_id == -1:
            ids_to_clear.add(int(image_id))
            continue

        if extra_metadata is None:
            continue

        meta_raw = extra_metadata
        if isinstance(meta_raw, (bytes, bytearray)):
            meta_raw = meta_raw.decode("utf-8", errors="ignore")

        meta = None
        try:
            meta = json.loads(meta_raw) if isinstance(meta_raw, str) else meta_raw
            parsed += 1
        except Exception:
            try:
                # Some older builds stored dict repr strings; tolerate those too.
                meta = ast.literal_eval(meta_raw) if isinstance(meta_raw, str) else None
                parsed += 1
            except Exception:
                parse_failed += 1
                continue

        if not isinstance(meta, dict):
            continue

        recovered = meta.get("recovered")
        if _is_truthy(recovered) or "recovered_at" in meta or "recovered_source" in meta:
            ids_to_clear.add(int(image_id))

    if not ids_to_clear:
        print(
            "No migration needed - no auto-kept resync images found "
            f"(candidates={len(rows)}, parsed={parsed}, parse_failed={parse_failed})"
        )
        conn.close()
        return

    cursor.executemany(
        "UPDATE image SET is_kept = 0 WHERE id = ?",
        [(img_id,) for img_id in sorted(ids_to_clear)],
    )
    conn.commit()
    conn.close()
    print(
        "Cleared is_kept for "
        f"{len(ids_to_clear)} auto-kept resync image(s) "
        f"(candidates={len(rows)}, parsed={parsed}, parse_failed={parse_failed})"
    )


if __name__ == "__main__":
    migrate()
