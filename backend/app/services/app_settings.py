"""App settings service for managing configurable settings.

Settings are stored in the database and fall back to environment variables.
"""
import os
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any, Iterable, List, Literal
from sqlmodel import Session, select

from app.db.engine import engine
from app.models.app_setting import AppSetting


# Known API key setting keys
CIVITAI_API_KEY = "civitai_api_key"
RULE34_API_KEY = "rule34_api_key"
RULE34_USER_ID = "rule34_user_id"

# Mapping of setting keys to their environment variable names
ENV_VAR_MAPPING = {
    CIVITAI_API_KEY: "CIVITAI_API_KEY",
    RULE34_API_KEY: "SWEET_TEA_RULE34_API_KEY",
    RULE34_USER_ID: "SWEET_TEA_RULE34_USER_ID",
}

SettingType = Literal["string", "int", "float", "bool"]


@dataclass(frozen=True)
class AppSettingDefinition:
    key: str
    env_var: str
    default: Optional[str]
    type: SettingType
    label: str
    description: str
    category: str


APP_SETTINGS: List[AppSettingDefinition] = [
    AppSettingDefinition(
        key="thumb_cache_max_files",
        env_var="STS_THUMB_CACHE_MAX_FILES",
        default="10000",
        type="int",
        label="Thumbnail cache max files",
        description="Maximum number of cached thumbnails kept on disk.",
        category="performance",
    ),
    AppSettingDefinition(
        key="thumb_cache_max_mb",
        env_var="STS_THUMB_CACHE_MAX_MB",
        default="1024",
        type="int",
        label="Thumbnail cache max size (MB)",
        description="Maximum disk usage for cached thumbnails.",
        category="performance",
    ),
    AppSettingDefinition(
        key="thumb_cache_max_age_days",
        env_var="STS_THUMB_CACHE_MAX_AGE_DAYS",
        default="30",
        type="int",
        label="Thumbnail cache max age (days)",
        description="Prune cached thumbnails older than this age.",
        category="performance",
    ),
    AppSettingDefinition(
        key="thumb_cache_prune_interval_s",
        env_var="STS_THUMB_CACHE_PRUNE_INTERVAL_S",
        default="600",
        type="int",
        label="Thumbnail cache prune interval (seconds)",
        description="Minimum interval between thumbnail cache prune runs.",
        category="performance",
    ),
    AppSettingDefinition(
        key="media_path_cache_max",
        env_var="STS_MEDIA_PATH_CACHE_MAX",
        default="2048",
        type="int",
        label="Media path cache max entries",
        description="LRU size for media path resolution cache.",
        category="performance",
    ),
    AppSettingDefinition(
        key="media_path_cache_ttl_s",
        env_var="STS_MEDIA_PATH_CACHE_TTL_S",
        default="300",
        type="int",
        label="Media path cache TTL (seconds)",
        description="Time-to-live for media path resolution cache entries.",
        category="performance",
    ),
    AppSettingDefinition(
        key="project_folder_cache_max",
        env_var="STS_PROJECT_FOLDER_CACHE_MAX",
        default="32",
        type="int",
        label="Project folder cache max entries",
        description="LRU size for project folder listing cache.",
        category="performance",
    ),
    AppSettingDefinition(
        key="project_folder_cache_ttl_s",
        env_var="STS_PROJECT_FOLDER_CACHE_TTL_S",
        default="2.5",
        type="float",
        label="Project folder cache TTL (seconds)",
        description="Time-to-live for project folder listing cache entries.",
        category="performance",
    ),
    AppSettingDefinition(
        key="image_dim_cache_max",
        env_var="STS_IMAGE_DIM_CACHE_MAX",
        default="2000",
        type="int",
        label="Image dimension cache max entries",
        description="LRU size for cached image dimensions.",
        category="performance",
    ),
]

APP_SETTINGS_INDEX = {setting.key: setting for setting in APP_SETTINGS}

_SETTING_VALUE_CACHE_TTL_S = float(os.getenv("STS_APP_SETTINGS_CACHE_TTL_S", "2"))
_setting_value_cache: Dict[str, tuple[float, Any]] = {}


def _coerce_value(raw: Optional[str], setting_type: SettingType) -> Optional[Any]:
    if raw is None:
        return None
    value = str(raw).strip()
    if value == "":
        return None
    try:
        if setting_type == "int":
            return int(float(value))
        if setting_type == "float":
            return float(value)
        if setting_type == "bool":
            return value.lower() not in ("0", "false", "no", "off")
        return value
    except (ValueError, TypeError):
        return None


def _resolve_setting_value(defn: AppSettingDefinition, db_value: str) -> tuple[Optional[Any], str]:
    parsed_db = _coerce_value(db_value, defn.type) if db_value else None
    if parsed_db is not None:
        return parsed_db, "database"

    env_value = os.environ.get(defn.env_var, "")
    parsed_env = _coerce_value(env_value, defn.type) if env_value else None
    if parsed_env is not None:
        return parsed_env, "environment"

    parsed_default = _coerce_value(defn.default, defn.type) if defn.default is not None else None
    if parsed_default is not None:
        return parsed_default, "default"

    return None, "none"


def get_setting_definition(key: str) -> Optional[AppSettingDefinition]:
    return APP_SETTINGS_INDEX.get(key)


def get_setting_typed(key: str, default: Optional[Any] = None) -> Optional[Any]:
    """
    Resolve a typed setting value with DB -> env -> default precedence.
    Falls back to `default` if provided and no other value is set.
    """
    defn = APP_SETTINGS_INDEX.get(key)
    if not defn:
        return default

    now = time.time()
    cached = _setting_value_cache.get(key)
    if cached and now - cached[0] <= _SETTING_VALUE_CACHE_TTL_S:
        return cached[1]

    with Session(engine) as session:
        setting = session.exec(
            select(AppSetting).where(AppSetting.key == key)
        ).first()
        db_value = setting.value if setting else ""

    value, _source = _resolve_setting_value(defn, db_value)
    if value is None and default is not None:
        value = default

    _setting_value_cache[key] = (now, value)
    return value


def get_setting(key: str, default: Optional[str] = None) -> Optional[str]:
    """
    Get a setting value.
    
    Priority:
    1. Database value (if set and non-empty)
    2. Environment variable
    3. Default value
    """
    # First, check database
    with Session(engine) as session:
        setting = session.exec(
            select(AppSetting).where(AppSetting.key == key)
        ).first()
        if setting and setting.value:
            return setting.value
    
    # Fall back to environment variable
    env_var = ENV_VAR_MAPPING.get(key, key.upper())
    env_value = os.environ.get(env_var)
    if env_value:
        return env_value
    
    return default


def set_setting(key: str, value: str) -> None:
    """Set a setting value in the database."""
    with Session(engine) as session:
        setting = session.exec(
            select(AppSetting).where(AppSetting.key == key)
        ).first()
        
        if setting:
            setting.value = value
            setting.updated_at = datetime.utcnow()
        else:
            setting = AppSetting(key=key, value=value)
            session.add(setting)
        
        session.commit()
    _setting_value_cache.pop(key, None)


def get_api_keys() -> Dict[str, Any]:
    """
    Get all API key settings.
    
    Returns dict with current values (empty string if not set) and
    whether each key is configured (has any value from DB or env).
    """
    keys = [CIVITAI_API_KEY, RULE34_API_KEY, RULE34_USER_ID]
    result = {}
    
    with Session(engine) as session:
        for key in keys:
            # Get from database
            setting = session.exec(
                select(AppSetting).where(AppSetting.key == key)
            ).first()
            db_value = setting.value if setting else ""
            
            # Check env var fallback
            env_var = ENV_VAR_MAPPING.get(key, key.upper())
            env_value = os.environ.get(env_var, "")
            
            # Use DB value if set, otherwise env var
            current_value = db_value if db_value else env_value
            
            result[key] = {
                "value": current_value,
                "is_set": bool(current_value),
                "source": "database" if db_value else ("environment" if env_value else "none"),
            }
    
    return result


def set_api_keys(keys: Dict[str, str]) -> Dict[str, Any]:
    """
    Set multiple API keys at once.
    
    Args:
        keys: Dict mapping key names to values. Empty string clears the key.
    
    Returns:
        Updated API keys state.
    """
    for key, value in keys.items():
        if key in ENV_VAR_MAPPING:
            set_setting(key, value)
    
    return get_api_keys()


def get_app_settings(keys: Optional[Iterable[str]] = None) -> List[Dict[str, Any]]:
    definitions = APP_SETTINGS
    if keys:
        key_set = {k for k in keys}
        definitions = [d for d in APP_SETTINGS if d.key in key_set]

    if not definitions:
        return []

    with Session(engine) as session:
        rows = session.exec(
            select(AppSetting).where(AppSetting.key.in_([d.key for d in definitions]))
        ).all()
        db_map = {row.key: (row.value or "") for row in rows if row and row.key}

    result: List[Dict[str, Any]] = []
    for defn in definitions:
        db_value = db_map.get(defn.key, "")
        effective_value, source = _resolve_setting_value(defn, db_value)
        if effective_value is None and defn.default is not None:
            effective_value = _coerce_value(defn.default, defn.type)
            source = "default" if effective_value is not None else source
        result.append({
            "key": defn.key,
            "value": db_value,
            "effective_value": "" if effective_value is None else str(effective_value),
            "source": source,
            "env_var": defn.env_var,
            "default": defn.default or "",
            "type": defn.type,
            "label": defn.label,
            "description": defn.description,
            "category": defn.category,
        })

    return result


def set_app_settings(values: Dict[str, str]) -> List[Dict[str, Any]]:
    if not values:
        return get_app_settings()

    for key, value in values.items():
        if key in APP_SETTINGS_INDEX:
            set_setting(key, value)

    _setting_value_cache.clear()
    return get_app_settings()


# Convenience functions for specific keys
def get_civitai_api_key() -> Optional[str]:
    """Get Civitai API key from database or environment."""
    return get_setting(CIVITAI_API_KEY)


def get_rule34_api_key() -> Optional[str]:
    """Get Rule34 API key from database or environment."""
    return get_setting(RULE34_API_KEY)


def get_rule34_user_id() -> Optional[str]:
    """Get Rule34 User ID from database or environment."""
    return get_setting(RULE34_USER_ID)
