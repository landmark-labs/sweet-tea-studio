
import sys
import os
from pathlib import Path
from sqlalchemy import text
from sqlmodel import create_engine, Session
from sqlalchemy.pool import NullPool

# Define paths
DB_DIR = Path(os.path.expanduser("~")) / ".sweet-tea" / "meta"
PROFILE_DB = DB_DIR / "profile.db"
TAGS_DB = DB_DIR / "tags.db"

print(f"Profile DB: {PROFILE_DB} ({PROFILE_DB.stat().st_size / 1024:.1f} KB)")
print(f"Tags DB: {TAGS_DB} ({TAGS_DB.stat().st_size / 1024:.1f} KB)")

# Create separate engines
profile_engine = create_engine(f"sqlite:///{PROFILE_DB}", poolclass=NullPool)
tags_engine = create_engine(f"sqlite:///{TAGS_DB}", poolclass=NullPool)

print("\n--- Testing Profile DB ---")
try:
    with Session(profile_engine) as session:
        # Check journal mode
        res = session.exec(text("PRAGMA journal_mode;")).first()
        print(f"Journal Mode: {res}")
        
        # Try to count prompts
        count = session.exec(text("SELECT count(*) FROM prompt")).first()
        print(f"Prompt count: {count}")
        
        # Try to count projects
        count = session.exec(text("SELECT count(*) FROM project")).first()
        print(f"Project count: {count}")
        
    print("Profile DB: SUCCESS")
except Exception as e:
    print(f"Profile DB FAILED: {e}")

print("\n--- Testing Tags DB ---")
try:
    with Session(tags_engine) as session:
        # Check journal mode
        res = session.exec(text("PRAGMA journal_mode;")).first()
        print(f"Journal Mode: {res}")
        
        # Try to count tags
        count = session.exec(text("SELECT count(*) FROM tag")).first()
        print(f"Tag count: {count}")
        
        # Try to count tag sync states
        count = session.exec(text("SELECT count(*) FROM tagsyncstate")).first()
        print(f"TagSyncState count: {count}")
        
    print("Tags DB: SUCCESS")
except Exception as e:
    print(f"Tags DB FAILED: {e}")

print("\n--- Test Complete ---")
