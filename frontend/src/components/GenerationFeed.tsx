import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDuration, formatSpeed, type GenerationState } from "@/lib/generationState";

export interface GenerationFeedItem {
  jobId: number;
  status: GenerationState | string;
  progress: number;
  previewPath?: string | null;
  previewPaths?: string[]; // Support multiple images
  previewBlob?: string | null;
  startedAt: string;
  // Progress statistics
  currentStep?: number;
  totalSteps?: number;
  elapsedMs?: number;
  estimatedRemainingMs?: number;
  iterationsPerSecond?: number;
}

interface GenerationFeedProps {
  items: GenerationFeedItem[];
  onSelectPreview?: (item: GenerationFeedItem & { selectedPath?: string }) => void;
  onGenerate?: () => void;
}

export function GenerationFeed({ items, onSelectPreview, onGenerate }: GenerationFeedProps) {
  const activeItem = items[0];

  // Debug: Log when component renders with preview blob
  if (activeItem?.previewBlob) {
    console.log("[GenerationFeed] Rendering with previewBlob:", activeItem.previewBlob.substring(0, 50) + "...");
  }

  // Format stats for display
  const isRunning = activeItem?.status === 'running' || activeItem?.status === 'processing';
  const hasStats = activeItem && (activeItem.elapsedMs || activeItem.iterationsPerSecond);

  return (
    <div className="w-full h-full pointer-events-auto">
      {activeItem ? (
        <div className="shadow-lg border border-blue-100 bg-blue-50/95 backdrop-blur overflow-hidden rounded-lg">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50/50">
            <div className="text-xs font-semibold text-slate-700 flex items-center gap-2">
              <span className={cn("w-2 h-2 rounded-full", isRunning ? "bg-green-500 animate-pulse" : "bg-slate-300")} />
              generation status
            </div>
            <Badge variant="outline" className="text-[10px] text-slate-500 h-5 px-1.5 font-normal">
              job #{activeItem.jobId}
            </Badge>
          </div>

          {/* Preview & Stats */}
          <div className="p-3 space-y-2">
            {/* Preview Image */}
            {activeItem.previewBlob ? (
              <div className="relative w-full h-72 rounded overflow-hidden bg-black/5 border border-slate-200">
                <img src={activeItem.previewBlob} alt="Live Preview" className="w-full h-full object-contain" />
                {isRunning && (
                  <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur font-medium">
                    live
                  </div>
                )}
              </div>
            ) : (activeItem.previewPaths?.[0] || activeItem.previewPath) ? (
              <div
                className="relative w-full h-72 rounded overflow-hidden bg-black/5 border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => {
                  const path = activeItem.previewPaths?.[0] || activeItem.previewPath;
                  if (path) onSelectPreview?.({ ...activeItem, selectedPath: path });
                }}
              >
                <div className="w-full h-full flex flex-col items-center justify-center text-xs text-slate-400">
                  <span className="font-semibold">ready</span>
                  <span className="text-[10px]">click to view</span>
                </div>
              </div>
            ) : (
              <div className="w-full h-72 rounded bg-slate-100 border border-slate-200" />
            )}

            {/* Progress */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-500 tracking-wider font-semibold">
                <span className="lowercase">{activeItem.status}</span>
                <span>{Math.round(activeItem.progress)}%</span>
              </div>
              <Progress value={activeItem.progress} className="h-1.5" />

              {/* Stats row - only show when running or has data */}
              {(isRunning || hasStats) && (
                <div className="flex justify-between text-[9px] text-slate-400 pt-0.5">
                  <span>
                    {activeItem.elapsedMs ? formatDuration(activeItem.elapsedMs) : ""}
                    {activeItem.currentStep && activeItem.totalSteps ? ` • ${activeItem.currentStep}/${activeItem.totalSteps}` : ""}
                  </span>
                  <span className="flex gap-2">
                    {activeItem.iterationsPerSecond ? formatSpeed(activeItem.iterationsPerSecond) : ""}
                    {activeItem.estimatedRemainingMs && activeItem.estimatedRemainingMs > 0 ? (
                      <span>~{formatDuration(activeItem.estimatedRemainingMs)}</span>
                    ) : null}
                  </span>
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="space-y-1.5">
              {(activeItem.previewPaths?.[0] || activeItem.previewPath) && !activeItem.previewBlob && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 w-full text-xs"
                  onClick={() => {
                    const path = activeItem.previewPaths?.[0] || activeItem.previewPath;
                    if (path) onSelectPreview?.({ ...activeItem, selectedPath: path });
                  }}
                >
                  view result
                </Button>
              )}
              {onGenerate && (
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 w-full text-xs gap-1.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onGenerate) onGenerate();
                  }}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="shadow-lg border border-slate-200 bg-white/95 backdrop-blur overflow-hidden rounded-lg" style={{ width: '384px', height: '100%', display: 'flex', flexDirection: 'column' }}>
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
                onClick={(e) => {
                  e.stopPropagation();
                  if (onGenerate) onGenerate();
                }}
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
