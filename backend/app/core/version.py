from __future__ import annotations

import os
from pathlib import Path


def get_git_sha_short() -> str | None:
    env_sha = os.getenv("SWEET_TEA_GIT_SHA")
    if env_sha:
        text = env_sha.strip()
        return text[:12] if text else None

    try:
        start = Path(__file__).resolve()
        git_dir = None
        for parent in (start,) + tuple(start.parents):
            candidate = parent / ".git"
            if (candidate / "HEAD").exists():
                git_dir = candidate
                break
        if git_dir is None:
            return None

        head_path = git_dir / "HEAD"
        head = head_path.read_text(encoding="utf-8").strip()
        if not head:
            return None

        if head.startswith("ref:"):
            ref = head.split(" ", 1)[1].strip()
            ref_path = git_dir / ref
            if ref_path.exists():
                return ref_path.read_text(encoding="utf-8").strip()[:12]

            packed = git_dir / "packed-refs"
            if packed.exists():
                for line in packed.read_text(encoding="utf-8").splitlines():
                    text = line.strip()
                    if not text or text.startswith("#") or text.startswith("^"):
                        continue
                    sha, ref_name = text.split(" ", 1)
                    if ref_name.strip() == ref:
                        return sha.strip()[:12]
            return None

        return head[:12]
    except Exception:
        return None

