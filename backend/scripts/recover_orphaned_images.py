#!/usr/bin/env python3
"""
Image Recovery Script for Sweet Tea Studio

Scans specified directories for image files that exist on disk but are NOT in the database,
then imports them as orphaned images (with job_id=-1 as a placeholder).

Usage:
    cd /opt/sweet-tea-studio/backend
    python -m scripts.recover_orphaned_images /path/to/folder1 /path/to/folder2

Or from Python:
    from scripts.recover_orphaned_images import recover_images
    recover_images(["/opt/ComfyUI/sweet_tea/myproject/transform"])
"""

import os
import sys
from pathlib import Path
from datetime import datetime

# Add parent to path so we can import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import Session, select
from app.db.engine import engine as db_engine
from app.models.image import Image

# Supported image extensions
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff'}


def get_existing_paths(session: Session) -> set:
    """Get all image paths already in the database."""
    stmt = select(Image.path)
    return {row for row in session.exec(stmt)}


def scan_folder_for_images(folder: str) -> list[Path]:
    """Recursively scan a folder for image files."""
    folder_path = Path(folder)
    if not folder_path.exists():
        print(f"Warning: Folder does not exist: {folder}")
        return []
    
    images = []
    for ext in IMAGE_EXTENSIONS:
        images.extend(folder_path.rglob(f"*{ext}"))
        images.extend(folder_path.rglob(f"*{ext.upper()}"))
    
    return list(set(images))  # De-duplicate


def recover_images(folders: list[str], dry_run: bool = False) -> dict:
    """
    Scan folders and import orphaned images into the database.
    
    Args:
        folders: List of folder paths to scan
        dry_run: If True, only report what would be imported without actually importing
        
    Returns:
        Dict with counts of found, already_exists, and imported images
    """
    results = {
        "scanned_folders": [],
        "files_found": 0,
        "already_in_db": 0,
        "imported": 0,
        "errors": [],
        "imported_files": []
    }
    
    with Session(db_engine) as session:
        existing_paths = get_existing_paths(session)
        print(f"Database contains {len(existing_paths)} existing image records")
        
        for folder in folders:
            print(f"\nScanning: {folder}")
            results["scanned_folders"].append(folder)
            
            images = scan_folder_for_images(folder)
            results["files_found"] += len(images)
            print(f"  Found {len(images)} image files")
            
            for img_path in images:
                path_str = str(img_path)
                
                # Check if already in database
                if path_str in existing_paths:
                    results["already_in_db"] += 1
                    continue
                
                # New orphaned image - import it
                if dry_run:
                    print(f"  [DRY RUN] Would import: {img_path.name}")
                    results["imported"] += 1
                    results["imported_files"].append(path_str)
                    continue
                
                try:
                    # Determine format from extension
                    ext = img_path.suffix.lower().lstrip('.')
                    if ext == 'jpeg':
                        ext = 'jpg'
                    
                    # Create Image record with job_id=-1 (orphaned marker)
                    new_image = Image(
                        job_id=-1,  # Special marker for recovered images
                        path=path_str,
                        filename=img_path.name,
                        format=ext,
                        is_kept=True,  # Mark as kept since user wanted to recover them
                        created_at=datetime.fromtimestamp(img_path.stat().st_mtime)  # Use file mod time
                    )
                    session.add(new_image)
                    results["imported"] += 1
                    results["imported_files"].append(path_str)
                    print(f"  Imported: {img_path.name}")
                    
                except Exception as e:
                    results["errors"].append({"path": path_str, "error": str(e)})
                    print(f"  Error importing {img_path.name}: {e}")
        
        if not dry_run:
            session.commit()
            print(f"\nCommitted {results['imported']} new images to database")
    
    return results


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nExample:")
        print("  python -m scripts.recover_orphaned_images /opt/ComfyUI/sweet_tea/myproject/transform")
        sys.exit(1)
    
    # Check for --dry-run flag
    dry_run = '--dry-run' in sys.argv
    folders = [arg for arg in sys.argv[1:] if not arg.startswith('--')]
    
    if dry_run:
        print("=== DRY RUN MODE - No changes will be made ===\n")
    
    results = recover_images(folders, dry_run=dry_run)
    
    print("\n" + "="*50)
    print("RECOVERY SUMMARY")
    print("="*50)
    print(f"Folders scanned: {len(results['scanned_folders'])}")
    print(f"Image files found: {results['files_found']}")
    print(f"Already in database: {results['already_in_db']}")
    print(f"Newly imported: {results['imported']}")
    if results['errors']:
        print(f"Errors: {len(results['errors'])}")
        for err in results['errors'][:5]:
            print(f"  - {err['path']}: {err['error']}")


if __name__ == "__main__":
    main()
