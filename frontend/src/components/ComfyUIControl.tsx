import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Power, RotateCcw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ComfyUIStatus {
    running: boolean;
    pid?: number;
    can_launch: boolean;
    error?: string;
}

export function ComfyUIControl() {
    const [status, setStatus] = useState<ComfyUIStatus>({ running: false, can_launch: false });
    const [loading, setLoading] = useState<"start" | "stop" | "restart" | null>(null);

    const fetchStatus = async () => {
        try {
            const s = await api.getComfyUIStatus();
            setStatus(s);
        } catch (e) {
            console.warn("Failed to fetch ComfyUI status", e);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleStart = async () => {
        setLoading("start");
        try {
            await api.startComfyUI();
            await new Promise(r => setTimeout(r, 2000)); // Wait for startup
            await fetchStatus();
        } finally {
            setLoading(null);
        }
    };

    const handleStop = async () => {
        setLoading("stop");
        try {
            await api.stopComfyUI();
            await new Promise(r => setTimeout(r, 1000));
            await fetchStatus();
        } finally {
            setLoading(null);
        }
    };

    const handleRestart = async () => {
        setLoading("restart");
        try {
            await api.stopComfyUI();
            await new Promise(r => setTimeout(r, 2000));
            await api.startComfyUI();
            await new Promise(r => setTimeout(r, 2000));
            await fetchStatus();
        } finally {
            setLoading(null);
        }
    };

    const isRunning = status.running;
    const canLaunch = status.can_launch;

    return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 rounded-lg border border-slate-200">
            {/* Status indicator */}
            <div className="flex items-center gap-1.5">
                <div
                    className={cn(
                        "w-2 h-2 rounded-full",
                        isRunning ? "bg-green-500" : "bg-slate-400"
                    )}
                />
                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
                    ComfyUI
                </span>
            </div>

            {/* Control buttons */}
            <div className="flex items-center gap-0.5 ml-1">
                {isRunning ? (
                    <>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-red-500 hover:text-red-600 hover:bg-red-50"
                            onClick={handleStop}
                            disabled={loading !== null}
                            title="Stop ComfyUI"
                        >
                            {loading === "stop" ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                                <Power className="w-3 h-3" />
                            )}
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-blue-500 hover:text-blue-600 hover:bg-blue-50"
                            onClick={handleRestart}
                            disabled={loading !== null}
                            title="Restart ComfyUI"
                        >
                            {loading === "restart" ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                                <RotateCcw className="w-3 h-3" />
                            )}
                        </Button>
                    </>
                ) : (
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "h-6 w-6",
                            canLaunch
                                ? "text-green-600 hover:text-green-700 hover:bg-green-50"
                                : "text-slate-400 cursor-not-allowed"
                        )}
                        onClick={handleStart}
                        disabled={loading !== null || !canLaunch}
                        title={canLaunch ? "Start ComfyUI" : "ComfyUI cannot be started (not configured)"}
                    >
                        {loading === "start" ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                            <Power className="w-3 h-3" />
                        )}
                    </Button>
                )}
            </div>
        </div>
    );
}
