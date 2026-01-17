from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from app.core.config import settings
from app.models.engine import Engine
from app.models.project import Project


def normalize_fs_path(path: str) -> str:
    cleaned = (path or "").strip().strip('"').strip("'")
    if not cleaned:
        return ""
    try:
        return os.path.normcase(os.path.normpath(cleaned))
    except Exception:
        return cleaned


def _unique_existing_dirs(paths: Iterable[Path]) -> list[Path]:
    seen: set[str] = set()
    unique: list[Path] = []
    for path in paths:
        try:
            if not path or not path.exists() or not path.is_dir():
                continue
        except Exception:
            continue
        key = normalize_fs_path(str(path))
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique


def _local_folder_aliases(folder_name: str) -> list[str]:
    normalized = (folder_name or "").strip().lower()
    if not normalized:
        return []
    if normalized == "input":
        return ["input", "inputs"]
    if normalized == "output":
        return ["output", "outputs"]
    if normalized == "mask":
        return ["mask", "masks"]
    if normalized == "masks":
        return ["masks"]
    return [folder_name]


def get_project_folder_paths(
    *,
    engine: Optional[Engine],
    project_slug: str,
    folder_name: str,
) -> list[Path]:
    candidates: list[Path] = []
    if engine and engine.input_dir:
        candidates.append(Path(engine.input_dir) / project_slug / folder_name)
    if engine and engine.output_dir:
        candidates.append(settings.get_project_dir_in_comfy(engine.output_dir, project_slug) / folder_name)

    local_root = settings.get_project_dir(project_slug)
    for alias in _local_folder_aliases(folder_name):
        candidates.append(local_root / alias)

    return _unique_existing_dirs(candidates)


def get_project_roots(
    *,
    engine: Optional[Engine],
    project_slug: str,
) -> list[Path]:
    candidates: list[Path] = []
    if engine and engine.input_dir:
        candidates.append(Path(engine.input_dir) / project_slug)
    if engine and engine.output_dir:
        candidates.append(settings.get_project_dir_in_comfy(engine.output_dir, project_slug))

    local_root = settings.get_project_dir(project_slug)
    candidates.append(local_root)

    return _unique_existing_dirs(candidates)


def infer_project_slug_from_path(path: Path, engines: Iterable[Engine]) -> Optional[str]:
    resolved = path
    try:
        resolved = path.resolve()
    except Exception:
        pass

    for engine in engines:
        if engine.input_dir:
            try:
                rel = resolved.relative_to(Path(engine.input_dir))
                if len(rel.parts) >= 1:
                    return rel.parts[0]
            except ValueError:
                pass

        if engine.output_dir:
            try:
                sweet_tea_dir = settings.get_sweet_tea_dir_from_engine_path(engine.output_dir)
                rel = resolved.relative_to(sweet_tea_dir)
                if len(rel.parts) >= 1:
                    return rel.parts[0]
            except ValueError:
                pass

    try:
        rel = resolved.relative_to(settings.projects_dir)
        if len(rel.parts) >= 1:
            return rel.parts[0]
    except ValueError:
        pass

    return None


@dataclass
class ProjectPathIndex:
    roots: list[tuple[str, int, str]]

    def match_project_id(self, path: str) -> Optional[int]:
        normalized = normalize_fs_path(path)
        if not normalized:
            return None
        for root, project_id, _slug in self.roots:
            if normalized == root or normalized.startswith(root + os.sep):
                return project_id
        return None

    def match_project_slug(self, path: str) -> Optional[str]:
        normalized = normalize_fs_path(path)
        if not normalized:
            return None
        for root, _project_id, slug in self.roots:
            if normalized == root or normalized.startswith(root + os.sep):
                return slug
        return None


def build_project_path_index(
    *,
    engines: Iterable[Engine],
    projects: Iterable[Project],
) -> ProjectPathIndex:
    roots: list[tuple[str, int, str]] = []
    seen: set[str] = set()

    for project in projects:
        if not project.slug or project.id is None:
            continue
        slug = project.slug

        for engine in engines:
            for root in get_project_roots(engine=engine, project_slug=slug):
                root_key = normalize_fs_path(str(root))
                if not root_key or root_key in seen:
                    continue
                seen.add(root_key)
                roots.append((root_key, int(project.id), slug))

    roots.sort(key=lambda item: len(item[0]), reverse=True)
    return ProjectPathIndex(roots=roots)
