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
const ENDPOINT = "/api/v1/monitoring/client-logs";
const MAX_QUEUE = 200;
const FLUSH_INTERVAL_MS = 30000;
const MAX_BATCH = 50;

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

async function send(entries: ClientLogEntry[]) {
  if (!entries.length) return;
  const payload = JSON.stringify({ session_id: getSessionId(), entries });

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon(ENDPOINT, blob);
    return;
  }

  if (typeof fetch === "function") {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    });
  }
}

async function flush() {
  if (!queue.length) return;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    await send(batch);
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
    flush();
  });

  window.addEventListener("pagehide", () => {
    flush();
  });
}
