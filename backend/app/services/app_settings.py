"""App settings service for managing configurable settings.

Settings are stored in the database and fall back to environment variables.
"""
import os
from datetime import datetime
from typing import Optional, Dict, Any
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
