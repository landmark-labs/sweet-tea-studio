/**
 * StatusBar component
 * Displays system health indicators at the bottom of the app
 * Includes ComfyUI connection state and launch button
 */
import React, { useEffect, useState } from "react";
import { getApiBase } from "@/lib/api";
import { cn } from "@/lib/utils";
import { labels } from "@/ui/labels";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Play, Loader2 } from "lucide-react";
import { useStatusPollingStore } from "@/lib/stores/statusPollingStore";

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

interface StatusPillProps {
    label: string;
    status: StatusItem;
    extraInfo?: string;
    onClick?: () => void;
    actionLabel?: string;
    actionLoading?: boolean;
    collapsed?: boolean;
}

function StatusPill({ label, status, extraInfo, onClick, actionLabel, actionLoading, collapsed }: StatusPillProps) {
    const tooltipContent = extraInfo
        ? `${label}: ${status.state} – ${status.detail}\n${extraInfo}`
        : `${label}: ${status.state} – ${status.detail}`;

    return (
        <TooltipProvider delayDuration={200}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div
                        className={cn(
                            "flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs font-medium transition-all w-full",
                            "text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-default",
                            collapsed ? "justify-center px-0 w-8 h-8 rounded-lg" : "",
                            onClick && "cursor-pointer hover:bg-primary/10 hover:text-primary"
                        )}
                        onClick={onClick}
                    >
                        <span
                            className={cn(
                                "flex-none w-2.5 h-2.5 rounded-full border-2",
                                status.state === "ok" && "bg-emerald-500/20 border-emerald-500",
                                status.state === "warn" && "bg-amber-500/20 border-amber-500",
                                status.state === "error" && "bg-red-500/20 border-red-500 animate-pulse",
                                collapsed && "w-3 h-3"
                            )}
                        />
                        {!collapsed && (
                            <div className="flex-1 flex items-center justify-between min-w-0">
                                <span className="truncate">{label}</span>
                                {actionLabel && !actionLoading && (
                                    <Play className="w-3 h-3 text-primary ml-2 flex-none" />
                                )}
                                {actionLoading && (
                                    <Loader2 className="w-3 h-3 text-primary ml-2 animate-spin flex-none" />
                                )}
                            </div>
                        )}
                    </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                    <p className="whitespace-pre-wrap">{tooltipContent}</p>
                    {actionLabel && (
                        <p className="text-primary text-xs mt-1">Click to {actionLabel}</p>
                    )}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

export const StatusBar = React.memo(function StatusBar({ collapsed }: { collapsed?: boolean }) {
    const status = useStatusPollingStore((state) => state.status) as StatusSummary | null;
    const fetchStatus = useStatusPollingStore((state) => state.fetchStatus);
    const [isLaunching, setIsLaunching] = useState(false);
    const [actionFeedback, setActionFeedback] = useState<string | null>(null);
    const [engineAction, setEngineAction] = useState<"starting" | "stopping" | null>(null);

    useEffect(() => {
        if (!status?.engine) return;
        if (engineAction === "starting" && status.engine.is_connected) {
            setEngineAction(null);
        }
        if (engineAction === "stopping" && !status.engine.is_process_running && !status.engine.is_connected) {
            setEngineAction(null);
        }
    }, [engineAction, status?.engine?.is_connected, status?.engine?.is_process_running]);

    const toggleComfyUI = async (action: "start" | "stop") => {
        setIsLaunching(true);
        setActionFeedback(null);
        setEngineAction(action === "start" ? "starting" : "stopping");
        try {
            const res = await fetch(`${getApiBase()}/monitoring/comfyui/${action}`, {
                method: "POST",
            });
            const data = await res.json();

            if (!res.ok || data.success === false) {
                const errorMessage = data.error || data.detail || "Unable to toggle ComfyUI";
                setActionFeedback(errorMessage);
                console.error("ComfyUI toggle failed:", errorMessage);
                setEngineAction(null);
            } else {
                setActionFeedback(data.message || `${action}ed ComfyUI`);
            }

            setTimeout(fetchStatus, 500);
            setTimeout(fetchStatus, 2500);
        } catch (e) {
            console.error("Failed to toggle ComfyUI:", e);
            setActionFeedback("Failed to reach backend while toggling ComfyUI");
            setEngineAction(null);
        } finally {
            setIsLaunching(false);
        }
    };

    if (!status) {
        return null;
    }

    const isProcessRunning = status.engine.is_process_running ?? status.engine.is_connected;
    const cooldownSeconds = status.engine.launcher_cooldown ?? 0;

    const engineExtraInfoParts = [] as string[];
    if (!status.engine.is_connected) {
        if (status.engine.can_launch) {
            engineExtraInfoParts.push("click to start comfyui");
        } else {
            engineExtraInfoParts.push("comfyui not detected - configure in settings");
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

    const queueExtraInfo =
        status.queue.pending_jobs > 0
            ? `${status.queue.pending_jobs} job(s) queued`
            : undefined;

    const modelsExtraInfo =
        status.models.missing_models > 0
            ? `${status.models.missing_models} model(s) missing`
            : undefined;

    const canStart = !isProcessRunning && status.engine.can_launch && (cooldownSeconds ?? 0) <= 0;
    const canStop = isProcessRunning && (cooldownSeconds ?? 0) <= 0;
    const actionLabel = canStart ? "start" : canStop ? "stop" : undefined;
    const onEngineClick = canStart
        ? () => toggleComfyUI("start")
        : canStop
            ? () => toggleComfyUI("stop")
            : undefined;

    const displayEngineStatus: EngineStatusItem = (() => {
        if (!status) return { state: "error", detail: "unknown" } as EngineStatusItem;

        if (engineAction === "starting" && !status.engine.is_connected) {
            return {
                ...status.engine,
                state: "warn",
                detail: "starting comfyui...",
            };
        }

        if (engineAction === "stopping") {
            return {
                ...status.engine,
                state: "error",
                detail: "stopping comfyui",
            };
        }

        return status.engine;
    })();

    return (
        <div className={cn("flex flex-col gap-0.5 px-2 py-2", collapsed ? "items-center" : "items-stretch")}>
            <StatusPill
                label={labels.status.engine}
                status={displayEngineStatus}
                extraInfo={engineExtraInfo}
                onClick={onEngineClick}
                actionLabel={actionLabel}
                actionLoading={isLaunching}
                collapsed={collapsed}
            />
            <StatusPill
                label={labels.status.queue}
                status={status.queue}
                extraInfo={queueExtraInfo}
                collapsed={collapsed}
            />
            <StatusPill label={labels.status.io} status={status.io} collapsed={collapsed} />
            <StatusPill
                label={labels.status.models}
                status={status.models}
                extraInfo={modelsExtraInfo}
                collapsed={collapsed}
            />
        </div>
    );
});
