
import sys
import os
from pathlib import Path

# Add project root to path so we can import 'app'
# Assumes this script is in backend/scripts/ or project root
current = Path(__file__).resolve()
if current.parent.name == "scripts":
    project_root = current.parent.parent
else:
    project_root = current.parent

sys.path.append(str(project_root))

from sqlmodel import Session, select, func
from app.db.engine import tags_engine
from app.models.tag import Tag, TagSyncState

def check_db():
    print("Checking tags.db content...")
    try:
        with Session(tags_engine) as session:
            # Count total tags
            total = session.exec(select(func.count(Tag.id))).one()
            print(f"Total tags: {total}")
            
            # Count by source
            print("\nTags by source:")
            sources = session.exec(select(Tag.source, func.count(Tag.id)).group_by(Tag.source)).all()
            for source, count in sources:
                print(f"  - {source}: {count}")
                
            # Check sync state
            print("\nSync State:")
            states = session.exec(select(TagSyncState)).all()
            for s in states:
                print(f"  - {s.source}: {s.tag_count} tags (synced at {s.last_synced_at})")
                
    except Exception as e:
        print(f"Error reading database: {e}")

if __name__ == "__main__":
    check_db()
