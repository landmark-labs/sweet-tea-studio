import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EntitlementCache } from "@/lib/auth/EntitlementCache";
import type { JsonStore } from "@/lib/auth/storage";
import type { EntitlementCacheRecord, EntitlementPayload } from "@/lib/auth/types";

class MemoryJsonStore<T> implements JsonStore<T> {
  private value: T | null = null;

  async load(): Promise<T | null> {
    return this.value;
  }

  async save(value: T): Promise<void> {
    this.value = value;
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

const encodeSegment = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const signEntitlementJwt = (payload: EntitlementPayload, privateKeyPem: string): string => {
  const header = { alg: "RS256", typ: "JWT" };
  const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem).toString("base64url");
  return `${signingInput}.${signature}`;
};

const buildEntitlement = (): EntitlementPayload => ({
  sub: "user_123",
  plan: "studio_cloud",
  features: {
    auto_install_nodes: true,
    dependency_fix: true,
    cloud_sync: true,
    verified_pipe_registry: true,
  },
  issued_at: "2026-02-01T00:00:00Z",
  expires_at: "2026-03-03T00:00:00Z",
  grace_expires_at: "2026-03-10T00:00:00Z",
  device_limit: 3,
  entitlement_id: "ent_123",
  rev: 1,
});

describe("EntitlementCache", () => {
  it("verifies valid RS256 signatures and returns ok status", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const token = signEntitlementJwt(buildEntitlement(), privateKeyPem);

    const store = new MemoryJsonStore<EntitlementCacheRecord>();
    const cache = new EntitlementCache({
      store,
      publicKeyPem,
      now: () => new Date("2026-02-15T00:00:00Z"),
      gracePeriodDays: 7,
    });

    const snapshot = await cache.storeSignedEntitlement(token);

    expect(snapshot.status).toBe("ok");
    expect(snapshot.signatureValid).toBe(true);
    expect(snapshot.payload?.sub).toBe("user_123");
    expect(snapshot.daysUntilExpiry).toBeGreaterThan(0);
  });

  it("rejects invalid signatures", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const token = signEntitlementJwt(buildEntitlement(), privateKeyPem);
    const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
    const parsedPayload = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8"),
    ) as EntitlementPayload;
    parsedPayload.plan = "tampered_plan";
    const tamperedPayloadSegment = Buffer.from(
      JSON.stringify(parsedPayload),
      "utf8",
    ).toString("base64url");
    const tampered = `${headerSegment}.${tamperedPayloadSegment}.${signatureSegment}`;

    const store = new MemoryJsonStore<EntitlementCacheRecord>();
    const cache = new EntitlementCache({
      store,
      publicKeyPem,
      now: () => new Date("2026-02-15T00:00:00Z"),
    });

    const snapshot = await cache.storeSignedEntitlement(tampered);

    expect(snapshot.status).toBe("invalid_signature");
    expect(snapshot.signatureValid).toBe(false);
  });

  it("enters grace after expires_at and before grace_expires_at", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const token = signEntitlementJwt(buildEntitlement(), privateKeyPem);

    const store = new MemoryJsonStore<EntitlementCacheRecord>();
    const cache = new EntitlementCache({
      store,
      publicKeyPem,
      now: () => new Date("2026-03-05T00:00:00Z"),
    });

    const snapshot = await cache.storeSignedEntitlement(token);

    expect(snapshot.status).toBe("grace");
    expect(snapshot.signatureValid).toBe(true);
    expect(snapshot.daysUntilGraceExpiry).toBeGreaterThan(0);
  });

  it("expires beyond grace_expires_at", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const token = signEntitlementJwt(buildEntitlement(), privateKeyPem);

    const store = new MemoryJsonStore<EntitlementCacheRecord>();
    const cache = new EntitlementCache({
      store,
      publicKeyPem,
      now: () => new Date("2026-03-20T00:00:00Z"),
    });

    const snapshot = await cache.storeSignedEntitlement(token);

    expect(snapshot.status).toBe("expired");
    expect(snapshot.signatureValid).toBe(true);
    expect(snapshot.daysUntilGraceExpiry).toBeLessThan(0);
  });
});
