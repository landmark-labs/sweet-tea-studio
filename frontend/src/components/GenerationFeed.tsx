import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface GenerationFeedItem {
  jobId: number;
  status: string;
  progress: number;
  previewPath?: string | null;
  startedAt: string;
}

interface GenerationFeedProps {
  items: GenerationFeedItem[];
  onSelectPreview?: (path: string) => void;
}

export function GenerationFeed({ items, onSelectPreview }: GenerationFeedProps) {
  return (
    <div className="absolute bottom-4 left-4 z-30 w-80 pointer-events-auto">
      <Card className="shadow-lg border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
          <div className="text-sm font-semibold text-slate-800">Live generation feed</div>
          <Badge variant="outline" className="text-[10px] text-slate-600">
            rolling preview
          </Badge>
        </div>
        <ScrollArea className="h-64">
          <div className="p-3 space-y-3">
            {items.length === 0 && <p className="text-xs text-slate-500">No active jobs.</p>}
            {items.map((item) => (
              <div key={item.jobId} className="p-2 border border-slate-200 rounded-md bg-slate-50 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">Job #{item.jobId}</span>
                  <span className="capitalize">{item.status}</span>
                </div>
                <Progress value={item.progress} className="h-1.5" />
                {item.previewPath && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-blue-600 hover:text-blue-700"
                    onClick={() => onSelectPreview?.(item.previewPath || "")}
                  >
                    View latest preview
                  </Button>
                )}
                <div className="flex gap-2 text-[11px] text-slate-500">
                  <span>{new Date(item.startedAt).toLocaleTimeString()}</span>
                  <span className={cn("px-1.5 py-0.5 rounded border", item.status === "completed" ? "bg-green-50 border-green-100 text-green-700" : "bg-amber-50 border-amber-100 text-amber-700")}>{item.status}</span>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}
