import { getApiBase } from "@/lib/api";
import type { EntitlementCacheRecord, SessionMetadata } from "@/lib/auth/types";

const ENTITLEMENT_STORAGE_KEY = "sts_auth_entitlement_cache_v1";
const SESSION_STORAGE_KEY = "sts_auth_session_v1";
const SECRET_STORAGE_KEY = "sts_auth_refresh_token_cipher_v1";
const SECRET_STORAGE_SALT_KEY = "sts_auth_refresh_token_salt_v1";

const AUTH_CLIENT_STORAGE_BASE = `${getApiBase()}/auth/client`;

export type RefreshTokenStorageStrategy =
  | "native_secure_store"
  | "encrypted_local_storage";

export interface JsonStore<T> {
  load(): Promise<T | null>;
  save(value: T): Promise<void>;
  clear(): Promise<void>;
}

export interface SecureSecretStore {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
  getStrategy(): RefreshTokenStorageStrategy;
}

const parseJson = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const bytesToBase64 = (bytes: Uint8Array): string => {
  if (typeof btoa === "function") {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
};

const base64ToBytes = (encoded: string): Uint8Array => {
  if (typeof atob === "function") {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  const buffer = Buffer.from(encoded, "base64");
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length);
};

class LocalJsonStore<T> implements JsonStore<T> {
  constructor(private readonly storageKey: string) {}

  async load(): Promise<T | null> {
    if (typeof window === "undefined") return null;
    return parseJson<T>(window.localStorage.getItem(this.storageKey));
  }

  async save(value: T): Promise<void> {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(this.storageKey, JSON.stringify(value));
  }

  async clear(): Promise<void> {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(this.storageKey);
  }
}

type BackendJsonResponse<T> = { value?: T | null };

class BackendJsonStore<T> implements JsonStore<T> {
  private disabled = false;

  constructor(
    private readonly path: "entitlement" | "session",
    private readonly fallback: JsonStore<T>,
  ) {}

  private async getFromBackend(): Promise<T | null> {
    if (this.disabled) {
      return this.fallback.load();
    }
    try {
      const response = await fetch(`${AUTH_CLIENT_STORAGE_BASE}/${this.path}`, {
        method: "GET",
      });
      if (response.status === 404 || response.status === 501) {
        this.disabled = true;
        return this.fallback.load();
      }
      if (!response.ok) {
        throw new Error(`Load failed (${response.status})`);
      }
      const data = (await response.json()) as BackendJsonResponse<T>;
      if (typeof data.value === "undefined") {
        return null;
      }
      return data.value ?? null;
    } catch {
      this.disabled = true;
      return this.fallback.load();
    }
  }

  private async saveToBackend(value: T): Promise<void> {
    if (this.disabled) {
      await this.fallback.save(value);
      return;
    }

    try {
      const response = await fetch(`${AUTH_CLIENT_STORAGE_BASE}/${this.path}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value }),
      });
      if (response.status === 404 || response.status === 501) {
        this.disabled = true;
        await this.fallback.save(value);
        return;
      }
      if (!response.ok) {
        throw new Error(`Save failed (${response.status})`);
      }
      await this.fallback.save(value);
    } catch {
      this.disabled = true;
      await this.fallback.save(value);
    }
  }

  private async clearInBackend(): Promise<void> {
    if (this.disabled) {
      await this.fallback.clear();
      return;
    }

    try {
      const response = await fetch(`${AUTH_CLIENT_STORAGE_BASE}/${this.path}`, {
        method: "DELETE",
      });
      if (response.status === 404 || response.status === 501) {
        this.disabled = true;
      } else if (!response.ok) {
        throw new Error(`Clear failed (${response.status})`);
      }
    } catch {
      this.disabled = true;
    } finally {
      await this.fallback.clear();
    }
  }

  async load(): Promise<T | null> {
    return this.getFromBackend();
  }

  async save(value: T): Promise<void> {
    await this.saveToBackend(value);
  }

  async clear(): Promise<void> {
    await this.clearInBackend();
  }
}

interface BackendSecretResponse {
  value?: string | null;
  strategy?: RefreshTokenStorageStrategy | "none";
}

class EncryptedLocalSecretStore implements SecureSecretStore {
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();

  private getSubtle(): SubtleCrypto | null {
    if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
      return globalThis.crypto.subtle;
    }
    return null;
  }

  private getFingerprint(): string {
    if (typeof window === "undefined") {
      return "sweet-tea-auth";
    }
    return `${window.location.origin}|${navigator.userAgent}|${navigator.platform}`;
  }

  private getSalt(): Uint8Array {
    if (typeof window === "undefined") return new Uint8Array(16);

    const existing = window.localStorage.getItem(SECRET_STORAGE_SALT_KEY);
    if (existing) {
      return base64ToBytes(existing);
    }

    const salt = new Uint8Array(16);
    globalThis.crypto.getRandomValues(salt);
    window.localStorage.setItem(SECRET_STORAGE_SALT_KEY, bytesToBase64(salt));
    return salt;
  }

  private async deriveKey(): Promise<CryptoKey | null> {
    const subtle = this.getSubtle();
    if (!subtle) return null;

    const keyMaterial = await subtle.importKey(
      "raw",
      this.textEncoder.encode(this.getFingerprint()),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: toArrayBuffer(this.getSalt()),
        iterations: 150_000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  async load(): Promise<string | null> {
    if (typeof window === "undefined") return null;

    const subtle = this.getSubtle();
    const serialized = window.localStorage.getItem(SECRET_STORAGE_KEY);
    if (!serialized) return null;
    if (!subtle) return null;

    try {
      const parsed = JSON.parse(serialized) as { iv: string; ciphertext: string };
      const iv = base64ToBytes(parsed.iv);
      const ciphertext = base64ToBytes(parsed.ciphertext);
      const key = await this.deriveKey();
      if (!key) return null;
      const plaintextBuffer = await subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(iv) },
        key,
        toArrayBuffer(ciphertext),
      );
      return this.textDecoder.decode(plaintextBuffer);
    } catch {
      return null;
    }
  }

  async save(value: string): Promise<void> {
    if (typeof window === "undefined") return;
    const subtle = this.getSubtle();
    if (!subtle) return;

    const iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);
    const key = await this.deriveKey();
    if (!key) return;

    const cipherBuffer = await subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(this.textEncoder.encode(value)),
    );

    const payload = {
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
    };
    window.localStorage.setItem(SECRET_STORAGE_KEY, JSON.stringify(payload));
  }

  async clear(): Promise<void> {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(SECRET_STORAGE_KEY);
  }

  getStrategy(): RefreshTokenStorageStrategy {
    return "encrypted_local_storage";
  }
}

class BackendSecretStore implements SecureSecretStore {
  private disabled = false;
  private strategy: RefreshTokenStorageStrategy = "native_secure_store";

  constructor(private readonly fallback: SecureSecretStore) {}

  async load(): Promise<string | null> {
    if (this.disabled) return this.fallback.load();
    try {
      const response = await fetch(`${AUTH_CLIENT_STORAGE_BASE}/refresh-token`, {
        method: "GET",
      });
      if (response.status === 404 || response.status === 501) {
        this.disabled = true;
        return this.fallback.load();
      }
      if (!response.ok) {
        throw new Error(`Load failed (${response.status})`);
      }
      const data = (await response.json()) as BackendSecretResponse;
      if (data.strategy === "encrypted_local_storage") {
        this.strategy = "encrypted_local_storage";
      } else if (data.strategy === "native_secure_store") {
        this.strategy = "native_secure_store";
      }
      if (typeof data.value === "string") {
        return data.value;
      }
      return null;
    } catch {
      this.disabled = true;
      return this.fallback.load();
    }
  }

  async save(value: string): Promise<void> {
    if (this.disabled) {
      await this.fallback.save(value);
      return;
    }
    try {
      const response = await fetch(`${AUTH_CLIENT_STORAGE_BASE}/refresh-token`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value }),
      });
      if (response.status === 404 || response.status === 501) {
        this.disabled = true;
        await this.fallback.save(value);
        return;
      }
      if (!response.ok) {
        throw new Error(`Save failed (${response.status})`);
      }
      const data = (await response.json().catch(() => ({}))) as BackendSecretResponse;
      if (data.strategy === "encrypted_local_storage") {
        this.strategy = "encrypted_local_storage";
      } else if (data.strategy === "native_secure_store") {
        this.strategy = "native_secure_store";
      }
      await this.fallback.save(value);
    } catch {
      this.disabled = true;
      await this.fallback.save(value);
    }
  }

  async clear(): Promise<void> {
    if (this.disabled) {
      await this.fallback.clear();
      return;
    }
    try {
      const response = await fetch(`${AUTH_CLIENT_STORAGE_BASE}/refresh-token`, {
        method: "DELETE",
      });
      if (response.status === 404 || response.status === 501) {
        this.disabled = true;
      } else if (!response.ok) {
        throw new Error(`Clear failed (${response.status})`);
      }
    } catch {
      this.disabled = true;
    } finally {
      await this.fallback.clear();
    }
  }

  getStrategy(): RefreshTokenStorageStrategy {
    return this.disabled ? this.fallback.getStrategy() : this.strategy;
  }
}

export interface AuthStorageBundle {
  entitlementStore: JsonStore<EntitlementCacheRecord>;
  sessionStore: JsonStore<SessionMetadata>;
  refreshTokenStore: SecureSecretStore;
}

export const createAuthStorage = (): AuthStorageBundle => {
  const localEntitlementStore = new LocalJsonStore<EntitlementCacheRecord>(
    ENTITLEMENT_STORAGE_KEY,
  );
  const localSessionStore = new LocalJsonStore<SessionMetadata>(SESSION_STORAGE_KEY);
  const encryptedSecretStore = new EncryptedLocalSecretStore();

  return {
    entitlementStore: new BackendJsonStore<EntitlementCacheRecord>(
      "entitlement",
      localEntitlementStore,
    ),
    sessionStore: new BackendJsonStore<SessionMetadata>("session", localSessionStore),
    refreshTokenStore: new BackendSecretStore(encryptedSecretStore),
  };
};
