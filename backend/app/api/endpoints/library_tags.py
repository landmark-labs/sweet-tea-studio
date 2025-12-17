"""
Library Tags Module

Handles tag management, external source fetching (Danbooru, e621, Rule34),
and background caching synchronization.
"""

import logging
import socket
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
import json
import time
from threading import Thread, RLock
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager, nullcontext

import httpx
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlmodel import Session, col, select, func

from app.models.tag import Tag, TagCreate, TagSyncState
from app.models.prompt import Prompt
from app.db.engine import engine as db_engine, tags_engine
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# Path to static fallback tags (shipped with app)
FALLBACK_TAGS_PATH = Path(__file__).parent.parent.parent / "data" / "fallback_tags.json"

# Constants
TAG_CACHE_MAX_AGE = timedelta(hours=24)
TAG_CACHE_MAX_TAGS = 10000
TAG_CACHE_PAGE_SIZE = 200

# DNS-over-HTTPS endpoints (Cloudflare and Google as fallbacks)
DOH_SERVERS = [
    "https://1.1.1.1/dns-query",
    "https://8.8.8.8/dns-query",
]

_DOH_DNS_LOCK = RLock()
_DOH_DNS_OVERRIDES: Dict[str, str] = {}
_DOH_DNS_REFCOUNTS: Dict[str, int] = {}
_DOH_ORIGINAL_GETADDRINFO = socket.getaddrinfo
_DOH_PATCH_INSTALLED = False


def _doh_patched_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    try:
        host_key = host.lower() if isinstance(host, str) else host
    except Exception:
        host_key = host

    with _DOH_DNS_LOCK:
        override_ip = _DOH_DNS_OVERRIDES.get(host_key)

    if override_ip:
        return _DOH_ORIGINAL_GETADDRINFO(override_ip, port, family, type, proto, flags)
    return _DOH_ORIGINAL_GETADDRINFO(host, port, family, type, proto, flags)


def _install_doh_patch_if_needed() -> None:
    global _DOH_PATCH_INSTALLED
    if _DOH_PATCH_INSTALLED:
        return
    socket.getaddrinfo = _doh_patched_getaddrinfo
    _DOH_PATCH_INSTALLED = True


def _uninstall_doh_patch_if_needed() -> None:
    global _DOH_PATCH_INSTALLED
    if not _DOH_PATCH_INSTALLED:
        return
    if _DOH_DNS_REFCOUNTS:
        return
    socket.getaddrinfo = _DOH_ORIGINAL_GETADDRINFO
    _DOH_PATCH_INSTALLED = False


def resolve_via_doh(hostname: str) -> Optional[str]:
    """
    Resolve hostname to IP address using DNS-over-HTTPS.
    Bypasses local DNS poisoning on datacenter networks.
    """
    for doh_server in DOH_SERVERS:
        try:
            with httpx.Client(timeout=5.0, follow_redirects=True, trust_env=False) as client:
                res = client.get(
                    doh_server,
                    params={"name": hostname, "type": "A"},
                    headers={"Accept": "application/dns-json"},
                )
                res.raise_for_status()
                data = res.json()
                
                # Extract first A record
                for answer in data.get("Answer", []):
                    if answer.get("type") == 1:  # A record
                        ip = answer.get("data")
                        if ip:
                            logger.debug(f"[DoH] Resolved {hostname} -> {ip}")
                            return ip
        except Exception as e:
            logger.debug(f"[DoH] Failed to resolve {hostname} via {doh_server}: {e}")
            continue
    
    logger.warning(f"[DoH] Could not resolve {hostname} via any DoH server")
    return None


@contextmanager
def doh_override_dns(hostname: str, additional_hosts: Optional[List[str]] = None):
    """
    Force DNS resolution for one or more hosts to DoH-resolved IPs.

    This keeps SNI/TLS verification correct because callers keep using the real
    hostname in the URL (mirrors `curl --doh-url ... https://host/...` behavior).

    Implementation detail: installs a single global `socket.getaddrinfo` patch
    and uses a reference-counted mapping so it is safe under concurrent use.
    """
    hosts = [hostname] + (additional_hosts or [])
    resolved: Dict[str, str] = {}

    for host in hosts:
        if not host:
            continue
        host_key = host.lower()
        ip = resolve_via_doh(host_key)
        if ip:
            resolved[host_key] = ip
        else:
            logger.warning(f"[DoH] Failed to resolve {host_key}, using system DNS")

    if not resolved:
        yield False
        return

    with _DOH_DNS_LOCK:
        _install_doh_patch_if_needed()
        for host_key, ip in resolved.items():
            if host_key in _DOH_DNS_REFCOUNTS:
                _DOH_DNS_REFCOUNTS[host_key] += 1
                continue
            _DOH_DNS_REFCOUNTS[host_key] = 1
            _DOH_DNS_OVERRIDES[host_key] = ip
            logger.warning(f"[DoH] Overriding DNS: {host_key} -> {ip}")

    try:
        yield True
    finally:
        with _DOH_DNS_LOCK:
            for host_key in list(resolved.keys()):
                count = _DOH_DNS_REFCOUNTS.get(host_key, 0)
                if count <= 1:
                    _DOH_DNS_REFCOUNTS.pop(host_key, None)
                    _DOH_DNS_OVERRIDES.pop(host_key, None)
                else:
                    _DOH_DNS_REFCOUNTS[host_key] = count - 1
            _uninstall_doh_patch_if_needed()


def load_fallback_tags() -> List["TagSuggestion"]:
    """Load static fallback tags from bundled JSON file."""
    if not FALLBACK_TAGS_PATH.exists():
        logger.warning(f"[TagSync] Fallback tags file not found at {FALLBACK_TAGS_PATH}")
        return []
    
    try:
        with open(FALLBACK_TAGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        tags = [
            TagSuggestion(
                name=t.get("name", ""),
                source=t.get("source", "fallback"),
                frequency=t.get("frequency", 0),
                description=t.get("description"),
            )
            for t in data
            if t.get("name")
        ]
        logger.info(f"[TagSync] Loaded {len(tags)} fallback tags from static file")
        return tags
    except Exception as e:
        logger.error(f"[TagSync] Failed to load fallback tags: {e}")
        return []


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

def upsert_tags_in_cache(tags: List[str], source: str = "custom") -> None:
    """Upsert tags directly into the dedicated autocomplete cache database."""
    if not tags:
        return
    with Session(tags_engine) as session:
        upsert_tags(session, tags, source)

def bootstrap_tags_db_from_profile():
    """
    Legacy migration: copy tags stored in profile.db into tags.db if the cache
    is empty or clearly behind. This preserves manual tags users previously added.
    """
    try:
        with Session(db_engine) as profile_session:
            profile_count = profile_session.exec(select(func.count(Tag.id))).one()
            profile_states = profile_session.exec(select(TagSyncState)).all()
            profile_tags = profile_session.exec(select(Tag)).all() if profile_count else []
    except Exception as e:
        logger.warning(f"[TagSync] Unable to read profile.db tags for migration: {e}")
        return

    try:
        with Session(tags_engine) as tag_session:
            tag_count = tag_session.exec(select(func.count(Tag.id))).one()
            tag_state_count = tag_session.exec(select(func.count(TagSyncState.id))).one()
    except Exception as e:
        logger.warning(f"[TagSync] Unable to inspect tags.db for migration: {e}")
        return

    if not profile_count:
        return

    logger.info(
        f"[TagSync] Backfilling tags.db from profile.db "
        f"(profile tags: {profile_count}, tags.db: {tag_count})"
    )

    try:
        suggestions = [
            TagSuggestion(
                name=t.name,
                source=t.source or "library",
                frequency=t.frequency or 0,
                description=t.description,
            )
            for t in profile_tags
            if t.name
        ]

        with Session(tags_engine) as tag_session:
            if suggestions:
                bulk_upsert_tag_suggestions(tag_session, suggestions, source="library")

            # Copy sync state so staleness checks don't thrash
            for state in profile_states:
                existing = tag_session.exec(
                    select(TagSyncState).where(TagSyncState.source == state.source)
                ).first()
                if existing:
                    if state.last_synced_at and (
                        not existing.last_synced_at
                        or existing.last_synced_at < state.last_synced_at
                    ):
                        existing.last_synced_at = state.last_synced_at
                        existing.tag_count = state.tag_count
                        tag_session.add(existing)
                else:
                    tag_session.add(
                        TagSyncState(
                            source=state.source,
                            last_synced_at=state.last_synced_at,
                            tag_count=state.tag_count,
                        )
                    )
            tag_session.commit()

        logger.info(f"[TagSync] Backfilled {len(suggestions)} tags into tags.db")
    except Exception as e:
        logger.error(f"[TagSync] Failed to backfill tags.db from profile.db: {e}")

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
            effective_source = tag.source or source
            
            if tag.name in existing_map:
                current = existing_map[tag.name]
                current.frequency = max(current.frequency or 0, tag.frequency)
                current.description = current.description or tag.description
                current.updated_at = datetime.utcnow()
                if (not current.source) or (current.source == "library" and effective_source != "library"):
                    current.source = effective_source
                total_updated += 1
            else:
                session.add(
                    Tag(
                        name=tag.name,
                        source=effective_source,
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
        with httpx.Client(
            timeout=5.0,
            headers={"User-Agent": "sweet-tea-studio/0.1"},
            follow_redirects=True,
            trust_env=False,
        ) as client:
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
    except Exception as e:
        logger.warning(f"[TagFetch] Danbooru query failed for '{query}': {e}")
        return []

def fetch_all_danbooru_tags(max_tags: int = TAG_CACHE_MAX_TAGS, page_size: int = TAG_CACHE_PAGE_SIZE) -> List[TagSuggestion]:
    hostname = "danbooru.donmai.us"
    
    def _attempt(use_doh: bool) -> List[TagSuggestion]:
        collected: List[TagSuggestion] = []
        page = 1
        dns_ctx = doh_override_dns(hostname) if use_doh else nullcontext(False)
        with dns_ctx:
            with httpx.Client(
                timeout=10.0,
                headers={"User-Agent": "sweet-tea-studio/0.1 (preload)"},
                base_url=f"https://{hostname}",
                follow_redirects=True,
                trust_env=False,
            ) as client:
                while len(collected) < max_tags:
                    try:
                        res = client.get(
                            "/tags.json",
                            params={
                                "search[order]": "count",
                                "limit": page_size,
                                "page": page,
                            },
                        )
                        res.raise_for_status()
                        data = res.json()
                    except Exception as e:
                        logger.warning(
                            f"[TagSync] Danbooru fetch page {page} failed (doh={use_doh}): {e}"
                        )
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
        return collected

    # Prefer DoH (vast.ai) first, then fall back to system DNS
    data = _attempt(use_doh=True)
    if not data:
        data = _attempt(use_doh=False)
    return data[:max_tags]

def fetch_e621_tags(query: str, limit: int = 10) -> List[TagSuggestion]:
    try:
        with httpx.Client(
            timeout=5.0,
            headers={"User-Agent": "sweet-tea-studio/0.1 (autocomplete)"},
            follow_redirects=True,
            trust_env=False,
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
    except Exception as e:
        logger.warning(f"[TagFetch] e621 query failed: {e}")
        return []

def fetch_all_e621_tags(max_tags: int = TAG_CACHE_MAX_TAGS, page_size: int = TAG_CACHE_PAGE_SIZE) -> List[TagSuggestion]:
    hostname = "e621.net"
    
    def _attempt(use_doh: bool) -> List[TagSuggestion]:
        collected: List[TagSuggestion] = []
        page = 1
        dns_ctx = doh_override_dns(hostname) if use_doh else nullcontext(False)
        with dns_ctx:
            with httpx.Client(
                timeout=10.0,
                headers={"User-Agent": "sweet-tea-studio/0.1 (preload)"},
                base_url=f"https://{hostname}",
                follow_redirects=True,
                trust_env=False,
            ) as client:
                while len(collected) < max_tags:
                    try:
                        res = client.get(
                            "/tags.json",
                            params={
                                "search[order]": "count",
                                "limit": page_size,
                                "page": page,
                            },
                        )
                        res.raise_for_status()
                        data = res.json()
                    except Exception as e:
                        logger.warning(
                            f"[TagSync] e621 fetch page {page} failed (doh={use_doh}): {e}"
                        )
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
        return collected

    data = _attempt(use_doh=True)
    if not data:
        data = _attempt(use_doh=False)
    return data[:max_tags]

def fetch_rule34_tags(query: str, limit: int = 10) -> List[TagSuggestion]:
    """Fetch tags from Rule34 autocomplete API."""
    try:
        dns_ctx = doh_override_dns("api.rule34.xxx", additional_hosts=["rule34.xxx"])
        with dns_ctx:
            with httpx.Client(
                timeout=5.0,
                headers={"User-Agent": "sweet-tea-studio/0.1 (autocomplete)"},
                follow_redirects=True,
                trust_env=False,
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
    """Fetch popular tags from Rule34 using the official DAPI, with fallbacks."""
    hostname = "api.rule34.xxx"
    redirect_host = "rule34.xxx"
    import xml.etree.ElementTree as ET

    browser_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://rule34.xxx/",
    }

    # Keep the URL as https://api.rule34.xxx so SNI is correct; override DNS via DoH underneath.
    client_configs: List[Dict[str, Any]] = [
        {"label": "doh", "use_doh": True},
        {"label": "dns", "use_doh": False},
    ]

    def dapi_attempt(cfg: Dict[str, Any]) -> List[TagSuggestion]:
        user_id = (settings.RULE34_USER_ID or "").strip()
        api_key = (settings.RULE34_API_KEY or "").strip()
        if not (user_id and api_key):
            # Rule34 DAPI requires authentication for many endpoints (tag index included)
            return []

        collected: List[TagSuggestion] = []
        page = 0
        # Rule34 DAPI hard-limits `limit` to 100; larger values can yield empty/error responses.
        limit = 100
        dns_ctx = (
            doh_override_dns(hostname, additional_hosts=[redirect_host])
            if cfg.get("use_doh")
            else nullcontext(False)
        )

        with dns_ctx:
            with httpx.Client(
                timeout=15.0,
                follow_redirects=True,
                base_url=f"https://{hostname}",
                headers=browser_headers,
                trust_env=False,
            ) as client:
                while len(collected) < max_tags:
                    try:
                        res = client.get(
                            "/index.php",
                            params={
                                "page": "dapi",
                                "s": "tag",
                                "q": "index",
                                "user_id": user_id,
                                "api_key": api_key,
                                "limit": limit,
                                "pid": page,
                            },
                        )
                        if res.status_code != 200:
                            snippet = res.text[:200]
                            logger.warning(
                                f"[TagSync] Rule34 DAPI non-200 (status={res.status_code}, cfg={cfg.get('label')}): {snippet}"
                            )
                            res.raise_for_status()

                        try:
                            root = ET.fromstring(res.content)
                        except ET.ParseError:
                            logger.warning(
                                f"[TagSync] Rule34 DAPI XML parse failed (cfg={cfg.get('label')}) - possible Cloudflare HTML"
                            )
                            break

                        if root.tag.lower() == "error":
                            msg = (root.text or "").strip()
                            logger.warning(
                                f"[TagSync] Rule34 DAPI error (cfg={cfg.get('label')}): {msg or 'unknown error'}"
                            )
                            break

                        data = []
                        for child in root.findall("tag"):
                            data.append(
                                {
                                    "name": child.get("name", "").strip().lower(),
                                    "count": int(child.get("count") or 0),
                                }
                            )

                        if not data:
                            break

                        for item in data:
                            name = (item.get("name") or "").strip().lower()
                            if not name:
                                continue
                            count = int(item.get("count", 0) or 0)
                            collected.append(
                                TagSuggestion(
                                    name=name,
                                    source="rule34",
                                    frequency=count,
                                    description=None,
                                )
                            )

                        if len(data) < limit:
                            break
                        page += 1
                        if page > 100:
                            break

                    except Exception as e:
                        logger.warning(
                            f"[TagSync] Rule34 DAPI fetch failed (cfg={cfg.get('label')}, page={page}): {e}"
                        )
                        break
        return collected

    def autocomplete_attempt(cfg: Dict[str, Any]) -> List[TagSuggestion]:
        prefixes = [
            "1", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
            "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
            "bl", "br", "gr", "lo", "ni", "se", "so", "th"
        ]
        collected: List[TagSuggestion] = []
        seen = set()

        dns_ctx = (
            doh_override_dns(hostname, additional_hosts=[redirect_host])
            if cfg.get("use_doh")
            else nullcontext(False)
        )

        autocomplete_headers = {**browser_headers, "Accept": "application/json,text/html;q=0.8,*/*;q=0.1"}

        with dns_ctx:
            with httpx.Client(
                timeout=10.0,
                follow_redirects=True,
                base_url=f"https://{hostname}",
                headers=autocomplete_headers,
                trust_env=False,
            ) as client:
                for prefix in prefixes:
                    if len(collected) >= max_tags:
                        break
                    try:
                        res = client.get("/autocomplete.php", params={"q": prefix})
                        if res.status_code != 200:
                            logger.warning(
                                f"[TagSync] Rule34 autocomplete non-200 (status={res.status_code}, cfg={cfg.get('label')}, prefix={prefix}): {res.text[:200]}"
                            )
                            res.raise_for_status()

                        try:
                            data = res.json()
                        except Exception:
                            logger.warning(
                                f"[TagSync] Rule34 autocomplete JSON parse failed (cfg={cfg.get('label')}, prefix={prefix}): {res.text[:200]}"
                            )
                            continue

                        for item in data:
                            name = (item.get("value") or "").strip().lower()
                            if not name or name in seen:
                                continue
                            seen.add(name)
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
                    except Exception as e:
                        logger.warning(
                            f"[TagSync] Rule34 autocomplete failed (cfg={cfg.get('label')}, prefix={prefix}): {e}"
                        )
                        continue
        return collected

    # Try DoH override first, then system DNS; fall back to autocomplete if DAPI fails.
    has_creds = bool((settings.RULE34_USER_ID or "").strip() and (settings.RULE34_API_KEY or "").strip())
    if not has_creds:
        logger.warning(
            "[TagSync] Rule34 DAPI disabled (missing SWEET_TEA_RULE34_USER_ID / SWEET_TEA_RULE34_API_KEY); "
            "using autocomplete harvesting instead"
        )
    else:
        for cfg in client_configs:
            data = dapi_attempt(cfg)
            if data:
                return data[:max_tags]
            logger.warning(f"[TagSync] Rule34 DAPI returned 0 tags (cfg={cfg.get('label')})")

    logger.warning("[TagSync] Rule34 DAPI returned no data, falling back to autocomplete harvesting")
    for cfg in client_configs:
        data = autocomplete_attempt(cfg)
        if data:
            return data[:max_tags]
        logger.warning(f"[TagSync] Rule34 autocomplete returned 0 tags (cfg={cfg.get('label')})")

    logger.error("[TagSync] Rule34 fetch failed with no tags collected")
    return []

# --- Background Workers ---

def refresh_tag_cache(force: bool = False, only_source: Optional[str] = None):
    """
    Refresh tag cache. If force=True, ignore staleness and re-fetch all (or only_source).
    only_source may be one of: danbooru, e621, rule34.
    """
    sources = {
        "danbooru": fetch_all_danbooru_tags,
        "e621": fetch_all_e621_tags,
        "rule34": fetch_all_rule34_tags,
    }

    total_fetched = 0
    attempted_fetch = False

    for source, fetcher in sources.items():
        if only_source and source != only_source:
            continue

        # 1. Check staleness (Quick Read)
        is_stale = force
        with Session(tags_engine) as session:
            state = session.exec(
                select(TagSyncState).where(TagSyncState.source == source)
            ).first()
            
            if not state:
                is_stale = True
            elif not force and datetime.utcnow() - state.last_synced_at > TAG_CACHE_MAX_AGE:
                is_stale = True
        
        if not is_stale:
            logger.info(f"[TagSync] Skipping {source}: cache fresh (last_sync={state.last_synced_at if state else 'none'})")
            continue

        # 2. Fetch data (Slow Network I/O) - NO DB CONNECTION HELD
        attempted_fetch = True
        try:
            logger.info(f"[TagSync] Fetching {source} (force={force})...")
            remote_tags = fetcher() # This can take seconds/minutes
            logger.info(f"[TagSync] Fetched {len(remote_tags)} tags from {source}")
        except Exception as e:
            logger.warning(f"[TagSync] Failed to fetch {source}: {e}")
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
                    total_fetched += len(remote_tags)
                    logger.info(f"[TagSync] Saved {len(remote_tags)} tags for {source}")
            except Exception as e:
                logger.error(f"[TagSync] Failed to save {source} tags: {e}")
        else:
            logger.warning(f"[TagSync] {source} fetch returned 0 tags")

    # 4. If no network tags were fetched, load fallback tags
    if attempted_fetch and total_fetched == 0:
        logger.warning("[TagSync] No network tags fetched, loading fallback tags...")
        fallback_tags = load_fallback_tags()
        if fallback_tags:
            try:
                with Session(tags_engine) as session:
                    bulk_upsert_tag_suggestions(session, fallback_tags, "fallback")
                    
                    # Mark fallback as synced so we don't re-run immediately
                    state = session.exec(
                        select(TagSyncState).where(TagSyncState.source == "fallback")
                    ).first()
                    if state:
                        state.last_synced_at = datetime.utcnow()
                        state.tag_count = len(fallback_tags)
                        session.add(state)
                    else:
                        session.add(
                            TagSyncState(
                                source="fallback",
                                last_synced_at=datetime.utcnow(),
                                tag_count=len(fallback_tags),
                            )
                        )
                    session.commit()
                    logger.info(f"[TagSync] Loaded {len(fallback_tags)} fallback tags")
            except Exception as e:
                logger.error(f"[TagSync] Failed to save fallback tags: {e}")


def refresh_remote_tag_cache_if_stale():
    refresh_tag_cache(force=False, only_source=None)


def start_tag_cache_refresh_background():
    # Ensure tags.db has any legacy/manual tags before remote sync runs
    bootstrap_tags_db_from_profile()
    Thread(target=refresh_tag_cache, kwargs={"force": False, "only_source": None}, daemon=True).start()

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
    # Normalize query: replace spaces with underscores for tag matching
    normalized_query = query.strip().lower().replace(" ", "_")
    if not normalized_query or len(normalized_query) < 2:
        return []

    # Prepare SQL patterns
    # 1. Exact match or prefix match pattern
    prefix_like = f"{normalized_query}%"
    # 2. General substring match pattern (for standard LIKE)
    substring_like = f"%{normalized_query}%"

    merged: Dict[str, TagSuggestion] = {}
    tags_to_save: List[TagSuggestion] = []

    # 1. Fetch from local DB (Tags)
    # We prioritize:
    # 1. Starts with query (Prefix match)
    # 2. Tag frequency
    with Session(tags_engine) as session:
        # Use a case statement to boost prefix matches
        # Note: In SQLite, True is 1, False is 0.
        prefix_match_expr = col(Tag.name).like(prefix_like)
        
        tag_stmt = (
            select(Tag)
            .where(col(Tag.name).ilike(substring_like)) # Match any substring
            .order_by(
                prefix_match_expr.desc(), # Prefix matches first
                col(Tag.frequency).desc() # Then by frequency
            )
            .limit(limit * 3) # Fetch more candidates to allow frontend to fine-tune
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
    # Prompts are naturally "fuzzy" in name/content
    with Session(db_engine) as session:
        prompt_stmt = (
            select(Prompt)
            .where(
                (col(Prompt.name).ilike(substring_like))
                | (col(Prompt.positive_text).ilike(substring_like))
            )
            .order_by(Prompt.updated_at.desc())
            .limit(limit)
        )
        prompts = session.exec(prompt_stmt).all()
        for p in prompts:
            # Safely parse tags
            ptags = p.tags or []
            if isinstance(ptags, str):
                 try: ptags = json.loads(ptags)
                 except: ptags = []
            
            # Construct description snippet
            snippet_parts = [p.positive_text or "", p.description or ""]
            snippet = " ".join([s for s in snippet_parts if s]).strip()
            
            key = f"prompt:{p.id}"
            # Ensure unique key avoiding collision with tag names if desired, 
            # though frontend usually treats them differently. 
            # Actually frontend keys by name. Let's keep separate logic if needed.
            # But merged dict keys are tag names. 
            # If a prompt is named "1girl", it overwrites the tag? 
            # Original logic used distinct keys but prompt names are arbitrary.
            # Let's use prompt name as the suggestion name.
            
            # Note: The original code merged everything into `merged`.
            # If prompt name collides with tag name, it overwrites.
            # That's probably fine, typically prompts have spaces.
            merged[p.name.lower()] = TagSuggestion(
                name=p.name,
                source="prompt",
                frequency=len(ptags),
                description=snippet[:180] if snippet else None,
            )

    # Note: External APIs disabled for performance

    priority = {"library": 0, "prompt": 0, "custom": 0, "danbooru": 1, "e621": 2, "rule34": 3}

    sorted_tags = sorted(
        merged.values(),
        key=lambda t: (
            0 if t.name.lower() == normalized_query else 1, # Exact match always top
            0 if t.name.lower().startswith(normalized_query) else 1, # Prefix match second
            priority.get(t.source, 3), # Source priority
            -t.frequency, # High frequency first
            t.name,
        ),
    )

    return sorted_tags[:limit]

@router.post("/import", response_model=Dict[str, Any])
def import_tags(payload: TagImportRequest):
    with Session(tags_engine) as session:
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


@router.post("/refresh")
@router.get("/refresh")
def trigger_tag_refresh(
    background_tasks: BackgroundTasks,
    force: bool = False,
    source: Optional[str] = None,
    wait: bool = False,
):
    """
    Manually trigger a tag cache refresh (useful for debugging).
    Query params:
      - force=true to bypass staleness checks
      - source=rule34 (or danbooru/e621) to refresh only that source
      - wait=true to run synchronously and return counts
    """
    if source and source not in {"danbooru", "e621", "rule34"}:
        raise HTTPException(status_code=400, detail="Invalid source")

    logger.warning(f"[TagSync] Manual refresh requested (force={force}, source={source}, wait={wait})")

    if wait:
        refresh_tag_cache(force=force, only_source=source)
        with Session(tags_engine) as session:
            total_raw = session.exec(select(func.count(Tag.id))).one()
            total = total_raw[0] if isinstance(total_raw, tuple) else total_raw
            by_source_rows = session.exec(
                select(Tag.source, func.count(Tag.id)).group_by(Tag.source)
            ).all()
            by_source = {src: int(cnt) for src, cnt in by_source_rows}
            sync_states = session.exec(select(TagSyncState)).all()
            states = [
                {
                    "source": s.source,
                    "last_synced_at": s.last_synced_at.isoformat() if s.last_synced_at else None,
                    "tag_count": s.tag_count,
                }
                for s in sync_states
            ]
        return {
            "message": "Tag refresh completed",
            "force": force,
            "source": source or "all",
            "total_tags": int(total or 0),
            "tags_by_source": by_source,
            "sync_states": states,
        }

    background_tasks.add_task(refresh_tag_cache, force=force, only_source=source)
    return {"message": "Tag refresh started in background", "force": force, "source": source or "all"}


@router.get("/status")
def get_tag_cache_status():
    """Get status of the tag cache for debugging."""
    with Session(tags_engine) as session:
        total_raw = session.exec(select(func.count(Tag.id))).one()
        total = total_raw[0] if isinstance(total_raw, tuple) else total_raw
        by_source_rows = session.exec(
            select(Tag.source, func.count(Tag.id)).group_by(Tag.source)
        ).all()
        by_source = {src: int(cnt) for src, cnt in by_source_rows}
        
        # Get sync states
        sync_states = session.exec(select(TagSyncState)).all()
        states = [
            {
                "source": s.source,
                "last_synced_at": s.last_synced_at.isoformat() if s.last_synced_at else None,
                "tag_count": s.tag_count,
            }
            for s in sync_states
        ]
        
        return {
            "total_tags": int(total or 0),
            "tags_by_source": by_source,
            "sync_states": states,
            "fallback_file_exists": FALLBACK_TAGS_PATH.exists(),
        }
