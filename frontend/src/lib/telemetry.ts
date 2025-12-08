const TELEMETRY_ENDPOINT = "/api/telemetry";

export function sendTelemetryEvent(eventName: string, payload: Record<string, unknown>) {
    if (typeof window === "undefined") return;

    const body = JSON.stringify({
        event: eventName,
        payload,
        timestamp: new Date().toISOString()
    });

    try {
        if (navigator.sendBeacon) {
            const blob = new Blob([body], { type: "application/json" });
            navigator.sendBeacon(TELEMETRY_ENDPOINT, blob);
            return;
        }
    } catch (err) {
        console.debug("Telemetry beacon failed, falling back to fetch", err);
    }

    fetch(TELEMETRY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true
    }).catch((err) => {
        console.debug("Telemetry fetch failed", err);
    });
}

