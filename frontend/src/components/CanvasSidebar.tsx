import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Save, RefreshCw, Pencil, Trash2, Layers, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/lib/stores/canvasStore";

interface CanvasSidebarProps {
  collapsed: boolean;
}

const formatShortTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function CanvasSidebar({ collapsed }: CanvasSidebarProps) {
  const navigate = useNavigate();
  const canvases = useCanvasStore((state) => state.canvases);
  const selectedCanvasId = useCanvasStore((state) => state.selectedCanvasId);
  const snapshotProvider = useCanvasStore((state) => state.snapshotProvider);
  const isSaving = useCanvasStore((state) => state.isSaving);
  const refreshCanvases = useCanvasStore((state) => state.refreshCanvases);
  const saveCanvas = useCanvasStore((state) => state.saveCanvas);
  const loadCanvas = useCanvasStore((state) => state.loadCanvas);
  const renameCanvas = useCanvasStore((state) => state.renameCanvas);
  const deleteCanvas = useCanvasStore((state) => state.deleteCanvas);
  const getSuggestedName = useCanvasStore((state) => state.getSuggestedName);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameId, setRenameId] = useState<number | null>(null);

  useEffect(() => {
    refreshCanvases();
  }, [refreshCanvases]);

  const handleOpenCanvas = useCallback(async (canvasId: number) => {
    await loadCanvas(canvasId);
    navigate("/");
  }, [loadCanvas, navigate]);

  const handleSave = useCallback(async () => {
    await saveCanvas();
  }, [saveCanvas]);

  const handleOpenCreate = useCallback(() => {
    const suggested = getSuggestedName();
    setCreateName(suggested || "");
    setCreateOpen(true);
  }, [getSuggestedName]);

  const handleCreate = useCallback(async () => {
    const name = createName.trim();
    await saveCanvas({ createNew: true, name: name || undefined });
    setCreateOpen(false);
  }, [createName, saveCanvas]);

  const handleOpenRename = useCallback((canvasId: number, name: string) => {
    setRenameId(canvasId);
    setRenameName(name);
    setRenameOpen(true);
  }, []);

  const handleRename = useCallback(async () => {
    if (!renameId) return;
    const name = renameName.trim();
    if (!name) return;
    await renameCanvas(renameId, name);
    setRenameOpen(false);
  }, [renameId, renameName, renameCanvas]);

  const handleDelete = useCallback(async (canvasId: number) => {
    if (!confirm("Delete this canvas? This cannot be undone.")) return;
    await deleteCanvas(canvasId);
  }, [deleteCanvas]);

  const isDisabled = !snapshotProvider || isSaving;

  return (
    <div className={cn("border-t border-border/70", collapsed ? "p-2" : "p-3")}>
      <div className={cn("flex items-center justify-between", collapsed ? "flex-col gap-2" : "mb-2")}>
        {!collapsed && (
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Layers className="h-3 w-3" />
            canvases
          </div>
        )}
        <div className={cn("flex items-center gap-1", collapsed && "flex-col")}>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={handleSave}
            disabled={isDisabled}
            title={snapshotProvider ? "Save canvas (Ctrl+S)" : "Open Prompt Studio to save"}
          >
            <Save className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={handleOpenCreate}
            disabled={isDisabled}
            title={snapshotProvider ? "Save as new canvas" : "Open Prompt Studio to save"}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={refreshCanvases}
            title="Refresh canvases"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="px-2 pb-2 text-[10px] text-muted-foreground">
            click a canvas to load
          </div>
          <ScrollArea className="max-h-[220px] pr-1">
            {canvases.length === 0 ? (
              <div className="text-xs text-muted-foreground px-2 py-2">no canvases yet</div>
            ) : (
              <div className="space-y-1">
                {canvases.map((canvas) => {
                  const savedAt = formatShortTimestamp(canvas.updated_at);
                  const title = savedAt ? `${canvas.name} • saved ${savedAt}` : canvas.name;

                  const isActive = selectedCanvasId === canvas.id;

                  return (
                    <div key={canvas.id} className="group relative flex items-center">
                      <Button
                        variant={isActive ? "secondary" : "ghost"}
                        className={cn(
                          "w-full justify-start text-xs gap-2",
                          isActive && "bg-primary/10 text-foreground font-medium hover:bg-primary/15"
                        )}
                        onClick={() => handleOpenCanvas(canvas.id)}
                        title={isActive ? `${title} (active - Ctrl+S saves here)` : title}
                      >
                        <span className="min-w-0 flex-1 truncate text-left">{canvas.name}</span>
                      </Button>
                      <div className="absolute right-1 top-0.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenCanvas(canvas.id);
                          }}
                          title="Open canvas"
                        >
                          <ArrowUpRight className="h-2.5 w-2.5" />
                        </button>
                        <button
                          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenRename(canvas.id, canvas.name);
                          }}
                          title="Rename canvas"
                        >
                          <Pencil className="h-2.5 w-2.5" />
                        </button>
                        <button
                          className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(canvas.id);
                          }}
                          title="Delete canvas"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save new canvas</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Input
              placeholder="Canvas name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <p className="text-[11px] text-muted-foreground">
              Leave blank to use the default name.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={handleCreate} disabled={isDisabled}>
              save canvas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename canvas</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Canvas name"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleRename}>rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
