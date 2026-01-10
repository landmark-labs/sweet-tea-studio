from __future__ import annotations

import shutil
import sqlite3
import subprocess
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional


_SQLITE_CORRUPTION_MARKERS = (
    "database disk image is malformed",
    "file is not a database",
    "malformed database schema",
    "database corruption",
    "database is corrupt",
)


def is_probable_sqlite_corruption_error(exc: BaseException) -> bool:
    text = " | ".join(_iter_exception_text(exc)).lower()
    return any(marker in text for marker in _SQLITE_CORRUPTION_MARKERS)


def checkpoint_wal(db_path: Path, *, mode: str = "TRUNCATE", timeout_s: float = 5.0) -> None:
    """
    Attempt to fold WAL into the main DB file.

    Safe to call even when journal_mode is not WAL (SQLite returns a no-op result).
    """

    if not db_path.exists():
        return

    with sqlite3.connect(str(db_path), timeout=timeout_s) as conn:
        conn.execute(f"PRAGMA wal_checkpoint({mode});").fetchall()


def quick_check_path(db_path: Path, *, timeout_s: float = 5.0) -> str:
    if not db_path.exists():
        return "missing"
    with sqlite3.connect(str(db_path), timeout=timeout_s) as conn:
        return _sqlite_quick_check(conn)


@dataclass(frozen=True)
class BackupResult:
    created: bool
    path: Optional[Path] = None
    reason: Optional[str] = None


def create_rolling_backup(
    db_path: Path,
    *,
    backups_dir: Path,
    keep: int = 20,
    min_interval: timedelta = timedelta(hours=24),
    timeout_s: float = 5.0,
) -> BackupResult:
    """
    Create a point-in-time SQLite backup using the SQLite backup API.

    Produces a standalone *.db copy (no -wal/-shm needed). Keeps the newest
    ``keep`` backups for this DB stem.
    """

    if not db_path.exists():
        return BackupResult(created=False, reason="db_missing")

    backups_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)

    prefix = f"{db_path.stem}.backup-"
    existing = sorted(
        (p for p in backups_dir.glob(f"{prefix}*{db_path.suffix}") if p.is_file()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )

    if existing:
        newest_mtime = datetime.fromtimestamp(existing[0].stat().st_mtime, tz=timezone.utc)
        if now - newest_mtime < min_interval:
            return BackupResult(created=False, reason="too_soon")

    timestamp = now.strftime("%Y%m%d-%H%M%S")
    dest = backups_dir / f"{prefix}{timestamp}{db_path.suffix}"
    dest = _ensure_unique_path(dest)

    _backup_via_sqlite_api(db_path, dest, timeout_s=timeout_s)

    # Prune older backups for this DB stem.
    existing_after = sorted(
        (p for p in backups_dir.glob(f"{prefix}*{db_path.suffix}") if p.is_file()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for old in existing_after[keep:]:
        try:
            old.unlink()
        except OSError:
            # Best-effort retention cleanup; do not fail startup.
            pass

    return BackupResult(created=True, path=dest)


def ensure_sqlite_database_or_raise(
    db_path: Path,
    *,
    label: str,
    backups_dir: Path,
    recovery_dir: Path,
    auto_recover: bool = True,
    allow_recreate: bool = False,
    backup_keep: int = 20,
    backup_min_interval: timedelta = timedelta(hours=24),
    timeout_s: float = 5.0,
) -> None:
    """
    Ensure an on-disk SQLite DB is usable.

    - Never deletes the original DB.
    - Creates rolling backups when the DB is healthy.
    - If corruption is detected and ``auto_recover`` is enabled, attempts a
      best-effort recovery into a new DB and swaps it into place while keeping
      the original as *.broken-<timestamp>.db.
    """

    if not db_path.exists():
        return

    quick_check_error: Optional[str] = None

    try:
        with sqlite3.connect(str(db_path), timeout=timeout_s) as conn:
            quick_check_error = _sqlite_quick_check(conn)
    except sqlite3.DatabaseError as exc:
        if not is_probable_sqlite_corruption_error(exc):
            raise
        quick_check_error = str(exc)

    if quick_check_error in (None, "ok"):
        create_rolling_backup(
            db_path,
            backups_dir=backups_dir,
            keep=backup_keep,
            min_interval=backup_min_interval,
            timeout_s=timeout_s,
        )
        return

    if not auto_recover:
        raise RuntimeError(f"[DB] {label} failed integrity check: {quick_check_error}")

    print(f"[DB] {label} failed integrity check; attempting recovery (original will be preserved).")

    try:
        recovered = recover_sqlite_database(
            db_path,
            label=label,
            recovery_dir=recovery_dir,
            timeout_s=timeout_s,
        )
        broken = _swap_recovered_database_into_place(db_path, recovered)
        print(f"[DB] Preserved original at {broken}")
        print(f"[DB] Using recovered DB at {db_path}")
    except Exception:
        if not allow_recreate:
            raise

        # For non-critical SQLite files (e.g., caches), preserve the broken DB
        # and allow the app to recreate it.
        broken = _move_sqlite_database_aside(db_path)
        print(f"[DB] Preserved broken DB at {broken}; recreating {label}")
        return

    # Create a fresh backup of the recovered DB as the new baseline.
    create_rolling_backup(
        db_path,
        backups_dir=backups_dir,
        keep=backup_keep,
        min_interval=timedelta(seconds=0),
        timeout_s=timeout_s,
    )


def recover_sqlite_database(
    db_path: Path,
    *,
    label: str,
    recovery_dir: Path,
    timeout_s: float = 5.0,
) -> Path:
    """
    Best-effort recovery that preserves the original DB.

    Returns the path to the recovered DB file (not yet swapped into place).
    """

    recovery_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y%m%d-%H%M%S")

    # Always capture a forensic copy of the original + sidecars first.
    forensic_dir = recovery_dir / f"{db_path.stem}.forensics-{timestamp}"
    _copy_sqlite_files(db_path, forensic_dir)

    recovered_path = db_path.with_name(f"{db_path.stem}.recovered-{timestamp}{db_path.suffix}")
    recovered_path = _ensure_unique_path(recovered_path)

    # 1) Try using SQLite's backup API if the DB can be opened.
    opened = False
    try:
        with sqlite3.connect(str(db_path), timeout=timeout_s) as conn:
            opened = True
            # Attempt to fold WAL before backup; can help when -wal exists but wasn't checkpointed.
            try:
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE);").fetchall()
            except sqlite3.DatabaseError:
                pass

            # 1a) VACUUM INTO rebuilds the database file from logical content.
            try:
                vacuum_target = str(recovered_path).replace("'", "''")
                conn.execute(f"VACUUM INTO '{vacuum_target}';")
                _assert_recovered_db_ok(recovered_path, label=label, timeout_s=timeout_s)
                return recovered_path
            except sqlite3.DatabaseError:
                if recovered_path.exists():
                    try:
                        recovered_path.unlink()
                    except OSError:
                        pass

        # 1b) Snapshot copy (fast). This will not fix corruption but can repair
        # issues caused by missing/unclean WAL state.
        _backup_via_sqlite_api(db_path, recovered_path, timeout_s=timeout_s)
        _assert_recovered_db_ok(recovered_path, label=label, timeout_s=timeout_s)
        return recovered_path
    except sqlite3.DatabaseError:
        if recovered_path.exists():
            try:
                recovered_path.unlink()
            except OSError:
                pass
        # Fall through to other recovery methods.
    except Exception:
        if recovered_path.exists():
            try:
                recovered_path.unlink()
            except OSError:
                pass
        if opened:
            # If the DB can be opened but backup failed for some other reason, try CLI recovery next.
            pass

    # 1c) If the DB opens but rebuild/copy failed, try Python iterdump as a last resort
    # without external dependencies.
    if opened:
        try:
            _recover_via_iterdump(db_path, recovered_path, timeout_s=timeout_s)
            _assert_recovered_db_ok(recovered_path, label=label, timeout_s=timeout_s)
            return recovered_path
        except Exception:
            if recovered_path.exists():
                try:
                    recovered_path.unlink()
                except OSError:
                    pass

    # 2) Try sqlite3 shell `.recover` if available (handles many corruptions better than Python).
    sqlite3_exe = shutil.which("sqlite3")
    if not sqlite3_exe:
        raise RuntimeError(
            f"[DB] {label} appears corrupted and automatic recovery requires the `sqlite3` CLI.\n"
            f"Backups/forensics copied to: {forensic_dir}\n"
            f"Install `sqlite3` and run recovery, or restore from a backup."
        )

    _recover_via_sqlite3_cli(sqlite3_exe, db_path, recovered_path, timeout_s=timeout_s)
    _assert_recovered_db_ok(recovered_path, label=label, timeout_s=timeout_s)
    return recovered_path


def _assert_recovered_db_ok(db_path: Path, *, label: str, timeout_s: float) -> None:
    with sqlite3.connect(str(db_path), timeout=timeout_s) as conn:
        res = _sqlite_quick_check(conn)
        if res != "ok":
            raise RuntimeError(f"[DB] Recovered {label} failed quick_check: {res}")

        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
        ).fetchall()
        if not tables:
            raise RuntimeError(f"[DB] Recovered {label} contains no tables; refusing to swap it into place.")


def _sqlite_quick_check(conn: sqlite3.Connection) -> str:
    rows = conn.execute("PRAGMA quick_check;").fetchall()
    if rows == [("ok",)]:
        return "ok"
    return "\n".join(str(row[0]) for row in rows)


def _backup_via_sqlite_api(source_db: Path, dest_db: Path, *, timeout_s: float) -> None:
    dest_db.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(source_db), timeout=timeout_s) as src:
        with sqlite3.connect(str(dest_db), timeout=timeout_s) as dst:
            src.backup(dst)


def _recover_via_sqlite3_cli(
    sqlite3_exe: str,
    source_db: Path,
    dest_db: Path,
    *,
    timeout_s: float,
) -> None:
    """
    Run: sqlite3 source.db ".recover" | sqlite3 dest.db

    Streams via a temp SQL file to avoid large in-memory buffers.
    """

    tmp_sql = dest_db.with_suffix(".sql")
    tmp_sql = _ensure_unique_path(tmp_sql)
    try:
        with tmp_sql.open("w", encoding="utf-8", newline="\n") as handle:
            subprocess.run(
                [sqlite3_exe, str(source_db), ".recover"],
                stdout=handle,
                stderr=subprocess.PIPE,
                text=True,
                check=True,
                timeout=timeout_s * 60,
            )

        with tmp_sql.open("r", encoding="utf-8") as handle:
            subprocess.run(
                [sqlite3_exe, str(dest_db)],
                stdin=handle,
                stderr=subprocess.PIPE,
                text=True,
                check=True,
                timeout=timeout_s * 60,
            )
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        raise RuntimeError(f"sqlite3 recovery failed: {stderr or exc}") from exc
    finally:
        try:
            tmp_sql.unlink()
        except OSError:
            pass


def _recover_via_iterdump(source_db: Path, dest_db: Path, *, timeout_s: float) -> None:
    dest_db.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(source_db), timeout=timeout_s) as src:
        with sqlite3.connect(str(dest_db), timeout=timeout_s) as dst:
            dst.execute("PRAGMA journal_mode=OFF;")
            dst.execute("PRAGMA synchronous=OFF;")
            dst.execute("BEGIN;")
            for statement in src.iterdump():
                if statement in {"BEGIN TRANSACTION;", "COMMIT;"}:
                    continue
                dst.execute(statement)
            dst.execute("COMMIT;")


def _swap_recovered_database_into_place(original: Path, recovered: Path) -> Path:
    """
    Swap a recovered DB into place while keeping the original as *.broken-<ts>.db.
    """

    if not recovered.exists():
        raise RuntimeError(f"Recovered DB does not exist: {recovered}")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    broken = original.with_name(f"{original.stem}.broken-{timestamp}{original.suffix}")
    broken = _ensure_unique_path(broken)

    original_base = str(original)
    broken_base = str(broken)

    for path in _sqlite_related_paths(original):
        if not path.exists():
            continue
        suffix = str(path)[len(original_base) :] if str(path).startswith(original_base) else ""
        dest = Path(broken_base + suffix) if suffix else broken
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(dest))

    shutil.move(str(recovered), str(original))
    return broken


def _move_sqlite_database_aside(db_path: Path) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    broken = db_path.with_name(f"{db_path.stem}.broken-{timestamp}{db_path.suffix}")
    broken = _ensure_unique_path(broken)

    source_base = str(db_path)
    broken_base = str(broken)
    for path in _sqlite_related_paths(db_path):
        if not path.exists():
            continue
        suffix = str(path)[len(source_base) :] if str(path).startswith(source_base) else ""
        dest = Path(broken_base + suffix) if suffix else broken
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(dest))

    return broken


def _copy_sqlite_files(db_path: Path, dest_dir: Path) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    for path in _sqlite_related_paths(db_path):
        if not path.exists():
            continue
        shutil.copy2(str(path), str(dest_dir / path.name))


def _sqlite_related_paths(db_path: Path) -> tuple[Path, ...]:
    base = str(db_path)
    return (
        db_path,
        Path(base + "-wal"),
        Path(base + "-shm"),
        Path(base + "-journal"),
    )


def _ensure_unique_path(path: Path) -> Path:
    if not path.exists():
        return path

    for i in range(1, 1000):
        candidate = path.with_name(f"{path.stem}-{i}{path.suffix}")
        if not candidate.exists():
            return candidate

    raise RuntimeError(f"Unable to find a unique path for {path}")


def _iter_exception_text(exc: BaseException) -> Iterable[str]:
    seen: set[int] = set()

    def walk(e: Optional[BaseException]) -> Iterable[str]:
        if e is None:
            return
        obj_id = id(e)
        if obj_id in seen:
            return
        seen.add(obj_id)
        yield str(e)
        orig = getattr(e, "orig", None)
        if isinstance(orig, BaseException):
            yield from walk(orig)
        yield from walk(getattr(e, "__cause__", None))
        yield from walk(getattr(e, "__context__", None))

    yield from walk(exc)
