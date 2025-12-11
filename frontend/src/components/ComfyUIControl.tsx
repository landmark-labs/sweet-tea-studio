import { useState, useEffect, useCallback, useRef } from "react";
import { api, ComfyLaunchConfig } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Power, Settings2, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ConnectionState = "connected" | "starting" | "stopped" | "stopping";

export function ComfyUIControl() {
    const [state, setState] = useState<ConnectionState>("stopped");
    const [canLaunch, setCanLaunch] = useState(false);
    const [lastError, setLastError] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [hasManagedProcess, setHasManagedProcess] = useState(false); // Track if we started this ComfyUI

    // Settings form state
    const [config, setConfig] = useState<ComfyLaunchConfig | null>(null);
    const [tempPath, setTempPath] = useState("");
    const [tempArgs, setTempArgs] = useState("");
    const [isSavingConfig, setIsSavingConfig] = useState(false);

    const pollingRef = useRef<NodeJS.Timeout | null>(null);
    const pollCountRef = useRef(0);
    const isStartingRef = useRef(false); // Prevent checkStatus from overriding during start
    const isStoppingRef = useRef(false); // Prevent checkStatus from overriding during stop

    // Fetch both managed process status AND actual connection health
    const checkStatus = useCallback(async () => {
        try {
            // Check if ComfyUI is actually reachable (engine health)
            const healths = await api.getEngineHealth();
            const isConnected = healths.length > 0 && healths[0].healthy;

            // Check managed process status
            const processStatus = await api.getComfyUIStatus();
            setCanLaunch(processStatus.can_launch);
            setHasManagedProcess(processStatus.running); // Did Sweet Tea start this process?
            if (!isStoppingRef.current) {
                setLastError(processStatus.error || null);
            }

            // Determine state based on both checks
            // Don't override state during start/stop operations
            if (isStartingRef.current || isStoppingRef.current) {
                // But if we're starting and now connected, update the state!
                if (isStartingRef.current && isConnected) {
                    setState("connected");
                    isStartingRef.current = false;
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
                // Clear any polling since we're connected
                if (pollingRef.current) {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                    pollCountRef.current = 0;
                }
            } else if (state === "starting") {
                // Keep starting state - polling will handle it
            } else {
                setState("stopped");
            }
        } catch (e) {
            console.warn("Failed to check ComfyUI status", e);
            if (state !== "starting" && state !== "stopping") {
                setState("stopped");
            }
        }
    }, [state]);

    // Load config for settings dialog
    const loadConfig = useCallback(async () => {
        try {
            const c = await api.getComfyUILaunchConfig();
            setConfig(c);
            setTempPath(c.path || "");
            setTempArgs(c.args?.join(" ") || "");
        } catch (e) {
            console.warn("Failed to load ComfyUI config", e);
        }
    }, []);

    // Initialize and poll for status
    useEffect(() => {
        checkStatus();
        loadConfig();
        const interval = setInterval(checkStatus, 3000);
        return () => clearInterval(interval);
    }, [checkStatus, loadConfig]);

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

            // Poll for connection - ComfyUI takes time to become reachable
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
                        // Timeout after ~60 seconds (ComfyUI can take a while to load models)
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
        // Check if we can actually stop this (only managed processes)
        if (!hasManagedProcess) {
            setLastError("Cannot stop: ComfyUI was not started by Sweet Tea");
            return;
        }

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

            // Poll for disconnection
            pollCountRef.current = 0;
            pollingRef.current = setInterval(async () => {
                pollCountRef.current += 1;

                try {
                    const healths = await api.getEngineHealth();
                    const isConnected = healths.length > 0 && healths[0].healthy;

                    if (!isConnected) {
                        setState("stopped");
                        setHasManagedProcess(false);
                        isStoppingRef.current = false;
                        if (pollingRef.current) {
                            clearInterval(pollingRef.current);
                            pollingRef.current = null;
                        }
                    } else if (pollCountRef.current > 15) {
                        // Timeout after ~15 seconds
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

    // Save config
    const handleSaveConfig = async () => {
        setIsSavingConfig(true);
        try {
            const newConfig = await api.saveComfyUILaunchConfig({
                path: tempPath || null,
                args: tempArgs || null,
            });
            setConfig(newConfig);
            setCanLaunch(newConfig.is_available);
            setSettingsOpen(false);
        } catch (e) {
            setLastError((e as Error)?.message || "Failed to save config");
        } finally {
            setIsSavingConfig(false);
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

    // Determine button states
    const isTransitioning = state === "starting" || state === "stopping";
    const isConnected = state === "connected";

    // Status indicator color
    const statusColor = {
        connected: "bg-green-500",
        starting: "bg-yellow-500 animate-pulse",
        stopping: "bg-yellow-500 animate-pulse",
        stopped: "bg-red-500",
    }[state];

    const statusText = {
        connected: "Running",
        starting: "Starting...",
        stopping: "Stopping...",
        stopped: "Stopped",
    }[state];

    return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 rounded-lg border border-slate-200">
            {/* Status indicator */}
            <div className="flex items-center gap-1.5">
                <div className={cn("w-2 h-2 rounded-full", statusColor)} />
                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
                    ComfyUI
                </span>
                <span className="text-[9px] text-slate-400">
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
                            hasManagedProcess && !isTransitioning
                                ? "text-red-500 hover:text-red-600 hover:bg-red-50"
                                : "text-slate-400 cursor-not-allowed"
                        )}
                        onClick={handleStop}
                        disabled={isTransitioning || !hasManagedProcess}
                        title={
                            isTransitioning
                                ? statusText
                                : hasManagedProcess
                                    ? "Stop ComfyUI"
                                    : "Cannot stop: ComfyUI was started externally"
                        }
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
                                ? "text-green-600 hover:text-green-700 hover:bg-green-50"
                                : "text-slate-400 cursor-not-allowed"
                        )}
                        onClick={handleStart}
                        disabled={isTransitioning || !canLaunch}
                        title={
                            isTransitioning
                                ? statusText
                                : canLaunch
                                    ? "Start ComfyUI"
                                    : "ComfyUI not configured - click settings"
                        }
                    >
                        {isTransitioning ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                            <Power className="w-3 h-3" />
                        )}
                    </Button>
                )}

                {/* Settings gear */}
                <Dialog open={settingsOpen} onOpenChange={(open) => {
                    setSettingsOpen(open);
                    if (open) loadConfig();
                }}>
                    <DialogTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-slate-400 hover:text-slate-600 hover:bg-slate-200"
                            title="ComfyUI Settings"
                        >
                            <Settings2 className="w-3 h-3" />
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Settings2 className="w-4 h-4" />
                                ComfyUI Settings
                            </DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            {/* Detection info */}
                            {config && (
                                <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded">
                                    <span className="font-medium">Detection: </span>
                                    {config.detection_method === "not_found" ? (
                                        <span className="text-amber-600">Not found - configure path below</span>
                                    ) : (
                                        <span className="text-green-600">{config.detection_method}</span>
                                    )}
                                    {config.path && (
                                        <div className="mt-1 font-mono text-[10px] truncate" title={config.path}>
                                            {config.path}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Path input */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-500 uppercase">
                                    ComfyUI Folder Path
                                </label>
                                <Input
                                    value={tempPath}
                                    onChange={(e) => setTempPath(e.target.value)}
                                    placeholder="Leave blank to auto-detect"
                                    className="text-sm font-mono"
                                />
                                <p className="text-[10px] text-slate-400">
                                    Path to your ComfyUI installation folder (contains main.py)
                                </p>
                            </div>

                            {/* Args input */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-500 uppercase">
                                    Launch Arguments
                                </label>
                                <Input
                                    value={tempArgs}
                                    onChange={(e) => setTempArgs(e.target.value)}
                                    placeholder="e.g., --lowvram --preview-method auto"
                                    className="text-sm font-mono"
                                />
                                <p className="text-[10px] text-slate-400">
                                    Optional arguments passed to ComfyUI on launch
                                </p>
                            </div>

                            {/* Error display */}
                            {lastError && (
                                <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-2 rounded">
                                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                                    {lastError}
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex justify-end gap-2 pt-2">
                                <DialogClose asChild>
                                    <Button variant="outline" size="sm">
                                        Cancel
                                    </Button>
                                </DialogClose>
                                <Button
                                    size="sm"
                                    onClick={handleSaveConfig}
                                    disabled={isSavingConfig}
                                >
                                    {isSavingConfig ? (
                                        <>
                                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                            Saving...
                                        </>
                                    ) : (
                                        "Save"
                                    )}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
}
