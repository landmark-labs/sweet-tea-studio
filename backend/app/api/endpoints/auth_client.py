from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from app.services import auth_client_storage

router = APIRouter(prefix="/auth/client", tags=["auth-client"])


class JsonValuePayload(BaseModel):
    value: Any | None = None


class SecretValuePayload(BaseModel):
    value: str


@router.get("/storage-info")
def get_storage_info() -> dict[str, Any]:
    return {
        "paths": auth_client_storage.storage_paths(),
    }


@router.get("/entitlement")
def get_entitlement_cache() -> dict[str, Any]:
    return {
        "value": auth_client_storage.read_entitlement(),
        "storage_path": auth_client_storage.storage_paths()["entitlement"],
    }


@router.put("/entitlement")
def put_entitlement_cache(payload: JsonValuePayload) -> dict[str, Any]:
    if payload.value is None:
        auth_client_storage.clear_entitlement()
    else:
        auth_client_storage.write_entitlement(payload.value)
    return {"ok": True}


@router.delete("/entitlement")
def delete_entitlement_cache() -> dict[str, Any]:
    auth_client_storage.clear_entitlement()
    return {"ok": True}


@router.get("/session")
def get_session_cache() -> dict[str, Any]:
    return {
        "value": auth_client_storage.read_session(),
        "storage_path": auth_client_storage.storage_paths()["session"],
    }


@router.put("/session")
def put_session_cache(payload: JsonValuePayload) -> dict[str, Any]:
    if payload.value is None:
        auth_client_storage.clear_session()
    else:
        auth_client_storage.write_session(payload.value)
    return {"ok": True}


@router.delete("/session")
def delete_session_cache() -> dict[str, Any]:
    auth_client_storage.clear_session()
    return {"ok": True}


@router.get("/refresh-token")
def get_refresh_token() -> dict[str, Any]:
    value, strategy = auth_client_storage.read_refresh_token()
    return {
        "value": value,
        "strategy": strategy,
        "storage_path": auth_client_storage.storage_paths()["refresh_token"],
    }


@router.put("/refresh-token")
def put_refresh_token(payload: SecretValuePayload) -> dict[str, Any]:
    strategy = auth_client_storage.write_refresh_token(payload.value)
    return {
        "ok": True,
        "strategy": strategy,
    }


@router.delete("/refresh-token")
def delete_refresh_token() -> dict[str, Any]:
    auth_client_storage.clear_refresh_token()
    return {"ok": True}
