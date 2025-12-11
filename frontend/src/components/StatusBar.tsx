/**
 * StatusBar component
 * Displays system health indicators at the bottom of the app
 * Includes ComfyUI connection state and launch button
 */
import { useEffect, useState } from "react";
import { api, ComfyLaunchConfig } from "@/lib/api";
import { cn } from "@/lib/utils";
import { labels } from "@/ui/labels";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Play, Loader2, Settings2 } from "lucide-react";

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
    const [engineAction, setEngineAction] = useState<"starting" | "stopping" | null>(null);
    const [configDialogOpen, setConfigDialogOpen] = useState(false);
    const [launchConfig, setLaunchConfig] = useState<ComfyLaunchConfig | null>(null);
    const [pathInput, setPathInput] = useState("");
    const [argsInput, setArgsInput] = useState("");
    const [configError, setConfigError] = useState<string | null>(null);
    const [configLoading, setConfigLoading] = useState(false);
    const [configSaving, setConfigSaving] = useState(false);

    const fetchStatus = async () => {
        try {
            const res = await fetch("/api/v1/monitoring/status/summary");
            if (res.ok) {
                const data = await res.json();
                setStatus(data);

                // Clear transient action states once the backend reflects the target state
                if (data?.engine) {
                    if (engineAction === "starting" && data.engine.is_connected) {
                        setEngineAction(null);
                    }

                    if (engineAction === "stopping" && !data.engine.is_process_running && !data.engine.is_connected) {
                        setEngineAction(null);
                    }
                }
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
        setEngineAction(action === "start" ? "starting" : "stopping");
        try {
            const res = await fetch(`/api/v1/monitoring/comfyui/${action}`, {
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

            // Refresh status regardless to update UI
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

    const loadLaunchConfig = async () => {
        setConfigLoading(true);
        setConfigError(null);
        try {
            const config = await api.getComfyUILaunchConfig();
            setLaunchConfig(config);
            setPathInput(config.path || "");
            setArgsInput((config.args || []).join(" "));
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to load ComfyUI settings";
            setConfigError(message);
        } finally {
            setConfigLoading(false);
        }
    };

    const handleSaveLaunchConfig = async () => {
        setConfigSaving(true);
        setConfigError(null);
        try {
            const payload = {
                path: pathInput.trim() === "" ? null : pathInput.trim(),
                args: argsInput.trim() === "" ? null : argsInput.trim(),
            };

            const updated = await api.saveComfyUILaunchConfig(payload);
            setLaunchConfig(updated);
            setConfigDialogOpen(false);
            fetchStatus();
        } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to save ComfyUI settings";
            setConfigError(message);
        } finally {
            setConfigSaving(false);
        }
    };

    useEffect(() => {
        if (configDialogOpen) {
            loadLaunchConfig();
        }
    }, [configDialogOpen]);

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

    const displayEngineStatus: EngineStatusItem = (() => {
        if (!status) return { state: "error", detail: "unknown" } as EngineStatusItem;

        // Show transitional colors while the launch/stop command is in flight
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
        <>
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-50">
                <div className="flex items-center gap-1.5">
                    <StatusPill
                        label={labels.status.engine}
                        status={displayEngineStatus}
                        extraInfo={engineExtraInfo}
                        onClick={onEngineClick}
                        actionLabel={actionLabel}
                        actionLoading={isLaunching}
                    />
                    <TooltipProvider delayDuration={200}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => setConfigDialogOpen(true)}
                                >
                                    <Settings2 className="h-4 w-4" />
                                    <span className="sr-only">Configure ComfyUI</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">configure ComfyUI path & args</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
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

            <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>ComfyUI launch settings</DialogTitle>
                        <DialogDescription>
                            Point Sweet Tea Studio at your ComfyUI folder and optional launch arguments.
                            Leave fields blank to fall back to automatic detection and defaults.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="comfy-path">ComfyUI folder</Label>
                            <Input
                                id="comfy-path"
                                placeholder="/path/to/ComfyUI"
                                value={pathInput}
                                onChange={(e) => setPathInput(e.target.value)}
                                disabled={configLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                Leave blank to let Sweet Tea Studio autodetect ComfyUI.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="comfy-args">Launch arguments</Label>
                            <Input
                                id="comfy-args"
                                placeholder="--listen --port 8188"
                                value={argsInput}
                                onChange={(e) => setArgsInput(e.target.value)}
                                disabled={configLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                                Optional flags passed to ComfyUI. Leave empty to use defaults.
                            </p>
                        </div>

                        {launchConfig && (
                            <p className="text-xs text-muted-foreground">
                                Using {launchConfig.detection_method || "unknown method"} • port {launchConfig.port}
                            </p>
                        )}

                        {configError && <p className="text-sm text-destructive">{configError}</p>}
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="ghost" onClick={() => setConfigDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSaveLaunchConfig} disabled={configSaving || configLoading}>
                            {configSaving ? "Saving..." : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
