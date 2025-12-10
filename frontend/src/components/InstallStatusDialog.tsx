import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, RotateCw, XCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export interface InstallStatus {
    status: "pending" | "running" | "completed" | "failed";
    progress_text: string;
    installed?: string[];
    failed?: string[];
    unknown?: string[];
    error?: string;
}

interface InstallStatusDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    status: InstallStatus | null;
    onReboot: () => void;
    allowManualClone?: boolean;
    onAllowManualCloneChange?: (value: boolean) => void;
}

export function InstallStatusDialog({
    open,
    onOpenChange,
    status,
    onReboot,
    allowManualClone,
    onAllowManualCloneChange,
}: InstallStatusDialogProps) {
    // Prevent closing if running
    const handleOpenChange = (newOpen: boolean) => {
        if (!newOpen && status?.status === "running") return;
        onOpenChange(newOpen);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Install Missing Nodes</DialogTitle>
                    <DialogDescription>
                        Using ComfyUI Manager to install nodes.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    {onAllowManualCloneChange && (
                        <div className="flex items-center justify-between rounded-md border p-3 bg-slate-50">
                            <div>
                                <div className="text-sm font-semibold">allow manual git clone fallback</div>
                                <p className="text-xs text-slate-600">opt into raw git clone when comfyui manager reports success but files are missing.</p>
                            </div>
                            <Switch
                                checked={!!allowManualClone}
                                onCheckedChange={onAllowManualCloneChange}
                            />
                        </div>
                    )}

                    {!status ? (
                        <div className="text-center text-slate-500">Starting...</div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <span className="font-semibold capitalize text-sm">
                                    Status: {status.status}
                                </span>
                                {status.status === "running" && (
                                    <RotateCw className="w-4 h-4 animate-spin text-blue-500" />
                                )}
                                {status.status === "completed" && (
                                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                                )}
                                {status.status === "failed" && (
                                    <XCircle className="w-5 h-5 text-red-500" />
                                )}
                            </div>

                            <div className="text-sm text-slate-600 bg-slate-50 p-2 rounded">
                                {status.progress_text}
                            </div>

                            {status.installed && status.installed.length > 0 && (
                                <div>
                                    <div className="text-xs font-semibold mb-1 text-green-700">
                                        Successfully Installed:
                                    </div>
                                    <div className="text-xs space-y-1">
                                        {status.installed.map((item, i) => (
                                            <div key={i} className="flex items-center">
                                                <CheckCircle2 className="w-3 h-3 mr-1 text-green-500" />
                                                {item}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {status.failed && status.failed.length > 0 && (
                                <div>
                                    <div className="text-xs font-semibold mb-1 text-red-700">
                                        Failed to Install:
                                    </div>
                                    <div className="text-xs space-y-1 text-red-600">
                                        {status.failed.map((item, i) => (
                                            <div key={i} className="flex items-center">
                                                <XCircle className="w-3 h-3 mr-1" /> {item}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {status.unknown && status.unknown.length > 0 && (
                                <div>
                                    <div className="text-xs font-semibold mb-1 text-amber-700">
                                        Unknown Nodes (No Repo Found):
                                    </div>
                                    <div className="text-xs space-y-1 text-amber-600">
                                        {status.unknown.map((item, i) => (
                                            <div key={i}>• {item}</div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {status.error && (
                                <div className="text-sm text-red-600 bg-red-50 p-2 rounded border border-red-200">
                                    Error: {status.error}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    {status?.status === "completed" ? (
                        <div className="flex w-full justify-between items-center">
                            <div className="text-xs text-slate-500">
                                Reboot required to apply changes.
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="ghost"
                                    onClick={() => onOpenChange(false)}
                                >
                                    Close
                                </Button>
                                <Button variant="default" onClick={onReboot}>
                                    Reboot Now
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <Button
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={status?.status === "running"}
                        >
                            Close
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
