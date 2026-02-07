import { getApiBase } from "@/lib/api";

export const DEFAULT_ENTITLEMENT_TTL_DAYS = 15;
export const DEFAULT_GRACE_PERIOD_DAYS = 7;
export const DAILY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const REFRESH_CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const NEAR_EXPIRY_REFRESH_DAYS = 2;

const DEFAULT_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3wO3PKpdHwV6dJw8zzQP
GSun3GpVmjjThD/xIHYpCYeM6kmdrmxt6zoiw+2Tj6hVp1jY89LCeFQ101SZDKdF
004huVOHzfy7poiIUchIRRdJig9ZGfry5j1Ql6KBxB73l85b1ZTeckIG4RaXSwsu
kd8jRyB0udZQftudPCM6wdDcaJkuKIzxV5eiivvG00EVubLMRc8wzanknvzA9PMI
YX5k+OCsn62pjoFcEGfZg2WiR0EVvA/flolPVkQBhKo2wdaNP2ugBCkNIALKLqVs
hQVEEbDBwvtM2Oak1cP6icT04OkZc98vhaL7+QhVToEdinTUEQQrdsSmJWv7+XQV
2QIDAQAB
-----END PUBLIC KEY-----`;

export interface AuthRuntimeConfig {
  authApiBase: string;
  entitlementPublicKeyPem: string;
  gracePeriodDays: number;
  dailyRefreshIntervalMs: number;
  nearExpiryRefreshDays: number;
}

const readGlobal = (key: string): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const container = window as unknown as Record<string, unknown>;
  const value = container[key];
  return typeof value === "string" ? value : null;
};

export const getAuthRuntimeConfig = (): AuthRuntimeConfig => {
  const runtimeAuthBase = readGlobal("__STS_AUTH_API_BASE__");
  const runtimePubKey = readGlobal("__STS_ENTITLEMENT_PUBLIC_KEY_PEM__");
  const authApiBase =
    import.meta.env.VITE_AUTH_API_BASE || runtimeAuthBase || `${getApiBase()}/auth`;
  const rawPubKey =
    import.meta.env.VITE_ENTITLEMENT_PUBLIC_KEY_PEM ||
    runtimePubKey ||
    DEFAULT_PUBLIC_KEY_PEM;
  const normalizedPubKey = rawPubKey.replace(/\\n/g, "\n").trim();

  return {
    authApiBase,
    entitlementPublicKeyPem: normalizedPubKey,
    gracePeriodDays: Number(import.meta.env.VITE_AUTH_GRACE_DAYS || DEFAULT_GRACE_PERIOD_DAYS),
    dailyRefreshIntervalMs: DAILY_REFRESH_INTERVAL_MS,
    nearExpiryRefreshDays: Number(
      import.meta.env.VITE_AUTH_NEAR_EXPIRY_REFRESH_DAYS || NEAR_EXPIRY_REFRESH_DAYS,
    ),
  };
};

export interface StorageLocationHints {
  entitlementPathWindows: string;
  entitlementPathLinux: string;
  sessionPathWindows: string;
  sessionPathLinux: string;
}

export const STORAGE_LOCATION_HINTS: StorageLocationHints = {
  entitlementPathWindows: "%APPDATA%/SweetTea/entitlement.json",
  entitlementPathLinux: "~/.config/sweettea/entitlement.json",
  sessionPathWindows: "%APPDATA%/SweetTea/session.json",
  sessionPathLinux: "~/.config/sweettea/session.json",
};
