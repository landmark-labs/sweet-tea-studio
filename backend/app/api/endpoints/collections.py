from fastapi import APIRouter, HTTPException, Depends, Query
from sqlmodel import Session, select, func
from typing import List, Optional
from app.db.database import get_session
from app.models.collection import Collection, CollectionCreate, CollectionRead
from app.models.image import Image

router = APIRouter()

@router.post("/", response_model=CollectionRead)
def create_collection(collection: CollectionCreate, session: Session = Depends(get_session)):
    db_collection = Collection.from_orm(collection)
    try:
        session.add(db_collection)
        session.commit()
        session.refresh(db_collection)
        return db_collection
    except Exception as e:
        # Check for unique constraint violation (primitive check)
        if "UNIQUE constraint failed" in str(e):
            raise HTTPException(status_code=400, detail="Collection with this name already exists")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/", response_model=List[CollectionRead])
def read_collections(session: Session = Depends(get_session)):
    collections = session.exec(select(Collection).order_by(Collection.name)).all()
    results = []
    # Inefficient N+1 query but simple for SQLite/low volume. 
    # Can optimize with a group_by query later if needed.
    for col in collections:
        count = session.exec(select(func.count(Image.id)).where(Image.collection_id == col.id).where(Image.is_deleted == False)).one()
        results.append(CollectionRead(
            id=col.id, 
            name=col.name, 
            description=col.description, 
            created_at=col.created_at,
            item_count=count
        ))
    return results

@router.delete("/{collection_id}")
def delete_collection(
    collection_id: int, 
    keep_images: bool = Query(True), 
    session: Session = Depends(get_session)
):
    collection = session.get(Collection, collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    
    # Handle images
    images = session.exec(select(Image).where(Image.collection_id == collection_id).where(Image.is_deleted == False)).all()
    for img in images:
        if keep_images:
            img.collection_id = None
            session.add(img)
        else:
            # If we were deleting images entirely, we'd do it here. 
            # But usually deleting a collection just unlinks them.
            # If user actively chooses 'delete contents', we unlink. 
            # (Deleting actual files is a bigger operation best handled by 'cleanup' or explicit delete)
            img.collection_id = None 
            session.add(img)
            
    session.delete(collection)
    session.commit()
    return {"status": "deleted"}

@router.post("/{collection_id}/add", response_model=dict)
def add_images_to_collection(
    collection_id: int, 
    image_ids: List[int], 
    session: Session = Depends(get_session)
):
    collection = session.get(Collection, collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
        
    images = session.exec(select(Image).where(Image.id.in_(image_ids)).where(Image.is_deleted == False)).all()
    for img in images:
        img.collection_id = collection_id
        session.add(img)
        
    session.commit()
    return {"status": "added", "count": len(images)}

@router.post("/remove", response_model=dict)
def remove_images_from_collection(
    image_ids: List[int], 
    session: Session = Depends(get_session)
):
    images = session.exec(select(Image).where(Image.id.in_(image_ids)).where(Image.is_deleted == False)).all()
    for img in images:
        img.collection_id = None
        session.add(img)
        
    session.commit()
    return {"status": "removed", "count": len(images)}
