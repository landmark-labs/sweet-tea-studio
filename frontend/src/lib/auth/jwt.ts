import type { EntitlementPayload } from "@/lib/auth/types";

interface JwtHeader {
  alg?: string;
  typ?: string;
  kid?: string;
}

export interface JwtVerificationResult {
  valid: boolean;
  payload: EntitlementPayload | null;
  reason?: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const decodeBase64Url = (input: string): Uint8Array => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  if (typeof atob === "function") {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  const buffer = Buffer.from(padded, "base64");
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length);
};

const decodeJson = <T>(input: string): T | null => {
  try {
    const bytes = decodeBase64Url(input);
    return JSON.parse(textDecoder.decode(bytes)) as T;
  } catch {
    return null;
  }
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== "string") {
    return false;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis);
};

const normalizeEntitlementPayload = (value: unknown): EntitlementPayload | null => {
  const payload = asRecord(value);
  if (!payload) {
    return null;
  }

  const features = asRecord(payload.features);
  if (
    typeof payload.sub !== "string" ||
    typeof payload.plan !== "string" ||
    !features ||
    !isIsoDate(payload.issued_at) ||
    !isIsoDate(payload.expires_at) ||
    !isIsoDate(payload.grace_expires_at) ||
    typeof payload.entitlement_id !== "string" ||
    typeof payload.rev !== "number"
  ) {
    return null;
  }

  const normalizedFeatures: Record<string, boolean> = {};
  for (const [featureKey, featureValue] of Object.entries(features)) {
    normalizedFeatures[featureKey] = featureValue === true;
  }

  const normalized: EntitlementPayload = {
    sub: payload.sub,
    plan: payload.plan,
    features: normalizedFeatures,
    issued_at: payload.issued_at,
    expires_at: payload.expires_at,
    grace_expires_at: payload.grace_expires_at,
    entitlement_id: payload.entitlement_id,
    rev: payload.rev,
  };

  if (typeof payload.device_limit === "number") {
    normalized.device_limit = payload.device_limit;
  }

  return normalized;
};

const getSubtleCrypto = (): SubtleCrypto | null => {
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  return null;
};

const importPublicKey = async (publicKeyPem: string): Promise<CryptoKey> => {
  const subtle = getSubtleCrypto();
  if (!subtle) {
    throw new Error("Web Crypto unavailable");
  }

  const body = publicKeyPem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s+/g, "");
  const binary = decodeBase64Url(body);

  return subtle.importKey(
    "spki",
    toArrayBuffer(binary),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["verify"],
  );
};

const verifyRs256Signature = async (
  signingInput: string,
  signatureSegment: string,
  publicKeyPem: string,
): Promise<boolean> => {
  const subtle = getSubtleCrypto();
  if (!subtle) {
    return false;
  }

  const key = await importPublicKey(publicKeyPem);
  const signature = decodeBase64Url(signatureSegment);
  const payloadBytes = textEncoder.encode(signingInput);
  return subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    toArrayBuffer(signature),
    toArrayBuffer(payloadBytes),
  );
};

export const verifyEntitlementJwt = async (
  jwt: string,
  publicKeyPem: string,
): Promise<JwtVerificationResult> => {
  const segments = jwt.split(".");
  if (segments.length !== 3) {
    return { valid: false, payload: null, reason: "Malformed JWT" };
  }

  const [headerSegment, payloadSegment, signatureSegment] = segments;
  const header = decodeJson<JwtHeader>(headerSegment);
  if (!header) {
    return { valid: false, payload: null, reason: "Invalid JWT header" };
  }
  if (header.alg !== "RS256") {
    return { valid: false, payload: null, reason: "Unsupported entitlement algorithm" };
  }

  const payload = normalizeEntitlementPayload(decodeJson<Record<string, unknown>>(payloadSegment));
  if (!payload) {
    return { valid: false, payload: null, reason: "Invalid entitlement payload" };
  }

  try {
    const valid = await verifyRs256Signature(
      `${headerSegment}.${payloadSegment}`,
      signatureSegment,
      publicKeyPem,
    );
    if (!valid) {
      return { valid: false, payload: null, reason: "Invalid entitlement signature" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification failure";
    return { valid: false, payload: null, reason: message };
  }

  return { valid: true, payload };
};
