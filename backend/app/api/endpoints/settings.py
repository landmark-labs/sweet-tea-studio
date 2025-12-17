"""Settings API endpoints for app configuration."""
from typing import Dict, Any
from fastapi import APIRouter
from pydantic import BaseModel

from app.services import app_settings

router = APIRouter(prefix="/settings", tags=["settings"])


class ApiKeysUpdate(BaseModel):
    """Request body for updating API keys."""
    civitai_api_key: str = ""
    rule34_api_key: str = ""
    rule34_user_id: str = ""


class ApiKeyInfo(BaseModel):
    """Info about a single API key."""
    value: str
    is_set: bool
    source: str  # "database", "environment", or "none"


class ApiKeysResponse(BaseModel):
    """Response with all API key settings."""
    civitai_api_key: ApiKeyInfo
    rule34_api_key: ApiKeyInfo
    rule34_user_id: ApiKeyInfo


@router.get("/api-keys", response_model=ApiKeysResponse)
async def get_api_keys():
    """
    Get current API key settings.
    
    Returns whether each key is set and its source (database or environment).
    For security, actual key values are masked in the response.
    """
    keys = app_settings.get_api_keys()
    
    # Mask actual values for security - only show if set
    result = {}
    for key, info in keys.items():
        masked_value = ""
        if info["value"]:
            # Show first 4 and last 4 chars if long enough
            val = info["value"]
            if len(val) > 10:
                masked_value = f"{val[:4]}...{val[-4:]}"
            else:
                masked_value = "****" if val else ""
        
        result[key] = ApiKeyInfo(
            value=masked_value,
            is_set=info["is_set"],
            source=info["source"],
        )
    
    return ApiKeysResponse(**result)


@router.put("/api-keys", response_model=ApiKeysResponse)
async def update_api_keys(payload: ApiKeysUpdate):
    """
    Update API key settings.
    
    Pass empty string to clear a key (will fall back to environment variable).
    Only updates keys that are explicitly provided.
    """
    keys_to_update = {}
    
    # Only update keys that were provided in the request
    if payload.civitai_api_key is not None:
        keys_to_update[app_settings.CIVITAI_API_KEY] = payload.civitai_api_key
    if payload.rule34_api_key is not None:
        keys_to_update[app_settings.RULE34_API_KEY] = payload.rule34_api_key
    if payload.rule34_user_id is not None:
        keys_to_update[app_settings.RULE34_USER_ID] = payload.rule34_user_id
    
    # Update settings
    updated = app_settings.set_api_keys(keys_to_update)
    
    # Return masked values
    result = {}
    for key, info in updated.items():
        masked_value = ""
        if info["value"]:
            val = info["value"]
            if len(val) > 10:
                masked_value = f"{val[:4]}...{val[-4:]}"
            else:
                masked_value = "****" if val else ""
        
        result[key] = ApiKeyInfo(
            value=masked_value,
            is_set=info["is_set"],
            source=info["source"],
        )
    
    return ApiKeysResponse(**result)
