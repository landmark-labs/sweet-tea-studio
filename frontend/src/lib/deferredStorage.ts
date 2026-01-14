import type { StateStorage } from "zustand/middleware";

type DeferredStorageOptions = {
  flushIntervalMs?: number;
  maxPending?: number;
  useIdleCallback?: boolean;
};

const canUseIdleCallback = () =>
  typeof window !== "undefined" &&
  typeof window.requestIdleCallback === "function" &&
  typeof window.cancelIdleCallback === "function";

export function createDeferredStorage(storage: Storage, options: DeferredStorageOptions = {}): StateStorage {
  const flushIntervalMs = options.flushIntervalMs ?? 1000;
  const maxPending = options.maxPending ?? 50;
  const useIdleCallback = options.useIdleCallback ?? true;

  const pending = new Map<string, string>();
  let scheduled: { id: number | NodeJS.Timeout; type: "idle" | "timeout" } | null = null;

  const clearScheduled = () => {
    if (!scheduled) return;
    if (scheduled.type === "idle" && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(scheduled.id as number);
    } else {
      clearTimeout(scheduled.id as NodeJS.Timeout);
    }
    scheduled = null;
  };

  const flush = () => {
    if (pending.size === 0) {
      clearScheduled();
      return;
    }
    const entries = Array.from(pending.entries());
    pending.clear();
    clearScheduled();
    for (const [key, value] of entries) {
      try {
        storage.setItem(key, value);
      } catch (err) {
        console.warn("[DeferredStorage] Failed to persist", key, err);
      }
    }
  };

  const schedule = () => {
    if (scheduled) return;
    if (useIdleCallback && canUseIdleCallback()) {
      const id = window.requestIdleCallback(() => flush(), { timeout: flushIntervalMs });
      scheduled = { id, type: "idle" };
    } else {
      const id = setTimeout(() => flush(), flushIntervalMs);
      scheduled = { id, type: "timeout" };
    }
  };

  return {
    getItem: (name) => {
      if (pending.has(name)) {
        return pending.get(name) ?? null;
      }
      return storage.getItem(name);
    },
    setItem: (name, value) => {
      pending.set(name, value);
      if (pending.size >= maxPending) {
        flush();
        return;
      }
      schedule();
    },
    removeItem: (name) => {
      pending.delete(name);
      storage.removeItem(name);
    },
  };
}
