import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, Project } from "@/lib/api";
import { Loader2, FolderInput } from "lucide-react";

interface MoveImagesDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedImageIds: number[];
    projects: Project[];
    currentProjectId?: number | null;
    currentFolder?: string | null;
    onMoveComplete: () => void;
}

export function MoveImagesDialog({
    open,
    onOpenChange,
    selectedImageIds,
    projects,
    currentProjectId,
    currentFolder,
    onMoveComplete,
}: MoveImagesDialogProps) {
    const [targetProjectId, setTargetProjectId] = useState<string>("");
    const [targetSubfolder, setTargetSubfolder] = useState<string>("");
    const [isMoving, setIsMoving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Filter out drafts project only - allow same project for subfolder moves
    const availableProjects = projects.filter((p) => p.slug !== "drafts");

    const selectedProject = availableProjects.find(
        (p) => String(p.id) === targetProjectId
    );
    const isSameProject = selectedProject?.id === currentProjectId;
    // Exclude current folder when moving within the same project
    const availableFolders = (selectedProject?.config_json?.folders || []).filter(
        (folder: string) => !(isSameProject && folder === currentFolder)
    );

    const handleMove = async () => {
        if (!targetProjectId) {
            setError("Please select a target project");
            return;
        }

        setIsMoving(true);
        setError(null);

        try {
            const result = await api.moveImages(
                selectedImageIds,
                parseInt(targetProjectId),
                targetSubfolder || undefined
            );

            if (result.failed.length > 0) {
                setError(`Moved ${result.moved} images. ${result.failed.length} failed to move.`);
            } else {
                onMoveComplete();
                onOpenChange(false);
                setTargetProjectId("");
                setTargetSubfolder("");
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to move images");
        } finally {
            setIsMoving(false);
        }
    };

    const handleClose = () => {
        if (!isMoving) {
            onOpenChange(false);
            setTargetProjectId("");
            setTargetSubfolder("");
            setError(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FolderInput className="w-5 h-5" />
                        move images
                    </DialogTitle>
                    <DialogDescription>
                        Move {selectedImageIds.length} selected image{selectedImageIds.length !== 1 ? "s" : ""} to a different project.
                        Images will be renamed to match the project's naming convention.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">target project</label>
                        <Select value={targetProjectId} onValueChange={setTargetProjectId}>
                            <SelectTrigger>
                                <SelectValue placeholder="select a project..." />
                            </SelectTrigger>
                            <SelectContent>
                                {availableProjects.length === 0 ? (
                                    <SelectItem value="__none" disabled>
                                        no projects available
                                    </SelectItem>
                                ) : (
                                    availableProjects.map((p) => (
                                        <SelectItem key={p.id} value={String(p.id)}>
                                            {p.name}
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    {targetProjectId && (availableFolders.length > 0 || (isSameProject && currentFolder)) && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground">
                                destination folder <span className="text-muted-foreground">(optional)</span>
                            </label>
                            <Select
                                value={targetSubfolder || "__default"}
                                onValueChange={(val) => setTargetSubfolder(val === "__default" ? "" : val)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="default output" />
                                </SelectTrigger>
                                <SelectContent>
                                    {/* Hide default output if same project and already in default folder */}
                                    {!(isSameProject && !currentFolder) && (
                                        <SelectItem value="__default">default output</SelectItem>
                                    )}
                                    {availableFolders.map((folder) => (
                                        <SelectItem key={folder} value={folder}>
                                            /{folder}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {error && (
                        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
                            {error}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={isMoving}>
                        cancel
                    </Button>
                    <Button onClick={handleMove} disabled={!targetProjectId || isMoving}>
                        {isMoving ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                moving...
                            </>
                        ) : (
                            `move ${selectedImageIds.length} image${selectedImageIds.length !== 1 ? "s" : ""}`
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

