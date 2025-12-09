import { Undo2, Redo2, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useUndoRedo } from "@/lib/undoRedo";

export function UndoRedoBar() {
  const { canUndo, canRedo, undo, redo } = useUndoRedo();

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-surface/60 px-3 py-2 shadow-sm backdrop-blur">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <History className="h-4 w-4" />
        <span>History</span>
      </div>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 rounded-lg" disabled={!canUndo} onClick={undo}>
              <Undo2 className="h-4 w-4" />
              <span className="hidden sm:inline">Undo</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Ctrl/Cmd + Z
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 rounded-lg" disabled={!canRedo} onClick={redo}>
              <Redo2 className="h-4 w-4" />
              <span className="hidden sm:inline">Redo</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Ctrl/Cmd + Y or Shift + Z
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
