/**
 * ConnectionBanner component
 * Shows a dismissible banner when ComfyUI is not connected
 */
import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { X, Play, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConnectionBannerProps {
    className?: string;
}

export function ConnectionBanner({ className }: ConnectionBannerProps) {
    const [isConnected, setIsConnected] = useState(true);
    const [canLaunch, setCanLaunch] = useState(false);
    const [isDismissed, setIsDismissed] = useState(false);
    const [isLaunching, setIsLaunching] = useState(false);
    const retryCountRef = useRef(0);

    const checkConnection = async () => {
        try {
            const res = await fetch("/api/v1/status/summary");
            if (res.ok) {
                const data = await res.json();
                const connected = data.engine?.is_connected ?? data.engine?.state === "ok";
                const launch = data.engine?.can_launch ?? false;

                setIsConnected(connected);
                setCanLaunch(launch);

                // Auto-dismiss if connected
                if (connected && isDismissed) {
                    setIsDismissed(false);
                }
            }
        } catch {
            setIsConnected(false);
        }
    };

    const launchComfyUI = async () => {
        setIsLaunching(true);
        try {
            const res = await fetch("/api/v1/engines/comfyui/launch", {
                method: "POST",
            });
            if (res.ok) {
                // Poll for connection after launch
                retryCountRef.current = 0;
                const pollInterval = setInterval(() => {
                    retryCountRef.current += 1;
                    if (retryCountRef.current > 10) {
                        clearInterval(pollInterval);
                        setIsLaunching(false);
                        return;
                    }
                    checkConnection();
                }, 2000);
            }
        } catch {
            setIsLaunching(false);
        }
    };

    useEffect(() => {
        checkConnection();
        const interval = setInterval(checkConnection, 5000);
        return () => clearInterval(interval);
    }, []);

    // Don't show if connected or dismissed
    if (isConnected || isDismissed) {
        return null;
    }

    return (
        <div
            className={cn(
                "fixed top-0 left-0 right-0 z-40 bg-amber-500/95 text-white px-4 py-2",
                "flex items-center justify-center gap-4 shadow-lg backdrop-blur-sm",
                className
            )}
        >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm font-medium">
                ComfyUI is not running
            </span>

            {canLaunch ? (
                <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 px-3 bg-white/20 hover:bg-white/30 text-white border-0"
                    onClick={launchComfyUI}
                    disabled={isLaunching}
                >
                    {isLaunching ? (
                        <>
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            launching...
                        </>
                    ) : (
                        <>
                            <Play className="w-3 h-3 mr-1" />
                            launch comfyui
                        </>
                    )}
                </Button>
            ) : (
                <span className="text-xs text-white/80">
                    start ComfyUI manually or configure COMFYUI_PATH
                </span>
            )}

            <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 ml-2 text-white/80 hover:text-white hover:bg-white/20"
                onClick={() => setIsDismissed(true)}
            >
                <X className="w-4 h-4" />
            </Button>
        </div>
    );
}
