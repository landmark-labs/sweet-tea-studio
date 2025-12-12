"""
Library Tags Module

Handles tag management, external source fetching (Danbooru, e621, Rule34),
and background caching synchronization.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Literal, Optional
import json
import time
from threading import Thread
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlmodel import Session, col, select

from app.models.tag import Tag, TagCreate, TagSyncState
from app.models.prompt import Prompt
from app.db.engine import engine as db_engine, tags_engine

router = APIRouter()

# Constants
TAG_CACHE_MAX_AGE = timedelta(hours=24)
TAG_CACHE_MAX_TAGS = 10000
TAG_CACHE_PAGE_SIZE = 200

# Models
class TagSuggestion(BaseModel):
    name: str
    source: str = "library"
    frequency: int = 0
    description: Optional[str] = None

class TagImportRequest(BaseModel):
    tags: List[TagCreate]

# --- Core Logic ---

def upsert_tags(session: Session, tags: List[str], source: str = "custom") -> None:
    if not tags:
        return

    normalized = [t.strip() for t in tags if t and t.strip()]
    if not normalized:
        return

    existing = session.exec(select(Tag).where(col(Tag.name).in_(normalized))).all()
    existing_map = {t.name: t for t in existing}

    for name in normalized:
        if name in existing_map:
            existing_map[name].frequency += 1
            existing_map[name].updated_at = datetime.utcnow()
        else:
            session.add(Tag(name=name, source=source, frequency=1))

    session.commit()

def bulk_upsert_tag_suggestions(session: Session, tags: List[TagSuggestion], source: str) -> int:
    if not tags:
        return 0

    total_created = 0
    total_updated = 0
    
    # Process in small batches to keep write transactions short
    batch_size = 500
    
    for i in range(0, len(tags), batch_size):
        batch = tags[i : i + batch_size]
        batch_names = [t.name for t in batch if t.name]
        
        if not batch_names:
            continue
            
        # 1. Fetch existing tags for this batch
        existing = session.exec(select(Tag).where(col(Tag.name).in_(batch_names))).all()
        existing_map = {t.name: t for t in existing}
        
        processed_in_batch = set()
        
        for tag in batch:
            if not tag.name:
                continue
            if tag.name in processed_in_batch:
                continue
            processed_in_batch.add(tag.name)
            
            if tag.name in existing_map:
                current = existing_map[tag.name]
                current.frequency = max(current.frequency or 0, tag.frequency)
                current.description = current.description or tag.description
                current.updated_at = datetime.utcnow()
                current.source = current.source or source
                total_updated += 1
            else:
                session.add(
                    Tag(
                        name=tag.name,
                        source=source,
                        frequency=tag.frequency,
                        description=tag.description,
                    )
                )
                total_created += 1
        
        # 2. Commit this batch immediately to release write lock
        try:
            session.commit()
        except Exception as e:
            print(f"Error committing batch {i}: {e}")
            session.rollback()
            
        # 3. Yield to other threads/readers
        time.sleep(0.05)
        
    return total_created + total_updated

# --- External Fetchers ---

def fetch_danbooru_tags(query: str, limit: int = 10) -> List[TagSuggestion]:
    try:
        with httpx.Client(timeout=5.0, headers={"User-Agent": "sweet-tea-studio/0.1"}) as client:
            res = client.get(
                "https://danbooru.donmai.us/tags.json",
                params={
                    "search[name_matches]": f"{query}*",
                    "search[order]": "count",
                    "limit": limit,
                },
            )
            res.raise_for_status()
            data = res.json()
            return [
                TagSuggestion(
                    name=tag.get("name", ""),
                    source="danbooru",
                    frequency=int(tag.get("post_count", 0) or 0),
                    description=tag.get("category_name"),
                )
                for tag in data
                if tag.get("name")
            ]
    except Exception:
        return []

def fetch_all_danbooru_tags(max_tags: int = TAG_CACHE_MAX_TAGS, page_size: int = TAG_CACHE_PAGE_SIZE) -> List[TagSuggestion]:
    collected: List[TagSuggestion] = []
    page = 1

    with httpx.Client(timeout=10.0, headers={"User-Agent": "sweet-tea-studio/0.1 (preload)"}) as client:
        while len(collected) < max_tags:
            try:
                res = client.get(
                    "https://danbooru.donmai.us/tags.json",
                    params={
                        "search[order]": "count",
                        "limit": page_size,
                        "page": page,
                    },
                )
                res.raise_for_status()
                data = res.json()
            except Exception:
                break

            if not data:
                break

            collected.extend(
                [
                    TagSuggestion(
                        name=tag.get("name", ""),
                        source="danbooru",
                        frequency=int(tag.get("post_count", 0) or 0),
                        description=tag.get("category_name"),
                    )
                    for tag in data
                    if tag.get("name")
                ]
            )

            if len(data) < page_size:
                break
            page += 1

    return collected[:max_tags]

def fetch_e621_tags(query: str, limit: int = 10) -> List[TagSuggestion]:
    try:
        with httpx.Client(
            timeout=5.0,
            headers={"User-Agent": "sweet-tea-studio/0.1 (autocomplete)"},
        ) as client:
            res = client.get(
                "https://e621.net/tags.json",
                params={
                    "search[name_matches]": f"{query}*",
                    "search[order]": "count",
                    "limit": limit,
                },
            )
            res.raise_for_status()
            data = res.json()
            return [
                TagSuggestion(
                    name=tag.get("name", ""),
                    source="e621",
                    frequency=int(tag.get("post_count", 0) or 0),
                    description=str(tag.get("category") or ""),
                )
                for tag in data
                if tag.get("name")
            ]
    except Exception:
        return []

def fetch_all_e621_tags(max_tags: int = TAG_CACHE_MAX_TAGS, page_size: int = TAG_CACHE_PAGE_SIZE) -> List[TagSuggestion]:
    collected: List[TagSuggestion] = []
    page = 1

    with httpx.Client(
        timeout=10.0,
        headers={"User-Agent": "sweet-tea-studio/0.1 (preload)"},
    ) as client:
        while len(collected) < max_tags:
            try:
                res = client.get(
                    "https://e621.net/tags.json",
                    params={
                        "search[order]": "count",
                        "limit": page_size,
                        "page": page,
                    },
                )
                res.raise_for_status()
                data = res.json()
            except Exception:
                break

            if not data:
                break

            collected.extend(
                [
                    TagSuggestion(
                        name=tag.get("name", ""),
                        source="e621",
                        frequency=int(tag.get("post_count", 0) or 0),
                        description=str(tag.get("category") or ""),
                    )
                    for tag in data
                    if tag.get("name")
                ]
            )

            if len(data) < page_size:
                break
            page += 1

    return collected[:max_tags]

def fetch_rule34_tags(query: str, limit: int = 10) -> List[TagSuggestion]:
    """Fetch tags from Rule34 autocomplete API."""
    try:
        with httpx.Client(
            timeout=5.0,
            headers={"User-Agent": "sweet-tea-studio/0.1 (autocomplete)"},
            follow_redirects=True,
        ) as client:
            res = client.get(
                "https://api.rule34.xxx/autocomplete.php",
                params={"q": query},
            )
            res.raise_for_status()
            
            data = res.json()
            tags = []
            for item in data[:limit]:
                name = item.get("value", "").strip().lower()
                label = item.get("label", "")
                count = 0
                if "(" in label and ")" in label:
                    try:
                        count_str = label.split("(")[-1].rstrip(")")
                        count = int(count_str)
                    except ValueError:
                        pass
                
                if name:
                    tags.append(
                        TagSuggestion(
                            name=name,
                            source="rule34",
                            frequency=count,
                            description=None,
                        )
                    )
            return tags
    except Exception as e:
        print(f"rule34 fetch error: {e}")
        return []

def fetch_all_rule34_tags(max_tags: int = TAG_CACHE_MAX_TAGS, page_size: int = 100) -> List[TagSuggestion]:
    """Fetch popular tags from Rule34 for caching using autocomplete endpoint."""
    collected: List[TagSuggestion] = []
    seen_names: set = set()
    
    prefixes = [
        "1", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
        "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
        "bl", "br", "gr", "lo", "ni", "se", "so", "th"
    ]
    
    with httpx.Client(
        timeout=10.0,
        headers={"User-Agent": "sweet-tea-studio/0.1 (preload)"},
        follow_redirects=True,
    ) as client:
        for prefix in prefixes:
            if len(collected) >= max_tags:
                break
            try:
                res = client.get(
                    "https://api.rule34.xxx/autocomplete.php",
                    params={"q": prefix},
                )
                res.raise_for_status()
                data = res.json()
                
                for item in data:
                    name = item.get("value", "").strip().lower()
                    if name and name not in seen_names:
                        seen_names.add(name)
                        label = item.get("label", "")
                        count = 0
                        if "(" in label and ")" in label:
                            try:
                                count_str = label.split("(")[-1].rstrip(")")
                                count = int(count_str)
                            except ValueError:
                                pass
                        
                        collected.append(
                            TagSuggestion(
                                name=name,
                                source="rule34",
                                frequency=count,
                                description=None,
                            )
                        )
            except Exception:
                continue

    return collected[:max_tags]

# --- Background Workers ---

def refresh_remote_tag_cache_if_stale():
    sources = {
        "danbooru": fetch_all_danbooru_tags,
        "e621": fetch_all_e621_tags,
        "rule34": fetch_all_rule34_tags,
    }

    for source, fetcher in sources.items():
        # 1. Check staleness (Quick Read)
        is_stale = False
        with Session(tags_engine) as session:
            state = session.exec(
                select(TagSyncState).where(TagSyncState.source == source)
            ).first()
            
            if not state:
                is_stale = True
            elif datetime.utcnow() - state.last_synced_at > TAG_CACHE_MAX_AGE:
                is_stale = True
        
        if not is_stale:
            continue

        # 2. Fetch data (Slow Network I/O) - NO DB CONNECTION HELD
        try:
            print(f"[TagSync] Fetching {source}...")
            remote_tags = fetcher() # This can take seconds/minutes
            print(f"[TagSync] Fetched {len(remote_tags)} tags from {source}")
        except Exception as e:
            print(f"[TagSync] Failed to fetch {source}: {e}")
            continue

        # 3. Write data (Quick Write)
        if remote_tags:
            try:
                with Session(tags_engine) as session:
                    bulk_upsert_tag_suggestions(session, remote_tags, source)
                    
                    # Re-fetch state to update it
                    state = session.exec(
                        select(TagSyncState).where(TagSyncState.source == source)
                    ).first()
                    
                    if state:
                        state.last_synced_at = datetime.utcnow()
                        state.tag_count = len(remote_tags)
                        session.add(state)
                    else:
                        session.add(
                            TagSyncState(
                                source=source,
                                last_synced_at=datetime.utcnow(),
                                tag_count=len(remote_tags),
                            )
                        )
                    session.commit()
                    print(f"[TagSync] Saved {len(remote_tags)} tags for {source}")
            except Exception as e:
                print(f"[TagSync] Failed to save {source} tags: {e}")

def start_tag_cache_refresh_background():
    Thread(target=refresh_remote_tag_cache_if_stale, daemon=True).start()

def save_discovered_tags(tags: List[TagSuggestion]):
    """Background task to save discovered tags to the database."""
    if not tags:
        return
    try:
        with Session(tags_engine) as session:
            for tag_data in tags:
                # Check if exists (case-insensitive)
                existing = session.exec(select(Tag).where(Tag.name == tag_data.name)).first()
                if existing:
                    if tag_data.frequency > existing.frequency:
                        existing.frequency = tag_data.frequency
                        existing.source = tag_data.source
                        existing.updated_at = datetime.utcnow()
                        session.add(existing)
                else:
                    new_tag = Tag(
                        name=tag_data.name,
                        source=tag_data.source,
                        frequency=tag_data.frequency,
                        description=tag_data.description,
                    )
                    session.add(new_tag)
            session.commit()
    except Exception as e:
        print(f"Failed to save discovered tags: {e}")

# --- Endpoints ---

@router.get("/suggest", response_model=List[TagSuggestion])
def suggest_tags(query: str, background_tasks: BackgroundTasks, limit: int = 20):
    # Normalize query
    normalized_query = query.lower().replace(" ", "_")
    query_like = f"%{normalized_query}%"

    merged: Dict[str, TagSuggestion] = {}
    
    # Track tags needed to be saved/updated
    tags_to_save: List[TagSuggestion] = []

    # 1. Fetch from local DB (Tags and Prompts)
    with Session(tags_engine) as session:
        tag_stmt = (
            select(Tag)
            .where(col(Tag.name).ilike(query_like))
            .order_by(Tag.frequency.desc())
            .limit(limit * 2)
        )
        tags = session.exec(tag_stmt).all()
        for tag in tags:
            merged[tag.name.lower()] = TagSuggestion(
                name=tag.name,
                source=tag.source or "library",
                frequency=tag.frequency or 0,
                description=tag.description,
            )
    
    # 1b. Fetch prompts from main profile.db
    with Session(db_engine) as session:
        prompt_stmt = (
            select(Prompt)
            .where(
                (col(Prompt.name).ilike(query_like))
                | (col(Prompt.positive_text).ilike(query_like))
            )
            .order_by(Prompt.updated_at.desc())
            .limit(limit)
        )
        prompts = session.exec(prompt_stmt).all()
        for p in prompts:
            ptags = p.tags or []
            if isinstance(ptags, str):
                 try: ptags = json.loads(ptags)
                 except: ptags = []
            
            snippet_parts = [p.positive_text or "", p.description or ""]
            snippet = " ".join([s for s in snippet_parts if s]).strip()
            
            key = f"prompt:{p.id}"
            merged[key] = TagSuggestion(
                name=p.name,
                source="prompt",
                frequency=len(ptags),
                description=snippet[:180] if snippet else None,
            )

    # Note: External APIs disabled for performance (as per original code)

    # Schedule background save for new/updated tags
    if tags_to_save:
        background_tasks.add_task(save_discovered_tags, tags_to_save)

    priority = {"library": 0, "prompt": 0, "custom": 0, "danbooru": 1, "e621": 2, "rule34": 3}

    sorted_tags = sorted(
        merged.values(),
        key=lambda t: (
            0 if t.name.lower() == normalized_query else 1,
            priority.get(t.source, 3),
            -t.frequency,
            t.name,
        ),
    )

    return sorted_tags[:limit]

@router.post("/import", response_model=Dict[str, Any])
def import_tags(payload: TagImportRequest):
    with Session(db_engine) as session:
        created = 0
        updated = 0
        for tag in payload.tags:
            existing = session.exec(select(Tag).where(Tag.name == tag.name)).first()
            if existing:
                existing.frequency = max(existing.frequency, tag.frequency)
                existing.source = tag.source
                existing.description = tag.description
                updated += 1
            else:
                session.add(Tag.from_orm(tag))
                created += 1

        session.commit()
        return {"created": created, "updated": updated, "total": created + updated}
