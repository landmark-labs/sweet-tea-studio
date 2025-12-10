/**
 * StatusBar component
 * Displays system health indicators at the bottom of the app
 * Includes ComfyUI connection state and launch button
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
import { Play, Loader2 } from "lucide-react";

interface StatusItem {
    state: "ok" | "warn" | "error";
    detail: string;
    last_check_at?: string;
}

interface EngineStatusItem extends StatusItem {
    is_connected?: boolean;
    can_launch?: boolean;
    comfy_path?: string;
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
    engine: EngineStatusItem;
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
    onClick?: () => void;
    actionLabel?: string;
    actionLoading?: boolean;
}

function StatusPill({ label, status, extraInfo, onClick, actionLabel, actionLoading }: StatusPillProps) {
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
                            stateBorderColors[status.state],
                            onClick && "cursor-pointer hover:ring-1 hover:ring-primary/30"
                        )}
                        onClick={onClick}
                    >
                        <span
                            className={cn(
                                "w-2 h-2 rounded-full transition-colors",
                                stateColors[status.state],
                                status.state === "error" && "animate-pulse"
                            )}
                        />
                        <span className="text-muted-foreground font-medium">{label}</span>
                        {actionLabel && !actionLoading && (
                            <Play className="w-3 h-3 text-primary ml-1" />
                        )}
                        {actionLoading && (
                            <Loader2 className="w-3 h-3 text-primary ml-1 animate-spin" />
                        )}
                    </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                    <p className="whitespace-pre-wrap">{tooltipContent}</p>
                    {actionLabel && (
                        <p className="text-primary text-xs mt-1">Click to {actionLabel}</p>
                    )}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

export function StatusBar() {
    const [status, setStatus] = useState<StatusSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isLaunching, setIsLaunching] = useState(false);

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
                engine: { state: "error", detail: "cannot reach backend", is_connected: false, can_launch: false },
                queue: { state: "error", detail: "unknown", pending_jobs: 0, oldest_job_age_s: 0 },
                io: { state: "error", detail: "unknown" },
                models: { state: "error", detail: "unknown", missing_models: 0 },
            });
        } finally {
            setIsLoading(false);
        }
    };

    const launchComfyUI = async () => {
        setIsLaunching(true);
        try {
            const res = await fetch("/api/v1/engines/comfyui/launch", {
                method: "POST",
            });
            if (res.ok) {
                // Poll more frequently after launch
                setTimeout(fetchStatus, 2000);
                setTimeout(fetchStatus, 5000);
                setTimeout(fetchStatus, 10000);
            } else {
                const data = await res.json();
                console.error("Failed to launch ComfyUI:", data.detail);
            }
        } catch (e) {
            console.error("Failed to launch ComfyUI:", e);
        } finally {
            setIsLaunching(false);
        }
    };

    useEffect(() => {
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

    // Build extra info for engine
    const engineExtraInfo = status.engine.is_connected
        ? undefined
        : status.engine.can_launch
            ? "click to launch comfyui"
            : "comfyui not detected";

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

    // Determine if engine pill should be clickable
    const canLaunch = !status.engine.is_connected && status.engine.can_launch;

    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-50">
            <StatusPill
                label={labels.status.engine}
                status={status.engine}
                extraInfo={engineExtraInfo}
                onClick={canLaunch ? launchComfyUI : undefined}
                actionLabel={canLaunch ? "launch" : undefined}
                actionLoading={isLaunching}
            />
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
