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
  previewBlob?: string | null;
  startedAt: string;
  estimatedTotalSteps?: number;
}

interface GenerationFeedProps {
  items: GenerationFeedItem[];
  onSelectPreview?: (path: string) => void;
}

export function GenerationFeed({ items, onSelectPreview }: GenerationFeedProps) {
  const activeItem = items[0];

  // Calculate metrics
  const getMetrics = (item: GenerationFeedItem) => {
    const elapsed = (Date.now() - new Date(item.startedAt).getTime()) / 1000;
    const progressFraction = item.progress / 100;

    // Estimate iterations based on progress (assuming ~20 steps for typical generation)
    const estimatedTotalSteps = item.estimatedTotalSteps || 20;
    const currentStep = Math.round(progressFraction * estimatedTotalSteps);

    // it/s and s/it
    const iterationsPerSecond = elapsed > 0 && currentStep > 0 ? currentStep / elapsed : 0;
    const secondsPerIteration = currentStep > 0 ? elapsed / currentStep : 0;

    // Estimated total duration
    const estimatedTotalDuration = progressFraction > 0 ? elapsed / progressFraction : 0;
    const estimatedRemaining = Math.max(0, estimatedTotalDuration - elapsed);

    return {
      elapsed: Math.round(elapsed),
      itPerSec: iterationsPerSecond.toFixed(2),
      secPerIt: secondsPerIteration.toFixed(2),
      estimatedTotal: Math.round(estimatedTotalDuration),
      remaining: Math.round(estimatedRemaining),
      elapsedPercent: progressFraction > 0 ? Math.round((elapsed / estimatedTotalDuration) * 100) : 0
    };
  };

  return (
    <div className="w-80 pointer-events-auto">
      <Card className="shadow-lg border-slate-200 bg-white/95 backdrop-blur overflow-hidden">
        {activeItem ? (
          <>
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50/50">
              <div className="text-xs font-semibold text-slate-700 flex items-center gap-2">
                <span className={cn("w-2 h-2 rounded-full", activeItem.status === 'running' || activeItem.status === 'processing' ? "bg-green-500 animate-pulse" : "bg-slate-300")} />
                generation status
              </div>
              <Badge variant="outline" className="text-[10px] text-slate-500 h-5 px-1.5 font-normal">
                job #{activeItem.jobId}
              </Badge>
            </div>

            <div className="p-3 space-y-3">
              {activeItem.previewBlob ? (
                <div className="relative aspect-video w-full rounded overflow-hidden bg-black/5 border border-slate-200 animate-in fade-in duration-300">
                  <img src={activeItem.previewBlob} alt="Live Preview" className="w-full h-full object-contain" />
                  {(activeItem.status === 'running' || activeItem.status === 'processing') && (
                    <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur font-medium tracking-wide">
                      live
                    </div>
                  )}
                </div>
              ) : activeItem.previewPath ? (
                <div
                  className="relative aspect-video w-full rounded overflow-hidden bg-black/5 border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity group"
                  onClick={() => onSelectPreview?.(activeItem.previewPath || "")}
                >
                  <div className="w-full h-full flex flex-col items-center justify-center text-xs text-slate-400 gap-1 group-hover:text-slate-600 transition-colors">
                    <span className="font-semibold">ready</span>
                    <span className="text-[10px]">click to view result</span>
                  </div>
                </div>
              ) : null}

              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-500 tracking-wider font-semibold">
                  <span className="lowercase">{activeItem.status}</span>
                  <div className="flex gap-2">
                    {activeItem.status === "processing" && (() => {
                      const metrics = getMetrics(activeItem);
                      return (
                        <span>
                          {metrics.itPerSec} it/s | {metrics.secPerIt} s/it | {metrics.elapsed}s / ~{metrics.estimatedTotal}s ({metrics.elapsedPercent}%)
                        </span>
                      );
                    })()}
                    <span>{Math.round(activeItem.progress)}%</span>
                  </div>
                </div>
                <Progress value={activeItem.progress} className="h-1.5" />
              </div>

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
            </div>
          </>
        ) : (
          <div className="p-4 flex flex-col items-center justify-center text-center space-y-2 text-slate-400">
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center mb-1">
              <div className="w-2 h-2 rounded-full bg-slate-300" />
            </div>
            <div className="text-xs font-medium text-slate-500">ready to generate</div>
            <div className="text-[10px]">waiting for job...</div>
          </div>
        )}
      </Card>
    </div>
  );
}
