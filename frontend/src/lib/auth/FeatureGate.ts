import type { EntitlementCache } from "@/lib/auth/EntitlementCache";
import type { FeatureGateDecision, PremiumFeatureId } from "@/lib/auth/types";

interface FeatureGateOptions {
  entitlementCache: EntitlementCache;
  nearExpiryRefreshDays?: number;
}

const DEFAULT_NEAR_EXPIRY_REFRESH_DAYS = 2;

export class FeatureGate {
  private readonly nearExpiryRefreshDays: number;

  constructor(private readonly options: FeatureGateOptions) {
    this.nearExpiryRefreshDays =
      options.nearExpiryRefreshDays ?? DEFAULT_NEAR_EXPIRY_REFRESH_DAYS;
  }

  canUse(featureId: PremiumFeatureId): FeatureGateDecision {
    const snapshot = this.options.entitlementCache.getSnapshot();

    if (snapshot.status === "no_entitlement") {
      return {
        allowed: false,
        status: "no_entitlement",
        reason: "Sign in to access premium features.",
      };
    }

    if (snapshot.status === "invalid_signature") {
      return {
        allowed: false,
        status: "invalid_signature",
        reason: "Entitlement signature is invalid. Refresh required.",
      };
    }

    if (snapshot.status === "expired") {
      return {
        allowed: false,
        status: "expired",
        reason: "Subscription refresh required.",
      };
    }

    const featureEnabled = snapshot.payload?.features?.[featureId] === true;
    if (!featureEnabled) {
      return {
        allowed: false,
        status: snapshot.status,
        reason: "Your plan does not include this feature.",
      };
    }

    if (snapshot.status === "grace") {
      const daysLeft = Math.max(snapshot.daysUntilGraceExpiry ?? 0, 0);
      const plural = daysLeft === 1 ? "" : "s";
      return {
        allowed: true,
        status: "grace",
        reason: `Entitlement currently in grace period (${daysLeft} day${plural} remaining).`,
      };
    }

    const shouldProactivelyRefresh =
      (snapshot.daysUntilExpiry ?? Number.POSITIVE_INFINITY) <= this.nearExpiryRefreshDays;
    if (shouldProactivelyRefresh) {
      return {
        allowed: true,
        status: "ok",
        reason: "Entitlement valid. Refresh recommended soon.",
      };
    }

    return {
      allowed: true,
      status: "ok",
      reason: "Entitlement valid.",
    };
  }
}
