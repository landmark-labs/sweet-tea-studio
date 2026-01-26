"""Settings helpers for gallery caching and thumbnails."""

from app.services import app_settings

_THUMB_CACHE_DEFAULT_MAX_FILES = 10000
_THUMB_CACHE_DEFAULT_MAX_MB = 1024
_THUMB_CACHE_DEFAULT_MAX_AGE_DAYS = 30
_THUMB_CACHE_DEFAULT_PRUNE_INTERVAL_S = 600
_MEDIA_PATH_CACHE_DEFAULT_MAX = 2048
_MEDIA_PATH_CACHE_DEFAULT_TTL_S = 300


def _get_setting_int(key: str, fallback: int) -> int:
    value = app_settings.get_setting_typed(key, fallback)
    if value is None:
        return fallback
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return fallback


def _get_setting_float(key: str, fallback: float) -> float:
    value = app_settings.get_setting_typed(key, fallback)
    if value is None:
        return fallback
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _get_thumb_cache_max_files() -> int:
    return max(0, _get_setting_int("thumb_cache_max_files", _THUMB_CACHE_DEFAULT_MAX_FILES))


def _get_thumb_cache_max_mb() -> int:
    return max(0, _get_setting_int("thumb_cache_max_mb", _THUMB_CACHE_DEFAULT_MAX_MB))


def _get_thumb_cache_max_age_days() -> int:
    return max(0, _get_setting_int("thumb_cache_max_age_days", _THUMB_CACHE_DEFAULT_MAX_AGE_DAYS))


def _get_thumb_cache_prune_interval_s() -> float:
    return max(0.0, _get_setting_float("thumb_cache_prune_interval_s", _THUMB_CACHE_DEFAULT_PRUNE_INTERVAL_S))


def _get_media_path_cache_max() -> int:
    return max(0, _get_setting_int("media_path_cache_max", _MEDIA_PATH_CACHE_DEFAULT_MAX))


def _get_media_path_cache_ttl_s() -> float:
    return max(0.0, _get_setting_float("media_path_cache_ttl_s", _MEDIA_PATH_CACHE_DEFAULT_TTL_S))
