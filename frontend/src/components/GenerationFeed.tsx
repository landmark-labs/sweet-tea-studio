import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface GenerationFeedItem {
  jobId: number;
  status: string;
  progress: number;
  previewPath?: string | null;
  previewBlob?: string | null;
  startedAt: string;
  estimatedTotalSteps?: number;
}

interface GenerationFeedProps {
  items: GenerationFeedItem[];
  onSelectPreview?: (path: string) => void;
  onGenerate?: () => void;
}

export function GenerationFeed({ items, onSelectPreview, onGenerate }: GenerationFeedProps) {
  const activeItem = items[0];

  // Get completed items with preview paths (last 4)
  const completedItems = items
    .filter(item => item.status === 'completed' && item.previewPath)
    .slice(0, 4);

  return (
    <div className="w-full h-full pointer-events-auto">
      {activeItem ? (
        <div className="shadow-lg border border-slate-200 bg-white/95 backdrop-blur overflow-hidden rounded-lg">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50/50">
            <div className="text-xs font-semibold text-slate-700 flex items-center gap-2">
              <span className={cn("w-2 h-2 rounded-full", activeItem.status === 'running' || activeItem.status === 'processing' ? "bg-green-500 animate-pulse" : "bg-slate-300")} />
              generation status
            </div>
            <Badge variant="outline" className="text-[10px] text-slate-500 h-5 px-1.5 font-normal">
              job #{activeItem.jobId}
            </Badge>
          </div>

          {/* HORIZONTAL LAYOUT - using inline styles to force flex-row */}
          <div style={{ display: 'flex', flexDirection: 'row' }}>
            {/* LEFT: Current Preview & Stats (400px fixed) */}
            <div style={{ width: '400px', flexShrink: 0 }} className="p-3 space-y-2 border-r border-slate-200">
              {/* Preview Image */}
              {activeItem.previewBlob ? (
                <div className="relative w-full h-48 rounded overflow-hidden bg-black/5 border border-slate-200">
                  <img src={activeItem.previewBlob} alt="Live Preview" className="w-full h-full object-contain" />
                  {(activeItem.status === 'running' || activeItem.status === 'processing') && (
                    <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur font-medium">
                      live
                    </div>
                  )}
                </div>
              ) : activeItem.previewPath ? (
                <div
                  className="relative w-full h-48 rounded overflow-hidden bg-black/5 border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => onSelectPreview?.(activeItem.previewPath || "")}
                >
                  <div className="w-full h-full flex flex-col items-center justify-center text-xs text-slate-400">
                    <span className="font-semibold">ready</span>
                    <span className="text-[10px]">click to view</span>
                  </div>
                </div>
              ) : (
                <div className="w-full h-48 rounded bg-slate-100 border border-slate-200" />
              )}

              {/* Progress */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-500 tracking-wider font-semibold">
                  <span className="lowercase">{activeItem.status}</span>
                  <span>{Math.round(activeItem.progress)}%</span>
                </div>
                <Progress value={activeItem.progress} className="h-1.5" />
              </div>

              {/* Buttons */}
              <div className="space-y-1.5">
                {activeItem.previewPath && !activeItem.previewBlob && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 w-full text-xs"
                    onClick={() => onSelectPreview?.(activeItem.previewPath || "")}
                  >
                    view result
                  </Button>
                )}
                {onGenerate && (
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 w-full text-xs gap-1.5"
                    onClick={onGenerate}
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Generate
                  </Button>
                )}
              </div>
            </div>

            {/* RIGHT: Last 4 Images (horizontal row, each 256x256 max) */}
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', padding: '12px' }}>
              {completedItems.length > 0 ? (
                completedItems.map((item) => (
                  <div
                    key={item.jobId}
                    style={{ width: '256px', height: '256px', flexShrink: 0 }}
                    className="rounded overflow-hidden bg-slate-100 border border-slate-200 cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all"
                    onClick={() => onSelectPreview?.(item.previewPath || "")}
                  >
                    <img
                      src={`/api/v1/gallery/image/path?path=${encodeURIComponent(item.previewPath || "")}`}
                      alt={`Job ${item.jobId}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center text-xs text-slate-400" style={{ minWidth: '256px', height: '256px' }}>
                  no recent generations
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="shadow-lg border border-slate-200 bg-white/95 backdrop-blur overflow-hidden rounded-lg" style={{ width: '256px', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="flex-1 p-4 flex flex-col items-center justify-center text-center space-y-2 text-slate-400">
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center mb-1">
              <div className="w-2 h-2 rounded-full bg-slate-300" />
            </div>
            <div className="text-xs font-medium text-slate-500">ready to generate</div>
            <div className="text-[10px]">waiting for job...</div>
            {onGenerate && (
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs gap-1.5 mt-2"
                onClick={onGenerate}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
