export type IdleHandle = { id: number | NodeJS.Timeout; type: "idle" | "timeout" };

export function scheduleIdle(callback: () => void, options: { timeout?: number; delayMs?: number } = {}): IdleHandle {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: options.timeout ?? 500 });
    return { id, type: "idle" };
  }
  const id = setTimeout(callback, options.delayMs ?? 0);
  return { id, type: "timeout" };
}

export function cancelIdle(handle: IdleHandle | null) {
  if (!handle) return;
  if (handle.type === "idle" && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(handle.id as number);
  } else {
    clearTimeout(handle.id as NodeJS.Timeout);
  }
}
