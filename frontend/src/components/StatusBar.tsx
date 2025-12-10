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
    is_process_running?: boolean;
    launcher_error?: string | null;
    launcher_cooldown?: number | null;
    last_launcher_action_at?: string | null;
    pid?: number | null;
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
    const [actionFeedback, setActionFeedback] = useState<string | null>(null);

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

    const toggleComfyUI = async (action: "start" | "stop") => {
        setIsLaunching(true);
        setActionFeedback(null);
        try {
            const res = await fetch(`/api/v1/monitoring/comfyui/${action}`, {
                method: "POST",
            });
            const data = await res.json();

            if (!res.ok || data.success === false) {
                const errorMessage = data.error || data.detail || "Unable to toggle ComfyUI";
                setActionFeedback(errorMessage);
                console.error("ComfyUI toggle failed:", errorMessage);
            } else {
                setActionFeedback(data.message || `${action}ed ComfyUI`);
            }

            // Refresh status regardless to update UI
            setTimeout(fetchStatus, 500);
            setTimeout(fetchStatus, 2500);
        } catch (e) {
            console.error("Failed to toggle ComfyUI:", e);
            setActionFeedback("Failed to reach backend while toggling ComfyUI");
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

    const isProcessRunning = status.engine.is_process_running ?? status.engine.is_connected;
    const cooldownSeconds = status.engine.launcher_cooldown ?? 0;

    // Build extra info for engine
    const engineExtraInfoParts = [] as string[];
    if (!status.engine.is_connected) {
        if (status.engine.can_launch) {
            engineExtraInfoParts.push("click to start comfyui");
        } else {
            engineExtraInfoParts.push("comfyui not detected");
        }
    }
    if (status.engine.launcher_error) {
        engineExtraInfoParts.push(`launcher: ${status.engine.launcher_error}`);
    }
    if (actionFeedback) {
        engineExtraInfoParts.push(actionFeedback);
    }
    if (cooldownSeconds && cooldownSeconds > 0) {
        engineExtraInfoParts.push(`cooldown ${cooldownSeconds.toFixed(1)}s`);
    }
    const engineExtraInfo = engineExtraInfoParts.length ? engineExtraInfoParts.join("\n") : undefined;

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
    const canStart = !isProcessRunning && status.engine.can_launch && (cooldownSeconds ?? 0) <= 0;
    const canStop = isProcessRunning && (cooldownSeconds ?? 0) <= 0;
    const actionLabel = canStart ? "start" : canStop ? "stop" : undefined;
    const onEngineClick = canStart
        ? () => toggleComfyUI("start")
        : canStop
            ? () => toggleComfyUI("stop")
            : undefined;

    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-50">
            <StatusPill
                label={labels.status.engine}
                status={status.engine}
                extraInfo={engineExtraInfo}
                onClick={onEngineClick}
                actionLabel={actionLabel}
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
