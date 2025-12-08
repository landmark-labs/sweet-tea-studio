from fastapi import APIRouter, HTTPException, Query, Depends
from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi.responses import FileResponse
import os
from sqlmodel import Session, select
from app.db.database import get_session
from app.models.image import Image, ImageRead
from app.models.job import Job
from pydantic import BaseModel

router = APIRouter()

class GalleryItem(BaseModel):
    image: ImageRead
    job_params: Dict[str, Any]
    prompt: Optional[str] = None
    created_at: datetime

@router.get("/", response_model=List[GalleryItem])
def read_gallery(
    skip: int = Query(0, ge=0), 
    limit: int = Query(50, ge=1, le=100),
    session: Session = Depends(get_session)
):
    try:
        # Join Image and Job
        # Note: SQLModel SELECT returns tuples if multiple models joined
        stmt = (
            select(Image, Job)
            .join(Job, Image.job_id == Job.id, isouter=True)
            .order_by(Image.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        results = session.exec(stmt).all()
        
        items = []
        for img, job in results:
            params = job.input_params if job and job.input_params else {}
            prompt_text = params.get("prompt")
            
            item = GalleryItem(
                image=img,
                job_params=params,
                prompt=prompt_text,
                created_at=img.created_at
            )
            items.append(item)
            
        return items
    except Exception as e:
        print(f"Gallery read error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{image_id}")
def delete_image(image_id: int, session: Session = Depends(get_session)):
    image = session.get(Image, image_id)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    session.delete(image)
    session.commit()
    return {"status": "deleted"}

@router.get("/image/path")
def serve_image_by_path(path: str):
    # print(f"Serving path: {path}")
    if not os.path.exists(path):
         print(f"Serve Path: Missing {path}")
         raise HTTPException(status_code=404, detail=f"File not found: {path}")
    return FileResponse(path, media_type="image/png")

@router.get("/image/{image_id}")
def serve_image(image_id: int, session: Session = Depends(get_session)):
    image = session.get(Image, image_id)
    if not image:
        print(f"Serve Image: ID {image_id} not found DB")
        raise HTTPException(status_code=404, detail="Image not found")
    
    if not os.path.exists(image.path):
            print(f"Serve Image: File missing at {image.path}")
            raise HTTPException(status_code=404, detail=f"File not found on disk: {image.path}")
            
    print(f"Serving image {image_id} from {image.path}")
    return FileResponse(image.path, media_type="image/png")
