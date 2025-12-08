from fastapi import APIRouter, HTTPException
from typing import List, Optional
from app.models.prompt import Prompt, PromptCreate, PromptRead

router = APIRouter()

# Mock Prompt Database
from sqlmodel import Session, select, col
from app.db.engine import engine as db_engine
from app.models.image import Image
from app.models.job import Job

class PromptWithImages(PromptRead):
    related_images: List[str] = []

@router.get("/", response_model=List[PromptWithImages])
def read_prompts(
    skip: int = 0, 
    limit: int = 100,
    search: Optional[str] = None
):
    with Session(db_engine) as session:
        query = select(Prompt)
        if search:
            s = f"%{search.lower()}%"
            # simple case-insensitive like Search
            # SQLite default is case-insensitive for ASCII, but proper way:
            query = query.where(
                (col(Prompt.name).ilike(s)) | 
                (col(Prompt.positive_text).ilike(s)) | 
                (col(Prompt.negative_text).ilike(s))
            )
        
        query = query.order_by(Prompt.updated_at.desc()).offset(skip).limit(limit)
        prompts = session.exec(query).all()
        
        results = []
        for p in prompts:
            # Find related images via Jobs
            # This is N+1 query but acceptable for small limit=100
            # Get Job IDs linked to this prompt
            job_stmt = select(Job.id).where(Job.prompt_id == p.id)
            job_ids = session.exec(job_stmt).all()
            
            related = []
            if job_ids:
                # Get Images for these jobs
                img_stmt = select(Image.path).where(col(Image.job_id).in_(job_ids)).order_by(Image.id.desc()).limit(4)
                related = session.exec(img_stmt).all()
            
            results.append(PromptWithImages(
                **p.dict(),
                related_images=related
            ))
            
        return results

@router.post("/", response_model=PromptRead)
def create_prompt(prompt: PromptCreate):
    with Session(db_engine) as session:
        new_prompt = Prompt.from_orm(prompt)
        session.add(new_prompt)
        session.commit()
        session.refresh(new_prompt)
        return new_prompt

@router.delete("/{prompt_id}")
def delete_prompt(prompt_id: int):
    with Session(db_engine) as session:
        prompt = session.get(Prompt, prompt_id)
        if not prompt:
            raise HTTPException(status_code=404, detail="Prompt not found")
        session.delete(prompt)
        session.commit()
        return {"status": "deleted"}
