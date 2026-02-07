import { describe, expect, it } from "vitest";
import { FeatureGate } from "@/lib/auth/FeatureGate";
import type { EntitlementCache } from "@/lib/auth/EntitlementCache";
import type { EntitlementSnapshot } from "@/lib/auth/types";

const makeGate = (snapshot: EntitlementSnapshot): FeatureGate =>
  new FeatureGate({
    entitlementCache: {
      getSnapshot: () => snapshot,
    } as unknown as EntitlementCache,
  });

describe("FeatureGate.canUse", () => {
  it("returns no_entitlement when entitlement is missing", () => {
    const gate = makeGate({
      status: "no_entitlement",
      reason: "No entitlement found.",
      payload: null,
      signatureValid: false,
      daysUntilExpiry: null,
      daysUntilGraceExpiry: null,
      lastRefreshAt: null,
    });

    const decision = gate.canUse("auto_install_nodes");
    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe("no_entitlement");
  });

  it("allows enabled features while entitlement is valid", () => {
    const gate = makeGate({
      status: "ok",
      reason: "Entitlement is valid.",
      payload: {
        sub: "user_1",
        plan: "studio_cloud",
        features: { auto_install_nodes: true },
        issued_at: "2026-02-01T00:00:00Z",
        expires_at: "2026-03-03T00:00:00Z",
        grace_expires_at: "2026-03-10T00:00:00Z",
        entitlement_id: "ent_1",
        rev: 1,
      },
      signatureValid: true,
      daysUntilExpiry: 12,
      daysUntilGraceExpiry: 19,
      lastRefreshAt: "2026-02-07T00:00:00Z",
    });

    const decision = gate.canUse("auto_install_nodes");
    expect(decision.allowed).toBe(true);
    expect(decision.status).toBe("ok");
  });

  it("blocks features that are not included in the plan", () => {
    const gate = makeGate({
      status: "ok",
      reason: "Entitlement is valid.",
      payload: {
        sub: "user_2",
        plan: "tea_time",
        features: { auto_install_nodes: false },
        issued_at: "2026-02-01T00:00:00Z",
        expires_at: "2026-03-03T00:00:00Z",
        grace_expires_at: "2026-03-10T00:00:00Z",
        entitlement_id: "ent_2",
        rev: 1,
      },
      signatureValid: true,
      daysUntilExpiry: 8,
      daysUntilGraceExpiry: 15,
      lastRefreshAt: "2026-02-07T00:00:00Z",
    });

    const decision = gate.canUse("auto_install_nodes");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("does not include");
  });

  it("allows feature access in grace status with warning reason", () => {
    const gate = makeGate({
      status: "grace",
      reason: "Entitlement is in grace period and needs refresh soon.",
      payload: {
        sub: "user_3",
        plan: "studio_cloud",
        features: { auto_install_nodes: true },
        issued_at: "2026-02-01T00:00:00Z",
        expires_at: "2026-03-03T00:00:00Z",
        grace_expires_at: "2026-03-10T00:00:00Z",
        entitlement_id: "ent_3",
        rev: 1,
      },
      signatureValid: true,
      daysUntilExpiry: -2,
      daysUntilGraceExpiry: 4,
      lastRefreshAt: "2026-02-07T00:00:00Z",
    });

    const decision = gate.canUse("auto_install_nodes");
    expect(decision.allowed).toBe(true);
    expect(decision.status).toBe("grace");
    expect(decision.reason).toContain("grace period");
  });

  it("blocks access when entitlement is expired", () => {
    const gate = makeGate({
      status: "expired",
      reason: "Entitlement expired.",
      payload: {
        sub: "user_4",
        plan: "studio_cloud",
        features: { auto_install_nodes: true },
        issued_at: "2026-02-01T00:00:00Z",
        expires_at: "2026-03-03T00:00:00Z",
        grace_expires_at: "2026-03-10T00:00:00Z",
        entitlement_id: "ent_4",
        rev: 1,
      },
      signatureValid: true,
      daysUntilExpiry: -10,
      daysUntilGraceExpiry: -2,
      lastRefreshAt: "2026-02-07T00:00:00Z",
    });

    const decision = gate.canUse("auto_install_nodes");
    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe("expired");
  });

  it("blocks when signature is invalid", () => {
    const gate = makeGate({
      status: "invalid_signature",
      reason: "Invalid signature",
      payload: null,
      signatureValid: false,
      daysUntilExpiry: null,
      daysUntilGraceExpiry: null,
      lastRefreshAt: "2026-02-07T00:00:00Z",
    });

    const decision = gate.canUse("auto_install_nodes");
    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe("invalid_signature");
  });
});
