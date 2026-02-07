export type PremiumFeatureId =
  | "auto_install_nodes"
  | "dependency_fix"
  | "cloud_sync"
  | "verified_pipe_registry";

export type FeatureGateStatus =
  | "ok"
  | "grace"
  | "expired"
  | "no_entitlement"
  | "invalid_signature";

export interface EntitlementPayload {
  sub: string;
  plan: string;
  features: Record<string, boolean>;
  issued_at: string;
  expires_at: string;
  grace_expires_at: string;
  device_limit?: number;
  entitlement_id: string;
  rev: number;
}

export interface EntitlementCacheRecord {
  token: string;
  payload: EntitlementPayload;
  verified_at: string;
  last_refresh_at: string;
  signature_valid: boolean;
}

export interface EntitlementSnapshot {
  status: FeatureGateStatus;
  reason: string;
  payload: EntitlementPayload | null;
  signatureValid: boolean;
  daysUntilExpiry: number | null;
  daysUntilGraceExpiry: number | null;
  lastRefreshAt: string | null;
}

export interface FeatureGateDecision {
  allowed: boolean;
  reason: string;
  status: FeatureGateStatus;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  access_token_expires_at?: string | null;
  entitlement_jwt?: string | null;
  user_id?: string | null;
}

export interface RefreshResponse {
  access_token: string;
  access_token_expires_at?: string | null;
  refresh_token?: string | null;
  entitlement_jwt?: string | null;
}

export interface EntitlementResponse {
  entitlement_jwt: string;
}

export interface SessionMetadata {
  accessToken: string;
  accessTokenExpiresAt?: string | null;
  userId?: string | null;
  email?: string | null;
  loggedInAt: string;
  lastEntitlementRefreshAt?: string | null;
}

export interface AuthStateSnapshot {
  isAuthenticated: boolean;
  session: SessionMetadata | null;
}
