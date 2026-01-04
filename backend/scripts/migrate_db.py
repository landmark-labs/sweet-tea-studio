import sqlite3
import os
import sys

# Path to the database. 
# It's usually in the root of the backend execution `backend/` or `backend/app/` depending on how it's run.
# The `engine.py` says `database.db`.
# We are running from the project root usually, but let's check both or assume backend/
# Can also be passed as command line argument for remote deployments.

DB_PATH = sys.argv[1] if len(sys.argv) > 1 else "database.db"

def migrate():
    global DB_PATH
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}. Checking current directory...")
        if os.path.exists("database.db"):
             DB_PATH = "database.db"
        else:
             print("Could not find database.db")
             print("Usage: python migrate_db.py [path/to/database.db]")
             return

    print(f"Migrating database at {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # Check if column exists
        cursor.execute("PRAGMA table_info(image)")
        columns = [info[1] for info in cursor.fetchall()]
        
        if "is_kept" not in columns:
            print("Adding is_kept column to image table...")
            # SQLite supports ADD COLUMN
            cursor.execute("ALTER TABLE image ADD COLUMN is_kept BOOLEAN DEFAULT 0")
            conn.commit()
            print("Migration successful: Added is_kept column.")
        else:
            print("Migration skipped: is_kept column already exists.")

        if "caption" not in columns:
            print("Adding caption column to image table...")
            cursor.execute("ALTER TABLE image ADD COLUMN caption TEXT DEFAULT NULL")
            conn.commit()
            print("Migration successful: Added caption column.")

        # Check for Prompt table migrations
        cursor.execute("PRAGMA table_info(prompt)")
        prompt_columns = [info[1] for info in cursor.fetchall()]

        if "tags" not in prompt_columns:
            print("Adding tags column to prompt table...")
            cursor.execute("ALTER TABLE prompt ADD COLUMN tags JSON DEFAULT NULL")
            conn.commit()
            print("Migration successful: Added tags column.")
        
        if "tag_prompt" not in prompt_columns:
            print("Adding tag_prompt column to prompt table...")
            cursor.execute("ALTER TABLE prompt ADD COLUMN tag_prompt TEXT DEFAULT NULL")
            conn.commit()
            print("Migration successful: Added tag_prompt column.")

        # Check for Collection table migration
        # Since we use SQLModel/SQLAlchemy, creating a new table from scratch usually requires
        # calling SQLModel.metadata.create_all(engine) or running a dedicated script.
        # But for this simple migration script, we can create it manually if it doesn't exist.
        
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='collection'")
        if not cursor.fetchone():
            print("Creating collection table...")
            # We mirror the SQLModel definition: id, name, description, created_at
            cursor.execute('''
                CREATE TABLE collection (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR NOT NULL,
                    description VARCHAR,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            # Add unique index on name
            cursor.execute("CREATE UNIQUE INDEX ix_collection_name ON collection (name)")
            conn.commit()
            print("Migration successful: Created collection table.")

        if "collection_id" not in columns:
            print("Adding collection_id column to image table...")
            cursor.execute("ALTER TABLE image ADD COLUMN collection_id INTEGER DEFAULT NULL")
            conn.commit()
            print("Migration successful: Added collection_id column.")
        
        if "extra_metadata" not in columns:
            print("Adding extra_metadata column to image table...")
            cursor.execute("ALTER TABLE image ADD COLUMN extra_metadata JSON DEFAULT NULL")
            conn.commit()
            print("Migration successful: Added extra_metadata column.")

        if "width" not in columns:
            print("Adding width column to image table...")
            cursor.execute("ALTER TABLE image ADD COLUMN width INTEGER DEFAULT NULL")
            conn.commit()
            print("Migration successful: Added width column.")

        if "height" not in columns:
            print("Adding height column to image table...")
            cursor.execute("ALTER TABLE image ADD COLUMN height INTEGER DEFAULT NULL")
            conn.commit()
            print("Migration successful: Added height column.")

        if "file_exists" not in columns:
            print("Adding file_exists column to image table...")
            cursor.execute("ALTER TABLE image ADD COLUMN file_exists BOOLEAN DEFAULT NULL")
            conn.commit()
            print("Migration successful: Added file_exists column.")

        if "trash_path" not in columns:
            print("Adding trash_path column to image table...")
            cursor.execute("ALTER TABLE image ADD COLUMN trash_path TEXT DEFAULT NULL")
            conn.commit()
            print("Migration successful: Added trash_path column.")

        # Add indexes to speed up gallery ordering and filtering.
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_image_created_at ON image (created_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_image_job_id ON image (job_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_job_project_id ON job (project_id)")
        conn.commit()

        # Create run_execution_stats table for execution telemetry
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='run_execution_stats'")
        if not cursor.fetchone():
            print("Creating run_execution_stats table...")
            cursor.execute('''
                CREATE TABLE run_execution_stats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id INTEGER NOT NULL,
                    total_duration_ms INTEGER,
                    queue_wait_ms INTEGER,
                    peak_vram_mb REAL,
                    peak_ram_mb REAL,
                    vram_before_mb REAL,
                    vram_after_mb REAL,
                    ram_before_mb REAL,
                    ram_after_mb REAL,
                    gpu_name VARCHAR,
                    cuda_version VARCHAR,
                    torch_version VARCHAR,
                    device_count INTEGER,
                    offload_detected BOOLEAN,
                    raw_system_stats TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (job_id) REFERENCES job(id)
                )
            ''')
            cursor.execute("CREATE INDEX ix_run_execution_stats_job_id ON run_execution_stats (job_id)")
            conn.commit()
            print("Migration successful: Created run_execution_stats table.")

        # Create run_node_timings table for per-node execution timing
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='run_node_timings'")
        if not cursor.fetchone():
            print("Creating run_node_timings table...")
            cursor.execute('''
                CREATE TABLE run_node_timings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id INTEGER NOT NULL,
                    node_id VARCHAR NOT NULL,
                    node_type VARCHAR,
                    start_offset_ms INTEGER,
                    duration_ms INTEGER,
                    execution_order INTEGER,
                    from_cache BOOLEAN DEFAULT 0,
                    FOREIGN KEY (job_id) REFERENCES job(id)
                )
            ''')
            cursor.execute("CREATE INDEX ix_run_node_timings_job_id ON run_node_timings (job_id)")
            conn.commit()
            print("Migration successful: Created run_node_timings table.")

        # Create FTS table for gallery search.
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='gallery_fts'")
        if not cursor.fetchone():
            print("Creating gallery_fts table...")
            cursor.execute(
                "CREATE VIRTUAL TABLE gallery_fts USING fts5(search_text, image_id UNINDEXED)"
            )
            conn.commit()
            print("Migration successful: Created gallery_fts table.")

        # Backfill FTS from existing data.
        print("Backfilling gallery_fts from existing images...")
        try:
            cursor.execute(
                """
                INSERT OR REPLACE INTO gallery_fts(rowid, image_id, search_text)
                SELECT
                    image.id,
                    image.id,
                    lower(
                        coalesce(json_extract(job.input_params, '$.prompt'), '') || ' ' ||
                        coalesce(json_extract(job.input_params, '$.negative_prompt'), '') || ' ' ||
                        coalesce(prompt.positive_text, '') || ' ' ||
                        coalesce(prompt.negative_text, '') || ' ' ||
                        coalesce(image.caption, '') || ' ' ||
                        coalesce(prompt.tags, '')
                    )
                FROM image
                LEFT JOIN job ON image.job_id = job.id
                LEFT JOIN prompt ON job.prompt_id = prompt.id
                WHERE image.is_deleted = 0
                """
            )
        except Exception as e:
            print(f"FTS backfill with json_extract failed ({e}); falling back to raw params.")
            cursor.execute(
                """
                INSERT OR REPLACE INTO gallery_fts(rowid, image_id, search_text)
                SELECT
                    image.id,
                    image.id,
                    lower(
                        coalesce(job.input_params, '') || ' ' ||
                        coalesce(prompt.positive_text, '') || ' ' ||
                        coalesce(prompt.negative_text, '') || ' ' ||
                        coalesce(image.caption, '') || ' ' ||
                        coalesce(prompt.tags, '')
                    )
                FROM image
                LEFT JOIN job ON image.job_id = job.id
                LEFT JOIN prompt ON job.prompt_id = prompt.id
                WHERE image.is_deleted = 0
                """
            )
        conn.commit()
            
            
    except Exception as e:
        print(f"Error during migration: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
