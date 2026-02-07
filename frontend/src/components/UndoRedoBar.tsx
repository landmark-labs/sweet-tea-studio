import { useState } from "react";
import { Undo2, Redo2, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUndoRedo } from "@/lib/undoRedo";

export function UndoRedoBar() {
  const { canUndo, canRedo, undo, redo, historyLabels } = useUndoRedo();
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 shadow-xs">
      <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1">
            <History className="h-4 w-4" />
            <span>history</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <div className="p-2 border-b border-border bg-surface-raised">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">recent actions</span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {historyLabels.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground text-center">no actions yet</div>
            ) : (
              <ul className="py-1">
                {historyLabels.slice(0, 100).map((label, idx) => (
                  <li
                    key={idx}
                    className="px-3 py-1.5 text-xs text-foreground/80 hover:bg-hover border-b border-border/30 last:border-b-0"
                  >
                    {label.toLowerCase()}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 rounded-lg" disabled={!canUndo} onClick={undo}>
              <Undo2 className="h-4 w-4" />
              <span className="hidden sm:inline">undo</span>
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
              <span className="hidden sm:inline">redo</span>
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
