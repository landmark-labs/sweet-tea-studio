import { create } from "zustand";
import { getApiBase } from "@/lib/api";

/**
 * Centralized Status Polling Store
 * 
 * Consolidates multiple polling intervals into a single 5-second interval.
 * Components subscribe to the slices they need instead of each running their own polling.
 */

interface EngineStatus {
    state: "ok" | "warn" | "error";
    detail: string;
    is_connected?: boolean;
    can_launch?: boolean;
    is_process_running?: boolean;
    launcher_error?: string | null;
    launcher_cooldown?: number | null;
    pid?: number | null;
}

interface QueueStatus {
    state: "ok" | "warn" | "error";
    detail: string;
    pending_jobs: number;
    oldest_job_age_s: number;
}

interface ModelsStatus {
    state: "ok" | "warn" | "error";
    detail: string;
    missing_models: number;
    missing_model_names?: string[];
}

interface IOStatus {
    state: "ok" | "warn" | "error";
    detail: string;
}

interface StatusSummary {
    engine: EngineStatus;
    queue: QueueStatus;
    io: IOStatus;
    models: ModelsStatus;
}

interface StatusPollingState {
    status: StatusSummary | null;
    lastFetchedAt: number | null;
    isPolling: boolean;
    error: string | null;

    // Actions
    startPolling: () => void;
    stopPolling: () => void;
    fetchStatus: () => Promise<void>;

    // Reconnection callbacks - called when engine transitions disconnected -> connected
    registerOnReconnect: (callback: () => void) => () => void;
}

let pollingInterval: NodeJS.Timeout | null = null;
const POLL_INTERVAL_MS = 5000;
let isFetching = false;

// Track previous connection state to detect reconnections
let wasConnected: boolean | null = null;
// Callbacks to invoke on reconnection
const reconnectCallbacks = new Set<() => void>();

export const useStatusPollingStore = create<StatusPollingState>()((set, get) => ({
    status: null,
    lastFetchedAt: null,
    isPolling: false,
    error: null,

    fetchStatus: async () => {
        if (isFetching) return;
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
            return;
        }
        isFetching = true;
        try {
            const res = await fetch(`${getApiBase()}/monitoring/status/summary`);
            if (res.ok) {
                const data = await res.json();
                const isConnected = data?.engine?.is_connected ?? false;

                // Detect reconnection: was disconnected, now connected
                if (wasConnected === false && isConnected === true) {
                    console.log("[StatusPolling] Engine reconnected, triggering callbacks...");
                    reconnectCallbacks.forEach(cb => {
                        try { cb(); } catch (e) { console.error("[StatusPolling] Reconnect callback error:", e); }
                    });
                }
                wasConnected = isConnected;
                const prev = get().status;
                const hasChanged = !prev || JSON.stringify(prev) !== JSON.stringify(data);
                if (hasChanged || get().error) {
                    set({
                        status: data,
                        lastFetchedAt: Date.now(),
                        error: null
                    });
                }
            } else {
                set({ error: `HTTP ${res.status}` });
            }
        } catch (e) {
            console.error("[StatusPolling] Failed to fetch status:", e);
            set({
                error: "Cannot reach backend",
                status: {
                    engine: { state: "error", detail: "cannot reach backend", is_connected: false, can_launch: false },
                    queue: { state: "error", detail: "unknown", pending_jobs: 0, oldest_job_age_s: 0 },
                    io: { state: "error", detail: "unknown" },
                    models: { state: "error", detail: "unknown", missing_models: 0 },
                }
            });
        } finally {
            isFetching = false;
        }
    },

    startPolling: () => {
        if (pollingInterval) return; // Already polling

        const state = get();
        state.fetchStatus(); // Initial fetch

        pollingInterval = setInterval(() => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") {
                return;
            }
            void get().fetchStatus();
        }, POLL_INTERVAL_MS);

        set({ isPolling: true });
    },

    stopPolling: () => {
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
        set({ isPolling: false });
    },

    registerOnReconnect: (callback: () => void) => {
        reconnectCallbacks.add(callback);
        // Return unsubscribe function
        return () => {
            reconnectCallbacks.delete(callback);
        };
    },
}));

// Selector hooks for specific slices (prevents unnecessary re-renders)
export const useEngineStatus = () => useStatusPollingStore((state) => state.status?.engine);
export const useQueueStatus = () => useStatusPollingStore((state) => state.status?.queue);
export const useModelsStatus = () => useStatusPollingStore((state) => state.status?.models);
export const useIOStatus = () => useStatusPollingStore((state) => state.status?.io);
