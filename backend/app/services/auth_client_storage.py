from __future__ import annotations

import base64
import getpass
import hashlib
import hmac
import json
import os
import platform
from pathlib import Path
from typing import Any, Literal

from app.core.config import settings

SERVICE_NAME = "SweetTeaStudio"
REFRESH_TOKEN_NAME = "refresh_token"


def _storage_root() -> Path:
    system = platform.system().lower()
    if system.startswith("win"):
        appdata = os.getenv("APPDATA")
        if appdata:
            return Path(appdata) / "SweetTea"
        return Path.home() / "AppData" / "Roaming" / "SweetTea"
    if system.startswith("linux"):
        return Path.home() / ".config" / "sweettea"
    return settings.meta_dir / "auth"


def _ensure_root() -> Path:
    root = _storage_root()
    root.mkdir(parents=True, exist_ok=True)
    return root


def entitlement_path() -> Path:
    return _ensure_root() / "entitlement.json"


def session_path() -> Path:
    return _ensure_root() / "session.json"


def refresh_token_path() -> Path:
    return _ensure_root() / "refresh_token.enc"


def _read_json(path: Path) -> Any | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def read_entitlement() -> Any | None:
    return _read_json(entitlement_path())


def write_entitlement(value: Any) -> None:
    _write_json(entitlement_path(), value)


def clear_entitlement() -> None:
    entitlement_path().unlink(missing_ok=True)


def read_session() -> Any | None:
    return _read_json(session_path())


def write_session(value: Any) -> None:
    _write_json(session_path(), value)


def clear_session() -> None:
    session_path().unlink(missing_ok=True)


def _secret_material() -> bytes:
    user = getpass.getuser()
    node = platform.node()
    machine = f"{platform.system()}|{platform.release()}"
    return f"{user}|{node}|{machine}".encode("utf-8")


def _derive_key(salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", _secret_material(), salt, 200_000, dklen=32)


def _xor_keystream(data: bytes, key: bytes, nonce: bytes) -> bytes:
    output = bytearray(len(data))
    written = 0
    counter = 0
    while written < len(data):
        counter_bytes = counter.to_bytes(4, byteorder="big")
        block = hmac.new(key, nonce + counter_bytes, hashlib.sha256).digest()
        take = min(len(block), len(data) - written)
        for index in range(take):
            output[written + index] = data[written + index] ^ block[index]
        written += take
        counter += 1
    return bytes(output)


def _encrypt_to_file(token: str) -> None:
    salt = os.urandom(16)
    nonce = os.urandom(16)
    key = _derive_key(salt)
    plaintext = token.encode("utf-8")
    ciphertext = _xor_keystream(plaintext, key, nonce)
    mac = hmac.new(key, nonce + ciphertext, hashlib.sha256).digest()
    payload = {
        "salt": base64.b64encode(salt).decode("utf-8"),
        "nonce": base64.b64encode(nonce).decode("utf-8"),
        "ciphertext": base64.b64encode(ciphertext).decode("utf-8"),
        "mac": base64.b64encode(mac).decode("utf-8"),
    }
    _write_json(refresh_token_path(), payload)


def _decrypt_from_file() -> str | None:
    payload = _read_json(refresh_token_path())
    if not isinstance(payload, dict):
        return None

    try:
        salt = base64.b64decode(payload["salt"])
        nonce = base64.b64decode(payload["nonce"])
        ciphertext = base64.b64decode(payload["ciphertext"])
        mac = base64.b64decode(payload["mac"])
    except Exception:
        return None

    key = _derive_key(salt)
    expected_mac = hmac.new(key, nonce + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(mac, expected_mac):
        return None

    plaintext = _xor_keystream(ciphertext, key, nonce)
    try:
        return plaintext.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _read_keyring_token() -> str | None:
    try:
        import keyring

        return keyring.get_password(SERVICE_NAME, REFRESH_TOKEN_NAME)
    except Exception:
        return None


def _write_keyring_token(token: str) -> bool:
    try:
        import keyring

        keyring.set_password(SERVICE_NAME, REFRESH_TOKEN_NAME, token)
        return True
    except Exception:
        return False


def _clear_keyring_token() -> None:
    try:
        import keyring

        keyring.delete_password(SERVICE_NAME, REFRESH_TOKEN_NAME)
    except Exception:
        return


def read_refresh_token() -> tuple[str | None, Literal["native_secure_store", "encrypted_local_storage", "none"]]:
    keyring_value = _read_keyring_token()
    if keyring_value:
        return keyring_value, "native_secure_store"

    file_value = _decrypt_from_file()
    if file_value:
        return file_value, "encrypted_local_storage"

    return None, "none"


def write_refresh_token(token: str) -> Literal["native_secure_store", "encrypted_local_storage"]:
    if _write_keyring_token(token):
        refresh_token_path().unlink(missing_ok=True)
        return "native_secure_store"

    _encrypt_to_file(token)
    return "encrypted_local_storage"


def clear_refresh_token() -> None:
    _clear_keyring_token()
    refresh_token_path().unlink(missing_ok=True)


def storage_paths() -> dict[str, str]:
    return {
        "root": str(_ensure_root()),
        "entitlement": str(entitlement_path()),
        "session": str(session_path()),
        "refresh_token": str(refresh_token_path()),
    }
