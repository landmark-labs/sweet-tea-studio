import argparse
import sys
from datetime import timedelta
from pathlib import Path


def _add_backend_to_path() -> None:
    current = Path(__file__).resolve()
    backend_root = current.parent.parent
    sys.path.append(str(backend_root))


def main() -> int:
    _add_backend_to_path()

    from app.core.config import settings
    from app.db.sqlite_health import (
        checkpoint_wal,
        create_rolling_backup,
        create_overwrite_backup,
        ensure_sqlite_database_or_raise,
        quick_check_path,
    )

    parser = argparse.ArgumentParser(description="SQLite maintenance helpers for Sweet Tea Studio")
    parser.add_argument("--tags", action="store_true", help="Operate on tags.db instead of profile.db")
    parser.add_argument("--path", type=str, default=None, help="Operate on an explicit DB path")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("check", help="Run PRAGMA quick_check")

    checkpoint_parser = sub.add_parser("checkpoint", help="Run PRAGMA wal_checkpoint(TRUNCATE)")
    checkpoint_parser.add_argument("--mode", default="TRUNCATE", help="Checkpoint mode (TRUNCATE, FULL, PASSIVE)")

    backup_parser = sub.add_parser("backup", help="Create a standalone backup DB copy")
    backup_parser.add_argument("--keep", type=int, default=20, help="How many backups to keep")

    recover_parser = sub.add_parser("recover", help="Attempt recovery and swap into place")
    recover_parser.add_argument("--no-auto", action="store_true", help="Do not auto-recover; only fail on errors")

    args = parser.parse_args()

    if args.path:
        db_path = Path(args.path).expanduser()
        label = str(db_path)
        allow_recreate = False
    elif args.tags:
        db_path = settings.meta_dir / "tags.db"
        label = "tags.db"
        allow_recreate = True
    else:
        db_path = settings.database_path
        label = "profile.db"
        allow_recreate = False

    backups_dir = settings.meta_dir / "backups"
    recovery_dir = settings.meta_dir / "recovery"

    if args.cmd == "check":
        result = quick_check_path(db_path)
        print(f"{label}: {db_path}")
        print(f"quick_check: {result}")
        return 0 if result == "ok" else 2

    if args.cmd == "checkpoint":
        print(f"{label}: {db_path}")
        checkpoint_wal(db_path, mode=args.mode)
        print("checkpoint: ok")
        return 0

    if args.cmd == "backup":
        print(f"{label}: {db_path}")
        if args.tags:
            result = create_overwrite_backup(
                db_path,
                backups_dir=backups_dir,
                backup_name="tags.backup.db",
            )
        else:
            result = create_rolling_backup(
                db_path,
                backups_dir=backups_dir,
                keep=max(1, args.keep),
                min_interval=timedelta(seconds=0),
            )
        if result.created:
            print(f"backup: {result.path}")
            return 0
        print(f"backup skipped: {result.reason}")
        return 2

    if args.cmd == "recover":
        print(f"{label}: {db_path}")
        ensure_sqlite_database_or_raise(
            db_path,
            label=f"{label} ({db_path})",
            backups_dir=backups_dir,
            recovery_dir=recovery_dir,
            auto_recover=not args.no_auto,
            allow_recreate=allow_recreate,
            backup_min_interval=timedelta(seconds=0),
        )
        print("recover: ok")
        return 0

    raise AssertionError(f"Unhandled command: {args.cmd}")


if __name__ == "__main__":
    raise SystemExit(main())

