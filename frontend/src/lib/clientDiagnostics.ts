import { getApiBase } from "@/lib/api";

type ClientLogEntry = {
  ts: number;
  type: string;
  session_id: string;
  url?: string;
  visibility?: string;
  heap?: {
    used: number;
    total: number;
    limit: number;
  };
  data?: Record<string, unknown>;
};

const STORAGE_ENABLED_KEY = "sts_client_diag_enabled";
const STORAGE_SESSION_KEY = "sts_client_session_id";
const MAX_QUEUE = 200;
const FLUSH_INTERVAL_MS = 30000;
const MAX_BATCH = 50;
const DEFAULT_PERF_SAMPLE_RATE = 0.1;
const DEFAULT_PERF_THROTTLE_MS = 2000;
const DEFAULT_PERF_MIN_MS = 4;

let initialized = false;
let queue: ClientLogEntry[] = [];
let flushTimer: number | null = null;
const throttles = new Map<string, number>();

function isEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(STORAGE_ENABLED_KEY);
  if (raw === null) return true;
  return raw === "true";
}

function getSessionId(): string {
  if (typeof window === "undefined") return "unknown";
  const existing = window.sessionStorage.getItem(STORAGE_SESSION_KEY);
  if (existing) return existing;
  const next = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sts-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.sessionStorage.setItem(STORAGE_SESSION_KEY, next);
  return next;
}

function getHeapInfo() {
  const perf = typeof performance !== "undefined" ? (performance as any) : null;
  const mem = perf?.memory;
  if (!mem) return undefined;
  return {
    used: mem.usedJSHeapSize,
    total: mem.totalJSHeapSize,
    limit: mem.jsHeapSizeLimit,
  };
}

function enqueue(entry: ClientLogEntry) {
  queue.push(entry);
  if (queue.length > MAX_QUEUE) {
    queue = queue.slice(queue.length - MAX_QUEUE);
  }
}

function shouldSample(rate: number) {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

async function send(entries: ClientLogEntry[], preferBeacon = false) {
  if (!entries.length) return true;
  const endpoint = `${getApiBase()}/monitoring/client-logs`;
  const payload = JSON.stringify({ session_id: getSessionId(), entries });

  if (preferBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon(endpoint, blob)) {
      return true;
    }
  }

  if (typeof fetch === "function") {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    });
    return res.ok;
  }

  return false;
}

async function flush({ preferBeacon = false }: { preferBeacon?: boolean } = {}) {
  if (!queue.length) return;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    const ok = await send(batch, preferBeacon);
    if (!ok) throw new Error("client diagnostics send failed");
  } catch {
    queue = batch.concat(queue);
  }
}

export function logClientEvent(type: string, data?: Record<string, unknown>) {
  if (!isEnabled()) return;
  const entry: ClientLogEntry = {
    ts: Date.now(),
    type,
    session_id: getSessionId(),
    url: typeof window !== "undefined" ? window.location.pathname : undefined,
    visibility: typeof document !== "undefined" ? document.visibilityState : undefined,
    data,
  };
  enqueue(entry);
}

export function logClientEventThrottled(key: string, type: string, data: Record<string, unknown>, intervalMs: number) {
  if (!isEnabled()) return;
  const now = Date.now();
  const last = throttles.get(key) || 0;
  if (now - last < intervalMs) return;
  throttles.set(key, now);
  logClientEvent(type, data);
}

type PerfSampleOptions = {
  sampleRate?: number;
  throttleMs?: number;
  minMs?: number;
};

export function logClientPerfSample(
  key: string,
  type: string,
  durationMs: number,
  data: Record<string, unknown> = {},
  options: PerfSampleOptions = {}
) {
  if (!isEnabled()) return;
  const sampleRate = options.sampleRate ?? DEFAULT_PERF_SAMPLE_RATE;
  if (!shouldSample(sampleRate)) return;
  const minMs = options.minMs ?? DEFAULT_PERF_MIN_MS;
  if (durationMs < minMs) return;
  const throttleMs = options.throttleMs ?? DEFAULT_PERF_THROTTLE_MS;
  logClientEventThrottled(
    key,
    type,
    {
      duration_ms: Math.round(durationMs),
      ...data,
    },
    throttleMs
  );
}

export function logClientFrameLatency(
  key: string,
  type: string,
  startMs: number,
  data: Record<string, unknown> = {},
  options: PerfSampleOptions = {}
) {
  if (!isEnabled()) return;
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function" || typeof performance === "undefined") {
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const duration = performance.now() - startMs;
      logClientPerfSample(key, type, duration, data, options);
    });
  });
}

export function initClientDiagnostics() {
  if (initialized || !isEnabled() || typeof window === "undefined") return;
  initialized = true;

  const heartbeat = () => {
    const heap = getHeapInfo();
    if (!heap) return;
    enqueue({
      ts: Date.now(),
      type: "heartbeat",
      session_id: getSessionId(),
      url: typeof window !== "undefined" ? window.location.pathname : undefined,
      visibility: typeof document !== "undefined" ? document.visibilityState : undefined,
      heap,
    });
  };

  flushTimer = window.setInterval(() => {
    heartbeat();
    flush();
  }, FLUSH_INTERVAL_MS);

  logClientEvent("init", {
    ua: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    device_memory_gb: typeof navigator !== "undefined" && "deviceMemory" in navigator ? (navigator as any).deviceMemory : undefined,
    cpu_cores: typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined,
  });
  flush();

  window.addEventListener("error", (event) => {
    logClientEvent("error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
    flush();
  });

  window.addEventListener("unhandledrejection", (event) => {
    logClientEvent("unhandledrejection", {
      reason: String((event as PromiseRejectionEvent).reason || ""),
    });
    flush();
  });

  window.addEventListener("visibilitychange", () => {
    logClientEvent("visibility", { state: document.visibilityState });
    flush({ preferBeacon: document.visibilityState === "hidden" });
  });

  window.addEventListener("pagehide", () => {
    flush({ preferBeacon: true });
  });
}
