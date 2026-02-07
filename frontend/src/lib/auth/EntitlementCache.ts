import { DEFAULT_ENTITLEMENT_TTL_DAYS, DEFAULT_GRACE_PERIOD_DAYS } from "@/lib/auth/config";
import { verifyEntitlementJwt } from "@/lib/auth/jwt";
import type {
  EntitlementCacheRecord,
  EntitlementSnapshot,
  EntitlementPayload,
} from "@/lib/auth/types";
import type { JsonStore } from "@/lib/auth/storage";

const DAY_MS = 24 * 60 * 60 * 1000;

interface EntitlementCacheOptions {
  store: JsonStore<EntitlementCacheRecord>;
  publicKeyPem: string;
  now?: () => Date;
  gracePeriodDays?: number;
}

const createNoEntitlementSnapshot = (): EntitlementSnapshot => ({
  status: "no_entitlement",
  reason: "No entitlement found.",
  payload: null,
  signatureValid: false,
  daysUntilExpiry: null,
  daysUntilGraceExpiry: null,
  lastRefreshAt: null,
});

export class EntitlementCache {
  private readonly now: () => Date;
  private readonly gracePeriodDays: number;
  private readonly entitlementTtlDays: number;
  private record: EntitlementCacheRecord | null = null;
  private snapshot: EntitlementSnapshot = createNoEntitlementSnapshot();

  constructor(private readonly options: EntitlementCacheOptions) {
    this.now = options.now ?? (() => new Date());
    this.gracePeriodDays = options.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS;
    this.entitlementTtlDays = DEFAULT_ENTITLEMENT_TTL_DAYS;
  }

  private evaluateRecord(record: EntitlementCacheRecord): EntitlementSnapshot {
    const nowMs = this.now().getTime();
    const issuedMs = Date.parse(record.payload.issued_at);
    const expiryMs = Date.parse(record.payload.expires_at);
    const graceMs = Date.parse(record.payload.grace_expires_at);
    const lastRefreshAt = record.last_refresh_at ?? null;

    if (!Number.isFinite(expiryMs) || !Number.isFinite(graceMs) || !Number.isFinite(issuedMs)) {
      return {
        status: "invalid_signature",
        reason: "Entitlement payload is invalid.",
        payload: null,
        signatureValid: false,
        daysUntilExpiry: null,
        daysUntilGraceExpiry: null,
        lastRefreshAt,
      };
    }

    const cappedExpiryMs = Math.min(expiryMs, issuedMs + this.entitlementTtlDays * DAY_MS);
    const fallbackGraceMs = cappedExpiryMs + this.gracePeriodDays * DAY_MS;
    const effectiveGraceMs = Math.max(graceMs, fallbackGraceMs);
    const daysUntilExpiry = Math.ceil((cappedExpiryMs - nowMs) / DAY_MS);
    const daysUntilGraceExpiry = Math.ceil((effectiveGraceMs - nowMs) / DAY_MS);

    if (nowMs > effectiveGraceMs) {
      return {
        status: "expired",
        reason: "Entitlement expired. Subscription refresh required.",
        payload: record.payload,
        signatureValid: true,
        daysUntilExpiry,
        daysUntilGraceExpiry,
        lastRefreshAt,
      };
    }

    if (nowMs > cappedExpiryMs) {
      return {
        status: "grace",
        reason: "Entitlement is in grace period and needs refresh soon.",
        payload: record.payload,
        signatureValid: true,
        daysUntilExpiry,
        daysUntilGraceExpiry,
        lastRefreshAt,
      };
    }

    return {
      status: "ok",
      reason: "Entitlement is valid.",
      payload: record.payload,
      signatureValid: true,
      daysUntilExpiry,
      daysUntilGraceExpiry,
      lastRefreshAt,
    };
  }

  async hydrate(): Promise<EntitlementSnapshot> {
    const stored = await this.options.store.load();
    if (!stored?.token) {
      this.record = null;
      this.snapshot = createNoEntitlementSnapshot();
      return this.snapshot;
    }

    const verification = await verifyEntitlementJwt(stored.token, this.options.publicKeyPem);
    if (!verification.valid || !verification.payload) {
      this.record = null;
      this.snapshot = {
        status: "invalid_signature",
        reason: verification.reason || "Invalid entitlement signature.",
        payload: null,
        signatureValid: false,
        daysUntilExpiry: null,
        daysUntilGraceExpiry: null,
        lastRefreshAt: stored.last_refresh_at ?? null,
      };
      return this.snapshot;
    }

    this.record = {
      token: stored.token,
      payload: verification.payload,
      verified_at: stored.verified_at || this.now().toISOString(),
      last_refresh_at: stored.last_refresh_at || this.now().toISOString(),
      signature_valid: true,
    };
    this.snapshot = this.evaluateRecord(this.record);
    return this.snapshot;
  }

  async storeSignedEntitlement(token: string, refreshedAt?: string): Promise<EntitlementSnapshot> {
    const verification = await verifyEntitlementJwt(token, this.options.publicKeyPem);
    if (!verification.valid || !verification.payload) {
      this.record = null;
      this.snapshot = {
        status: "invalid_signature",
        reason: verification.reason || "Invalid entitlement signature.",
        payload: null,
        signatureValid: false,
        daysUntilExpiry: null,
        daysUntilGraceExpiry: null,
        lastRefreshAt: refreshedAt || null,
      };
      return this.snapshot;
    }

    const nowIso = this.now().toISOString();
    this.record = {
      token,
      payload: verification.payload,
      verified_at: nowIso,
      last_refresh_at: refreshedAt || nowIso,
      signature_valid: true,
    };
    await this.options.store.save(this.record);
    this.snapshot = this.evaluateRecord(this.record);
    return this.snapshot;
  }

  async clear(): Promise<void> {
    this.record = null;
    this.snapshot = createNoEntitlementSnapshot();
    await this.options.store.clear();
  }

  getSnapshot(): EntitlementSnapshot {
    if (!this.record) {
      return this.snapshot;
    }
    this.snapshot = this.evaluateRecord(this.record);
    return this.snapshot;
  }

  getPayload(): EntitlementPayload | null {
    return this.getSnapshot().payload;
  }
}
