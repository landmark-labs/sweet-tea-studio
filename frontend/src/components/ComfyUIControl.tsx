import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Power, Loader2, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStatusPollingStore } from "@/lib/stores/statusPollingStore";

type ConnectionState = "connected" | "starting" | "stopped" | "stopping";

export function ComfyUIControl() {
    const [state, setState] = useState<ConnectionState>("stopped");
    const [canLaunch, setCanLaunch] = useState(false);
    const [, setLastError] = useState<string | null>(null);

    // Logs state
    const [logsOpen, setLogsOpen] = useState(false);
    const [logs, setLogs] = useState("");

    const pollingRef = useRef<NodeJS.Timeout | null>(null);
    const pollCountRef = useRef(0);
    const isStartingRef = useRef(false);
    const isStoppingRef = useRef(false);
    const engineStatus = useStatusPollingStore((statusState) => statusState.status?.engine);

    // Poll logs when dialog is open
    useEffect(() => {
        if (!logsOpen) return;

        const fetchLogs = async () => {
            try {
                const data = await api.getComfyLogs();
                setLogs(data.logs);
            } catch {
                // ignore
            }
        };

        fetchLogs();
        const interval = setInterval(fetchLogs, 2000);
        return () => clearInterval(interval);
    }, [logsOpen]);

    useEffect(() => {
        if (!engineStatus) return;
        const isConnected = engineStatus.is_connected ?? false;
        setCanLaunch(engineStatus.can_launch ?? false);
        if (!isStoppingRef.current) {
            setLastError(engineStatus.launcher_error || null);
        }

        if (isStartingRef.current || isStoppingRef.current) {
            if (isStartingRef.current && isConnected) {
                setState("connected");
                isStartingRef.current = false;
                if (pollingRef.current) {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                    pollCountRef.current = 0;
                }
            }
            if (isStoppingRef.current && !engineStatus.is_process_running && !isConnected) {
                setState("stopped");
                isStoppingRef.current = false;
                if (pollingRef.current) {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                    pollCountRef.current = 0;
                }
            }
            return;
        }

        if (isConnected) {
            setState("connected");
        } else if (engineStatus.is_process_running) {
            setState("starting");
        } else {
            setState("stopped");
        }
    }, [engineStatus]);

    // Start ComfyUI
    const handleStart = async () => {
        setState("starting");
        isStartingRef.current = true;
        setLastError(null);

        try {
            const result = await api.startComfyUI();
            if (!result.success) {
                setLastError(result.error || "Failed to start");
                setState("stopped");
                isStartingRef.current = false;
                return;
            }

            pollCountRef.current = 0;
            pollingRef.current = setInterval(async () => {
                pollCountRef.current += 1;

                try {
                    const healths = await api.getEngineHealth();
                    const isConnected = healths.length > 0 && healths[0].healthy;

                    if (isConnected) {
                        setState("connected");
                        isStartingRef.current = false;
                        if (pollingRef.current) {
                            clearInterval(pollingRef.current);
                            pollingRef.current = null;
                        }
                    } else if (pollCountRef.current > 60) {
                        setLastError("Timed out waiting for ComfyUI to start");
                        setState("stopped");
                        isStartingRef.current = false;
                        if (pollingRef.current) {
                            clearInterval(pollingRef.current);
                            pollingRef.current = null;
                        }
                    }
                } catch {
                    // Keep polling
                }
            }, 1000);
        } catch (e) {
            setLastError((e as Error)?.message || "Failed to start");
            setState("stopped");
            isStartingRef.current = false;
        }
    };

    // Stop ComfyUI
    const handleStop = async () => {
        setState("stopping");
        isStoppingRef.current = true;
        setLastError(null);

        try {
            const result = await api.stopComfyUI();
            if (!result.success && result.error) {
                setLastError(result.error);
                setState("connected");
                isStoppingRef.current = false;
                return;
            }

            pollCountRef.current = 0;
            pollingRef.current = setInterval(async () => {
                pollCountRef.current += 1;

                try {
                    const healths = await api.getEngineHealth();
                    const isConnected = healths.length > 0 && healths[0].healthy;

                    if (!isConnected) {
                        setState("stopped");
                        isStoppingRef.current = false;
                        if (pollingRef.current) {
                            clearInterval(pollingRef.current);
                            pollingRef.current = null;
                        }
                    } else if (pollCountRef.current > 15) {
                        setLastError("Timed out waiting for ComfyUI to stop");
                        setState("connected");
                        isStoppingRef.current = false;
                        if (pollingRef.current) {
                            clearInterval(pollingRef.current);
                            pollingRef.current = null;
                        }
                    }
                } catch {
                    // Keep polling
                }
            }, 1000);
        } catch (e) {
            setLastError((e as Error)?.message || "Failed to stop");
            setState("connected");
            isStoppingRef.current = false;
        }
    };

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
            }
        };
    }, []);

    const isTransitioning = state === "starting" || state === "stopping";
    const isConnected = state === "connected";
    const isStopped = state === "stopped";

    const statusColor = {
        connected: "bg-green-500",
        starting: "bg-yellow-500 animate-pulse",
        stopping: "bg-yellow-500 animate-pulse",
        stopped: "bg-red-500 animate-pulse",
    }[state];

    const statusText = {
        connected: "Running",
        starting: "Starting...",
        stopping: "Stopping...",
        stopped: "Not Running",
    }[state];

    // Container styling - more prominent when stopped
    const containerClass = cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all",
        isStopped
            ? "bg-amber-500/20 border-amber-500/50 ring-1 ring-amber-500/30"
            : "bg-muted/40 border-border/60"
    );

    return (
        <div className={containerClass}>
            {/* Status indicator */}
            <div className="flex items-center gap-1.5">
                <div className={cn("w-2 h-2 rounded-full", statusColor)} />
                <span className={cn(
                    "text-[10px] font-semibold uppercase tracking-wide",
                    isStopped ? "text-amber-600 dark:text-amber-400" : "text-foreground/80"
                )}>
                    ComfyUI
                </span>
                <span className={cn(
                    "text-[9px]",
                    isStopped ? "text-amber-600/80 dark:text-amber-400/80 font-medium" : "text-muted-foreground"
                )}>
                    {statusText}
                </span>
            </div>

            {/* Control buttons */}
            <div className="flex items-center gap-0.5 ml-1">
                {isConnected ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "h-6 w-6",
                            !isTransitioning
                                ? "text-destructive hover:text-destructive hover:bg-destructive/10"
                                : "text-muted-foreground/70 cursor-not-allowed"
                        )}
                        onClick={handleStop}
                        disabled={isTransitioning}
                        title={isTransitioning ? statusText : "Stop ComfyUI"}
                    >
                        {isTransitioning && state === "stopping" ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                            <Power className="w-3 h-3" />
                        )}
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "h-6 w-6",
                            canLaunch && !isTransitioning
                                ? "text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-500/10"
                                : "text-muted-foreground/70 cursor-not-allowed"
                        )}
                        onClick={handleStart}
                        disabled={isTransitioning || !canLaunch}
                        title={
                            isTransitioning
                                ? statusText
                                : canLaunch
                                    ? "Start ComfyUI"
                                    : "ComfyUI not configured - go to Settings"
                        }
                    >
                        {isTransitioning ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                            <Power className="w-3 h-3" />
                        )}
                    </Button>
                )}

                {/* Logs button */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    onClick={() => setLogsOpen(true)}
                    title="View ComfyUI Logs"
                >
                    <Terminal className="w-3 h-3" />
                </Button>

                {/* Logs Dialog */}
                <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
                    <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Terminal className="w-4 h-4" />
                                ComfyUI Logs
                            </DialogTitle>
                        </DialogHeader>
                        <div className="flex-1 bg-black text-green-400 font-mono text-xs p-4 rounded-md overflow-auto whitespace-pre-wrap border border-border/60">
                            {logs || "No logs available (process might not be managed by Sweet Tea)"}
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
}
