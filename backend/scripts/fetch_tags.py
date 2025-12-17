#!/usr/bin/env python3
"""
Fetch top tags from Danbooru and e621 for bundling with Sweet Tea Studio.

Run this locally (where Danbooru is accessible), then commit the output JSON.

Usage:
    python fetch_tags.py
    
Output:
    backend/app/data/fallback_tags.json (10,000+ tags)
"""

import json
import time
from pathlib import Path

import httpx

OUTPUT_PATH = Path(__file__).parent.parent / "app" / "data" / "fallback_tags.json"

def fetch_danbooru_tags(max_tags: int = 10000, page_size: int = 200) -> list:
    """Fetch top tags from Danbooru ordered by post count."""
    collected = []
    page = 1
    
    print(f"Fetching up to {max_tags} tags from Danbooru...")
    
    with httpx.Client(
        timeout=30.0,
        headers={"User-Agent": "sweet-tea-studio/1.0 (tag-bundler)"}
    ) as client:
        while len(collected) < max_tags:
            try:
                print(f"  Page {page}... ({len(collected)} tags so far)")
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
            except Exception as e:
                print(f"  Error on page {page}: {e}")
                break
            
            if not data:
                break
            
            for tag in data:
                if tag.get("name"):
                    collected.append({
                        "name": tag["name"],
                        "source": "danbooru",
                        "frequency": int(tag.get("post_count", 0) or 0),
                        "description": tag.get("category_name"),
                    })
            
            if len(data) < page_size:
                break
            
            page += 1
            time.sleep(0.5)  # Be nice to the API
    
    print(f"  Collected {len(collected)} Danbooru tags")
    return collected[:max_tags]


def fetch_e621_tags(max_tags: int = 10000, page_size: int = 200) -> list:
    """Fetch top tags from e621 ordered by post count."""
    collected = []
    page = 1
    
    print(f"Fetching up to {max_tags} tags from e621...")
    
    with httpx.Client(
        timeout=30.0,
        headers={"User-Agent": "sweet-tea-studio/1.0 (tag-bundler)"}
    ) as client:
        while len(collected) < max_tags:
            try:
                print(f"  Page {page}... ({len(collected)} tags so far)")
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
            except Exception as e:
                print(f"  Error on page {page}: {e}")
                break
            
            if not data:
                break
            
            for tag in data:
                if tag.get("name"):
                    collected.append({
                        "name": tag["name"],
                        "source": "e621",
                        "frequency": int(tag.get("post_count", 0) or 0),
                        "description": str(tag.get("category") or ""),
                    })
            
            if len(data) < page_size:
                break
            
            page += 1
            time.sleep(1.0)  # e621 rate limits more strictly
    
    print(f"  Collected {len(collected)} e621 tags")
    return collected[:max_tags]


def add_quality_tags() -> list:
    """Add common quality/style tags used in Stable Diffusion prompts."""
    return [
        {"name": "masterpiece", "source": "custom", "frequency": 999999, "description": "quality"},
        {"name": "best_quality", "source": "custom", "frequency": 999998, "description": "quality"},
        {"name": "high_quality", "source": "custom", "frequency": 999997, "description": "quality"},
        {"name": "extremely_detailed", "source": "custom", "frequency": 999996, "description": "quality"},
        {"name": "ultra_detailed", "source": "custom", "frequency": 999995, "description": "quality"},
        {"name": "detailed_background", "source": "custom", "frequency": 999994, "description": "quality"},
        {"name": "intricate_details", "source": "custom", "frequency": 999993, "description": "quality"},
        {"name": "8k", "source": "custom", "frequency": 999992, "description": "quality"},
        {"name": "4k", "source": "custom", "frequency": 999991, "description": "quality"},
        {"name": "hdr", "source": "custom", "frequency": 999990, "description": "quality"},
        {"name": "photorealistic", "source": "custom", "frequency": 999989, "description": "style"},
        {"name": "realistic", "source": "custom", "frequency": 999988, "description": "style"},
        {"name": "anime", "source": "custom", "frequency": 999987, "description": "style"},
        {"name": "illustration", "source": "custom", "frequency": 999986, "description": "style"},
        {"name": "digital_art", "source": "custom", "frequency": 999985, "description": "style"},
        {"name": "concept_art", "source": "custom", "frequency": 999984, "description": "style"},
        {"name": "painting", "source": "custom", "frequency": 999983, "description": "style"},
        {"name": "cinematic_lighting", "source": "custom", "frequency": 999982, "description": "lighting"},
        {"name": "dramatic_lighting", "source": "custom", "frequency": 999981, "description": "lighting"},
        {"name": "soft_lighting", "source": "custom", "frequency": 999980, "description": "lighting"},
        {"name": "studio_lighting", "source": "custom", "frequency": 999979, "description": "lighting"},
        {"name": "volumetric_lighting", "source": "custom", "frequency": 999978, "description": "lighting"},
        {"name": "backlighting", "source": "custom", "frequency": 999977, "description": "lighting"},
        {"name": "rim_lighting", "source": "custom", "frequency": 999976, "description": "lighting"},
        {"name": "depth_of_field", "source": "custom", "frequency": 999975, "description": "camera"},
        {"name": "bokeh", "source": "custom", "frequency": 999974, "description": "camera"},
        {"name": "sharp_focus", "source": "custom", "frequency": 999973, "description": "camera"},
        {"name": "film_grain", "source": "custom", "frequency": 999972, "description": "camera"},
        {"name": "lens_flare", "source": "custom", "frequency": 999971, "description": "camera"},
    ]


def main():
    print("=" * 60)
    print("Sweet Tea Studio - Tag Fetcher")
    print("=" * 60)
    print()
    
    # Fetch from sources
    danbooru_tags = fetch_danbooru_tags(max_tags=10000)
    e621_tags = fetch_e621_tags(max_tags=10000)
    quality_tags = add_quality_tags()
    
    # Merge and deduplicate (keep highest frequency)
    seen = {}
    for tag in quality_tags + danbooru_tags + e621_tags:
        name = tag["name"].lower()
        if name not in seen or tag["frequency"] > seen[name]["frequency"]:
            seen[name] = tag
    
    all_tags = list(seen.values())
    
    # Sort by frequency descending
    all_tags.sort(key=lambda t: -t["frequency"])
    
    print()
    print(f"Total unique tags: {len(all_tags)}")
    print(f"Writing to: {OUTPUT_PATH}")
    
    # Ensure directory exists
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    # Write JSON
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(all_tags, f, indent=2, ensure_ascii=False)
    
    print(f"Done! File size: {OUTPUT_PATH.stat().st_size / 1024:.1f} KB")
    print()
    print("Top 10 tags:")
    for tag in all_tags[:10]:
        print(f"  {tag['name']}: {tag['frequency']:,} ({tag['source']})")


if __name__ == "__main__":
    main()
