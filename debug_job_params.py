from sqlmodel import Session, select, create_engine
from app.models.job import Job
from app.models.image import Image
from app.db.database import sqlite_url

engine = create_engine("sqlite:///./backend/diffusion_studio.db")

with Session(engine) as session:
    # Get last 5 jobs
    jobs = session.exec(select(Job).order_by(Job.created_at.desc()).limit(5)).all()
    
    print(f"Found {len(jobs)} jobs.\n")
    
    for job in jobs:
        print(f"Job ID: {job.id}, Status: {job.status}")
        print(f"Input Params Keys: {list(job.input_params.keys())}")
        print(f"Input Params: {job.input_params}")
        
        # Check associated images
        images = session.exec(select(Image).where(Image.job_id == job.id)).all()
        print(f"Image Count: {len(images)}")
        print("-" * 40)
