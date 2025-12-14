#!/usr/bin/env python3
"""
Re-embed metadata into existing images.

This script reads the extra_metadata from the database for each image
and writes it to the image file's EXIF XPComment field so it's visible
in Windows Explorer's file properties.

Usage:
    python scripts/reembed_metadata.py [--dry-run] [--project SLUG]
"""

import sys
import json
import argparse
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import Session, select
from app.db.engine import engine
from app.models.image import Image
from app.models.project import Project
from app.models.job import Job
from app.core.config import settings


def embed_metadata_to_file(image_path: str, metadata: dict) -> bool:
    """Embed metadata into image file's EXIF XPComment field."""
    try:
        from PIL import Image as PILImage
        
        # Resolve relative paths against ROOT_DIR
        path = Path(image_path)
        if not path.is_absolute():
            path = settings.ROOT_DIR / path
        
        if not path.exists():
            print(f"  File not found: {path}")
            return False
        
        # Build provenance JSON from stored metadata
        provenance = {
            "positive_prompt": metadata.get("active_prompt", {}).get("positive_text", ""),
            "negative_prompt": metadata.get("active_prompt", {}).get("negative_text", ""),
            "generation_params": metadata.get("generation_params", {}),
            "prompt_history": metadata.get("prompt_history", []),
        }
        provenance_json = json.dumps(provenance, ensure_ascii=False)
        
        with PILImage.open(path) as img:
            fmt = (img.format or "").upper()
            if fmt not in ("JPEG", "JPG"):
                print(f"  Skipping non-JPEG: {path.name}")
                return False
            
            # Try piexif first, fall back to Pillow native EXIF
            try:
                import piexif
                # Check if piexif.helper exists (some versions don't have it)
                if not hasattr(piexif, 'helper'):
                    raise AttributeError("piexif.helper not available")
                
                exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}}
                user_comment = piexif.helper.UserComment.dump(provenance_json, encoding="unicode")
                exif_dict["Exif"][piexif.ExifIFD.UserComment] = user_comment
                exif_dict["0th"][piexif.ImageIFD.ImageDescription] = provenance_json.encode("utf-8")
                
                # XPComment (Windows Comments field) - UTF-16LE with null terminator
                xp_comment_bytes = provenance_json.encode("utf-16le") + b"\x00\x00"
                exif_dict["0th"][0x9C9C] = xp_comment_bytes
                
                exif_bytes = piexif.dump(exif_dict)
                img.save(str(path), "JPEG", quality=95, exif=exif_bytes)
                
            except (ImportError, AttributeError):
                # piexif not available or incompatible - use Pillow's native EXIF support
                exif_data = img.getexif()
                
                # XPComment tag for Windows (0x9C9C = 40092)
                XP_COMMENT_TAG = 0x9C9C
                xp_comment_bytes = provenance_json.encode("utf-16le") + b"\x00\x00"
                exif_data[XP_COMMENT_TAG] = xp_comment_bytes
                
                # ImageDescription (0x010E = 270) 
                exif_data[270] = provenance_json
                
                img.save(str(path), "JPEG", quality=95, exif=exif_data)
        
        return True
        
    except Exception as e:
        print(f"  Error embedding metadata: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Re-embed metadata into existing images")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without making changes")
    parser.add_argument("--project", type=str, help="Only process images from this project slug")
    args = parser.parse_args()
    
    print(f"ROOT_DIR: {settings.ROOT_DIR}")
    
    with Session(engine) as session:
        # Build query
        query = select(Image).where(
            Image.is_deleted == False,
            Image.extra_metadata != None
        )
        
        if args.project:
            # Find project by slug
            project = session.exec(select(Project).where(Project.slug == args.project)).first()
            if not project:
                print(f"Project not found: {args.project}")
                return
            
            # Get job IDs for this project
            job_ids = session.exec(
                select(Job.id).where(Job.project_id == project.id)
            ).all()
            
            if not job_ids:
                print(f"No jobs found for project: {args.project}")
                return
            
            query = query.where(Image.job_id.in_(job_ids))
        
        images = session.exec(query).all()
        
        print(f"Found {len(images)} images with metadata")
        
        success_count = 0
        skip_count = 0
        error_count = 0
        
        for img in images:
            print(f"Processing: {img.filename} (path: {img.path})")
            
            if args.dry_run:
                print(f"  [DRY RUN] Would embed metadata")
                success_count += 1
                continue
            
            if embed_metadata_to_file(img.path, img.extra_metadata):
                print(f"  ✓ Embedded metadata")
                success_count += 1
            else:
                error_count += 1
        
        print(f"\nSummary:")
        print(f"  Success: {success_count}")
        print(f"  Skipped: {skip_count}")
        print(f"  Errors:  {error_count}")


if __name__ == "__main__":
    main()

