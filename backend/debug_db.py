
import sys
import os
from pathlib import Path
from sqlalchemy import text
from sqlmodel import create_engine, Session

# Define path manually to match config
DB_PATH = Path(os.path.expanduser("~")) / ".sweet-tea" / "meta" / "profile.db"
print(f"Checking DB at: {DB_PATH}")

if not DB_PATH.exists():
    print("ERROR: Database file does not exist!")
    sys.exit(1)

sqlite_url = f"sqlite:///{DB_PATH}"
engine = create_engine(sqlite_url)

try:
    with Session(engine) as session:
        print("Connected to DB.")
        
        # Check journal mode
        res = session.exec(text("PRAGMA journal_mode;")).first()
        print(f"Journal Mode: {res}")
        
        # Check integrity
        # res = session.exec(text("PRAGMA integrity_check;")).first()
        # print(f"Integrity Check: {res}")
        
        # Try to count tags
        try:
            count = session.exec(text("SELECT count(*) FROM tag")).first()
            print(f"Tag count: {count}")
        except Exception as e:
            print(f"Could not count tags (table might be named differently or empty): {e}")
            
        # Try to count installed models
        try:
            count = session.exec(text("SELECT count(*) FROM installedmodel")).first()
            print(f"InstalledModel count: {count}")
        except Exception as e:
            print(f"Could not count installed models: {e}")

    print("Database check complete: SUCCESS")

except Exception as e:
    print(f"Database check failed: {e}")
