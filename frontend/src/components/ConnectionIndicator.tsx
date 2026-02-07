/**
 * ConnectionIndicator - Compact connection status indicator for the header
 * Shows green/red dot, connection status, port, and allows editing
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Settings2 } from "lucide-react";
import { useStatusPollingStore } from "@/lib/stores/statusPollingStore";


interface VersionInfo {
    comfyui_version: string | null;
    pytorch_version: string | null;
    cuda_version: string | null;
    python_version: string | null;
}

export function ConnectionIndicator() {
    const [port, setPort] = useState(() => localStorage.getItem("ds_comfyui_port") || "8188");
    const [tempPort, setTempPort] = useState(port);
    const [isEditing, setIsEditing] = useState(false);
    const [versions, setVersions] = useState<VersionInfo | null>(null);

    const engineStatus = useStatusPollingStore((state) => state.status?.engine);
    const isConnected = engineStatus?.is_connected ?? engineStatus?.state === "ok";

    useEffect(() => {
        const fetchVersions = async () => {
            if (!isConnected) return;
            try {
                const data = await api.getVersions();
                setVersions(data);
            } catch {
                // Silently fail
            }
        };

        fetchVersions();
        // Refresh versions every 30s
        const versionInterval = setInterval(fetchVersions, 30000);

        return () => {
            clearInterval(versionInterval);
        };
    }, [isConnected]);

    const handleSavePort = () => {
        setPort(tempPort);
        localStorage.setItem("ds_comfyui_port", tempPort);
        setIsEditing(false);
    };

    return (
        <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
                {/* Status Dot & Text */}
                <div className="flex items-center gap-1.5">
                    <span
                        className={cn(
                            "w-2 h-2 rounded-full",
                            isConnected ? "bg-success" : "bg-destructive",
                            isConnected && "animate-pulse"
                        )}
                    />
                <span className={cn(
                        "font-medium",
                        isConnected ? "text-foreground" : "text-destructive"
                    )}>
                        {isConnected ? "connected" : "not connected"}
                    </span>
                </div>

                {/* Port Indicator with Edit Popover */}
                <Popover open={isEditing} onOpenChange={setIsEditing}>
                    <PopoverTrigger asChild>
                        <button
                            className="flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-surface-raised hover:bg-hover text-muted-foreground transition-colors cursor-pointer"
                        >
                            <span className="text-[10px] text-muted-foreground/70">port</span>
                            <span className="font-mono">{port}</span>
                            <Settings2 className="w-3 h-3 text-muted-foreground/70" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-3" align="start">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-muted-foreground uppercase">comfyui port</label>
                            <div className="flex gap-2">
                                <Input
                                    type="text"
                                    value={tempPort}
                                    onChange={(e) => setTempPort(e.target.value)}
                                    className="h-8 text-sm font-mono"
                                    placeholder="8188"
                                />
                                <Button size="sm" className="h-8" onClick={handleSavePort}>
                                    save
                                </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                                default is 8188. change if using custom setup.
                            </p>
                        </div>
                    </PopoverContent>
                </Popover>
            </div>

            {/* Versions Display */}
            {isConnected && versions && (
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground border-l border-border pl-4">
                    {versions.comfyui_version && (
                        <div><span className="font-semibold text-foreground/80">ComfyUI</span> {versions.comfyui_version}</div>
                    )}
                    {versions.pytorch_version && (
                        <div><span className="font-semibold text-foreground/80">PyTorch</span> {versions.pytorch_version}</div>
                    )}
                    {versions.cuda_version && (
                        <div><span className="font-semibold text-foreground/80">CUDA</span> {versions.cuda_version}</div>
                    )}
                    {versions.python_version && (
                        <div><span className="font-semibold text-foreground/80">Python</span> {versions.python_version}</div>
                    )}
                </div>
            )}
        </div>
    );
}

