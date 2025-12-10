/**
 * StatusBar component
 * Displays system health indicators at the bottom of the app
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { labels } from "@/ui/labels";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface StatusItem {
    state: "ok" | "warn" | "error";
    detail: string;
    last_check_at?: string;
}

interface QueueStatus extends StatusItem {
    pending_jobs: number;
    oldest_job_age_s: number;
}

interface ModelsStatus extends StatusItem {
    missing_models: number;
    missing_model_names?: string[];
}

interface StatusSummary {
    engine: StatusItem;
    queue: QueueStatus;
    io: StatusItem;
    models: ModelsStatus;
}

const stateColors: Record<StatusItem["state"], string> = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    error: "bg-red-500",
};

const stateBorderColors: Record<StatusItem["state"], string> = {
    ok: "border-emerald-500/30",
    warn: "border-amber-500/30",
    error: "border-red-500/30",
};

interface StatusPillProps {
    label: string;
    status: StatusItem;
    extraInfo?: string;
}

function StatusPill({ label, status, extraInfo }: StatusPillProps) {
    const tooltipContent = extraInfo
        ? `${label}: ${status.state} – ${status.detail}\n${extraInfo}`
        : `${label}: ${status.state} – ${status.detail}`;

    return (
        <TooltipProvider delayDuration={200}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div
                        className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1 rounded-full",
                            "bg-surface/90 backdrop-blur-sm border text-xs cursor-default",
                            "transition-all duration-200 hover:bg-surface",
                            stateBorderColors[status.state]
                        )}
                    >
                        <span
                            className={cn(
                                "w-2 h-2 rounded-full transition-colors",
                                stateColors[status.state]
                            )}
                        />
                        <span className="text-muted-foreground font-medium">{label}</span>
                    </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                    <p className="whitespace-pre-wrap">{tooltipContent}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

export function StatusBar() {
    const [status, setStatus] = useState<StatusSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await fetch("/api/v1/status/summary");
                if (res.ok) {
                    const data = await res.json();
                    setStatus(data);
                }
            } catch (e) {
                console.error("Failed to fetch status:", e);
                // Set error state if we can't reach the backend
                setStatus({
                    engine: { state: "error", detail: "cannot reach backend" },
                    queue: { state: "error", detail: "unknown", pending_jobs: 0, oldest_job_age_s: 0 },
                    io: { state: "error", detail: "unknown" },
                    models: { state: "error", detail: "unknown", missing_models: 0 },
                });
            } finally {
                setIsLoading(false);
            }
        };

        fetchStatus();
        // Poll every 5 seconds
        const interval = setInterval(fetchStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    // Don't render anything while loading initially
    if (isLoading && !status) {
        return null;
    }

    if (!status) {
        return null;
    }

    // Build extra info for queue
    const queueExtraInfo =
        status.queue.pending_jobs > 0
            ? `${status.queue.pending_jobs} job(s) queued`
            : undefined;

    // Build extra info for models
    const modelsExtraInfo =
        status.models.missing_models > 0
            ? `${status.models.missing_models} model(s) missing`
            : undefined;

    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-50">
            <StatusPill label={labels.status.engine} status={status.engine} />
            <StatusPill
                label={labels.status.queue}
                status={status.queue}
                extraInfo={queueExtraInfo}
            />
            <StatusPill label={labels.status.io} status={status.io} />
            <StatusPill
                label={labels.status.models}
                status={status.models}
                extraInfo={modelsExtraInfo}
            />
        </div>
    );
}
