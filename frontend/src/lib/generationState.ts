/**
 * Generation State Machine
 * Provides proper state management for generation jobs
 */

export type GenerationState =
    | "idle"       // Ready to generate
    | "queued"     // Job created, waiting for ComfyUI to pick it up
    | "running"    // Active processing (receiving progress updates)
    | "completed"  // Done successfully
    | "failed"     // Error occurred
    | "cancelled"; // User cancelled

export interface ProgressStats {
    currentStep: number;
    totalSteps: number;
    startedAt: number;           // timestamp ms
    lastUpdateAt: number;        // timestamp ms
    elapsedMs: number;
    estimatedRemainingMs: number;
    iterationsPerSecond: number; // it/s - steps per second
    secondsPerIteration: number; // s/it - seconds per step
}

export interface ProgressHistoryEntry {
    step: number;
    timestamp: number;
}

const HISTORY_SIZE = 5; // Keep last 5 progress updates for smoothing

/**
 * Calculates smoothed progress statistics from history
 */
export function calculateProgressStats(
    history: ProgressHistoryEntry[],
    totalSteps: number,
    startedAt: number
): ProgressStats | null {
    if (history.length < 2) {
        // Need at least 2 points to calculate rate
        const now = Date.now();
        return {
            currentStep: history[0]?.step || 0,
            totalSteps,
            startedAt,
            lastUpdateAt: now,
            elapsedMs: now - startedAt,
            estimatedRemainingMs: 0,
            iterationsPerSecond: 0,
            secondsPerIteration: 0,
        };
    }

    const latest = history[history.length - 1];

    // Calculate instantaneous rates for each interval
    const rates: number[] = [];
    for (let i = 0; i < history.length - 1; i++) {
        const current = history[i];
        const next = history[i + 1];
        const stepDelta = next.step - current.step;
        const timeDelta = next.timestamp - current.timestamp;

        if (timeDelta > 0 && stepDelta > 0) {
            rates.push(stepDelta / timeDelta);
        }
    }

    // If we don't have enough valid intervals, fallback to overall average
    let stepsPerMs = 0;

    if (rates.length === 0) {
        // Fallback: Calculate rate from total history window
        const oldest = history[0];
        const totalStepDelta = latest.step - oldest.step;
        const totalTimeDelta = latest.timestamp - oldest.timestamp;
        if (totalTimeDelta > 0 && totalStepDelta > 0) {
            stepsPerMs = totalStepDelta / totalTimeDelta;
        }
    } else {
        // Calculate Median Rate
        rates.sort((a, b) => a - b);
        const mid = Math.floor(rates.length / 2);
        stepsPerMs = rates.length % 2 !== 0
            ? rates[mid]
            : (rates[mid - 1] + rates[mid]) / 2;
    }

    // Safety check for zero rate
    if (stepsPerMs <= 0) {
        const now = Date.now();
        return {
            currentStep: latest.step,
            totalSteps,
            startedAt,
            lastUpdateAt: latest.timestamp,
            elapsedMs: now - startedAt,
            estimatedRemainingMs: 0,
            iterationsPerSecond: 0,
            secondsPerIteration: 0,
        };
    }

    const stepsPerSecond = stepsPerMs * 1000;
    const secondsPerStep = 1 / stepsPerSecond;

    const remainingSteps = totalSteps - latest.step;
    const estimatedRemainingMs = remainingSteps > 0 ? (remainingSteps / stepsPerMs) : 0;

    const now = Date.now();

    return {
        currentStep: latest.step,
        totalSteps,
        startedAt,
        lastUpdateAt: latest.timestamp,
        elapsedMs: now - startedAt,
        estimatedRemainingMs: Math.max(0, estimatedRemainingMs),
        iterationsPerSecond: stepsPerSecond,
        secondsPerIteration: secondsPerStep,
    };
}

/**
 * Adds a progress entry to history, maintaining max size
 */
export function addProgressEntry(
    history: ProgressHistoryEntry[],
    step: number
): ProgressHistoryEntry[] {
    const newEntry = { step, timestamp: Date.now() };
    const updated = [...history, newEntry];

    // Keep only the last HISTORY_SIZE entries
    if (updated.length > HISTORY_SIZE) {
        return updated.slice(-HISTORY_SIZE);
    }
    return updated;
}

/**
 * Formats milliseconds to human-readable duration
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) return "<1s";
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Formats iteration speed
 */
export function formatSpeed(iterationsPerSecond: number): string {
    if (iterationsPerSecond >= 1) {
        return `${iterationsPerSecond.toFixed(1)} it/s`;
    } else if (iterationsPerSecond > 0) {
        return `${(1 / iterationsPerSecond).toFixed(1)} s/it`;
    }
    return "";
}

/**
 * Normalizes ComfyUI job status strings into our finite GenerationState
 */
export function mapStatusToGenerationState(status?: string): GenerationState {
    switch (status) {
        case "queued":
        case "initiating":
            return "queued";
        case "processing":
        case "executing":
        case "running":
            return "running";
        case "completed":
        case "success":
            return "completed";
        case "failed":
        case "error":
            return "failed";
        case "cancelled":
            return "cancelled";
        default:
            return "idle";
    }
}
