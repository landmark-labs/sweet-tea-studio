"""Snippets API endpoints for managing prompt snippets."""
from typing import List
from datetime import datetime
from fastapi import APIRouter, HTTPException
from sqlmodel import Session, select

from app.db.engine import engine
from app.models.snippet import Snippet, SnippetCreate, SnippetUpdate, SnippetRead

router = APIRouter()

# Default snippets to seed if database is empty
DEFAULT_SNIPPETS = [
    {"label": "Masterpiece", "content": "masterpiece, best quality, highres, 8k", "color": "#3b82f6", "sort_order": 0},
    {"label": "Negative Basics", "content": "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry", "color": "#ef4444", "sort_order": 1},
]


@router.get("", response_model=List[SnippetRead])
def list_snippets():
    """Get all snippets, ordered by sort_order."""
    with Session(engine) as session:
        snippets = session.exec(
            select(Snippet).order_by(Snippet.sort_order, Snippet.id)
        ).all()
        
        # Seed defaults if empty (first-time use)
        if not snippets:
            for default in DEFAULT_SNIPPETS:
                snippet = Snippet(**default)
                session.add(snippet)
            session.commit()
            snippets = session.exec(
                select(Snippet).order_by(Snippet.sort_order, Snippet.id)
            ).all()
        
        return snippets


@router.post("", response_model=SnippetRead)
def create_snippet(data: SnippetCreate):
    """Create a new snippet."""
    with Session(engine) as session:
        # Get max sort_order for new snippet
        max_order = session.exec(
            select(Snippet.sort_order).order_by(Snippet.sort_order.desc())
        ).first()
        
        snippet = Snippet(
            label=data.label,
            content=data.content,
            color=data.color,
            sort_order=(max_order or 0) + 1
        )
        session.add(snippet)
        session.commit()
        session.refresh(snippet)
        return snippet


@router.put("/{snippet_id}", response_model=SnippetRead)
def update_snippet(snippet_id: int, data: SnippetUpdate):
    """Update an existing snippet."""
    with Session(engine) as session:
        snippet = session.get(Snippet, snippet_id)
        if not snippet:
            raise HTTPException(status_code=404, detail="Snippet not found")
        
        if data.label is not None:
            snippet.label = data.label
        if data.content is not None:
            snippet.content = data.content
        if data.color is not None:
            snippet.color = data.color
        if data.sort_order is not None:
            snippet.sort_order = data.sort_order
        
        snippet.updated_at = datetime.utcnow()
        session.add(snippet)
        session.commit()
        session.refresh(snippet)
        return snippet


@router.delete("/{snippet_id}")
def delete_snippet(snippet_id: int):
    """Delete a snippet."""
    with Session(engine) as session:
        snippet = session.get(Snippet, snippet_id)
        if not snippet:
            raise HTTPException(status_code=404, detail="Snippet not found")
        
        session.delete(snippet)
        session.commit()
        return {"ok": True}


@router.put("/reorder", response_model=List[SnippetRead])
def reorder_snippets(snippet_ids: List[int]):
    """Reorder snippets by providing the new order of IDs."""
    with Session(engine) as session:
        for idx, snippet_id in enumerate(snippet_ids):
            snippet = session.get(Snippet, snippet_id)
            if snippet:
                snippet.sort_order = idx
                snippet.updated_at = datetime.utcnow()
                session.add(snippet)
        session.commit()
        
        snippets = session.exec(
            select(Snippet).order_by(Snippet.sort_order, Snippet.id)
        ).all()
        return snippets


@router.post("/bulk", response_model=List[SnippetRead])
def bulk_upsert_snippets(snippets_data: List[SnippetCreate]):
    """Bulk create/update snippets (used for migration from localStorage)."""
    with Session(engine) as session:
        # Clear existing snippets and replace with new ones
        existing = session.exec(select(Snippet)).all()
        for s in existing:
            session.delete(s)
        session.commit()
        
        # Add new snippets
        for idx, data in enumerate(snippets_data):
            snippet = Snippet(
                label=data.label,
                content=data.content,
                color=data.color,
                sort_order=idx
            )
            session.add(snippet)
        session.commit()
        
        snippets = session.exec(
            select(Snippet).order_by(Snippet.sort_order, Snippet.id)
        ).all()
        return snippets
