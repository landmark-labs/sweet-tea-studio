import sqlite3
import os

# Path to the database. 
# It's usually in the root of the backend execution `backend/` or `backend/app/` depending on how it's run.
# The `engine.py` says `database.db`.
# We are running from the project root usually, but let's check both or assume backend/

DB_PATH = "database.db"

def migrate():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}. Checking current directory...")
        if os.path.exists("database.db"):
             DB_PATH_LOCAL = "database.db"
        else:
             print("Could not find database.db")
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
            
            
    except Exception as e:
        print(f"Error during migration: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
