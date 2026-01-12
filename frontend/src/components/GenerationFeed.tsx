import React from "react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, formatSpeed, type GenerationState } from "@/lib/generationState";

type PreviewOrientation = "portrait" | "landscape" | "square";

const FEED_PREVIEW_RULER = "14.4rem"; // 80% of previous 18rem
const FEED_LONG_SIDE = 1280;
const FEED_SHORT_SIDE = 720;
const FEED_SQUARE_SIDE = 1024;

const previewBoxSizeByOrientation: Record<PreviewOrientation, React.CSSProperties> = {
  portrait: {
    width: `calc(${FEED_PREVIEW_RULER} * ${FEED_SHORT_SIDE} / ${FEED_LONG_SIDE})`,
    height: FEED_PREVIEW_RULER,
  },
  landscape: {
    width: FEED_PREVIEW_RULER,
    height: `calc(${FEED_PREVIEW_RULER} * ${FEED_SHORT_SIDE} / ${FEED_LONG_SIDE})`,
  },
  square: {
    width: `calc(${FEED_PREVIEW_RULER} * ${FEED_SQUARE_SIDE} / ${FEED_LONG_SIDE})`,
    height: `calc(${FEED_PREVIEW_RULER} * ${FEED_SQUARE_SIDE} / ${FEED_LONG_SIDE})`,
  },
};

const classifyPreviewOrientation = (naturalWidth: number, naturalHeight: number): PreviewOrientation => {
  if (naturalWidth <= 0 || naturalHeight <= 0) return "portrait";

  const aspect = naturalWidth / naturalHeight;
  if (Math.abs(aspect - 1) <= 0.06) return "square";
  return aspect > 1 ? "landscape" : "portrait";
};

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
  isGenerating?: boolean;
  embedded?: boolean;
}

export const GenerationFeed = React.memo(function GenerationFeed({ items, onSelectPreview, onGenerate, isGenerating, embedded = false }: GenerationFeedProps) {
  const activeItem = items[0];
  const [previewOrientation, setPreviewOrientation] = React.useState<PreviewOrientation>("portrait");
  const previewOrientationByJobId = React.useRef<Record<number, PreviewOrientation>>({});

  React.useEffect(() => {
    if (!activeItem?.previewBlob) return;

    const cachedOrientation = previewOrientationByJobId.current[activeItem.jobId];
    if (cachedOrientation) {
      setPreviewOrientation(cachedOrientation);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const naturalWidth = img.naturalWidth || img.width;
      const naturalHeight = img.naturalHeight || img.height;
      const nextOrientation = classifyPreviewOrientation(naturalWidth, naturalHeight);
      previewOrientationByJobId.current[activeItem.jobId] = nextOrientation;
      setPreviewOrientation(nextOrientation);
    };
    img.src = activeItem.previewBlob;

    return () => {
      cancelled = true;
    };
  }, [activeItem?.jobId, activeItem?.previewBlob]);

  const previewBoxStyle = React.useMemo(() => {
    if (!activeItem?.previewBlob) return undefined;
    return previewBoxSizeByOrientation[previewOrientation];
  }, [activeItem?.previewBlob, previewOrientation]);

  // Format stats for display
  const isRunning = activeItem?.status === 'running' || activeItem?.status === 'processing';
  const hasStats = activeItem && (activeItem.elapsedMs || activeItem.iterationsPerSecond);

  if (embedded) {
    return (
      <div className="w-full pointer-events-auto">
        {activeItem ? (
          <div className="space-y-2">
            {/* Preview Image */}
            {activeItem.previewBlob ? (
              <div
                className="relative rounded overflow-hidden bg-surface-raised/70 border border-border/60 mx-auto"
                style={previewBoxStyle}
              >
                <img src={activeItem.previewBlob} alt="Live Preview" className="w-full h-full object-contain" />
                {isRunning && (
                  <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur font-medium">
                    live
                  </div>
                )}
              </div>
            ) : (activeItem.previewPaths?.[0] || activeItem.previewPath) ? (
              <div
                className="relative w-full h-56 rounded overflow-hidden bg-surface-raised/70 border border-border/60 cursor-pointer hover:bg-surface-overlay/60 transition-colors"
                onClick={() => {
                  const path = activeItem.previewPaths?.[0] || activeItem.previewPath;
                  if (path) onSelectPreview?.({ ...activeItem, selectedPath: path });
                }}
              >
                <div className="w-full h-full flex flex-col items-center justify-center text-xs text-muted-foreground">
                  <span className="font-semibold">ready</span>
                  <span className="text-[10px]">click to view</span>
                </div>
              </div>
            ) : (
              <div className="w-full h-56 rounded bg-surface-raised/70 border border-border/60" />
            )}

            {/* Progress */}
            <div className="space-y-1">
              <div className="flex justify-between text-[9px] text-foreground/80 tracking-wider font-semibold">
                <span className="lowercase">
                  {activeItem.status}
                  <span className="text-muted-foreground font-medium"> • #{activeItem.jobId}</span>
                </span>
                <span className="text-foreground">{Math.round(activeItem.progress)}%</span>
              </div>
              <Progress value={activeItem.progress} className="h-1" />

              {/* Stats row - only show when running or has data */}
              {(isRunning || hasStats) && (
                <div className="flex justify-between text-[9px] text-muted-foreground pt-0.5">
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
                  {isGenerating ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  )}
                  {isGenerating ? 'generating...' : 'generate'}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="p-2 flex flex-col items-center justify-center text-center space-y-2 text-muted-foreground">
            <div className="w-7 h-7 rounded-full bg-muted/30 flex items-center justify-center mb-1">
              <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
            </div>
            <div className="text-xs font-medium text-muted-foreground">ready to generate</div>
            <div className="text-[10px]">waiting for job...</div>
            {onGenerate && (
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs gap-1.5 mt-1"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onGenerate) onGenerate();
                }}
              >
                {isGenerating ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )}
                {isGenerating ? 'generating...' : 'generate'}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full pointer-events-auto">
      {activeItem ? (
        <div className="shadow-xl border border-blue-100 bg-blue-50/95 dark:border-border dark:bg-surface/95 ring-1 ring-black/5 dark:ring-white/5 backdrop-blur overflow-hidden rounded-lg">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-blue-100/80 bg-blue-50/60 dark:border-border/70 dark:bg-surface-raised/70">
            <div className="text-xs font-semibold text-foreground flex items-center gap-2">
              <span className={cn("w-2 h-2 rounded-full", isRunning ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40")} />
              generation status
            </div>
            <Badge variant="outline" className="text-[10px] text-muted-foreground h-5 px-2 font-medium">
              job #{activeItem.jobId}
            </Badge>
          </div>

          {/* Preview & Stats */}
          <div className="p-3 space-y-2">
            {/* Preview Image */}
            {activeItem.previewBlob ? (
              <div
                className="relative rounded overflow-hidden bg-surface-raised/70 border border-border/60 mx-auto"
                style={previewBoxStyle}
              >
                <img src={activeItem.previewBlob} alt="Live Preview" className="w-full h-full object-contain" />
                {isRunning && (
                  <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur font-medium">
                    live
                  </div>
                )}
              </div>
            ) : (activeItem.previewPaths?.[0] || activeItem.previewPath) ? (
              <div
                className="relative w-full h-56 rounded overflow-hidden bg-surface-raised/70 border border-border/60 cursor-pointer hover:bg-surface-overlay/60 transition-colors"
                onClick={() => {
                  const path = activeItem.previewPaths?.[0] || activeItem.previewPath;
                  if (path) onSelectPreview?.({ ...activeItem, selectedPath: path });
                }}
              >
                <div className="w-full h-full flex flex-col items-center justify-center text-xs text-muted-foreground">
                  <span className="font-semibold">ready</span>
                  <span className="text-[10px]">click to view</span>
                </div>
              </div>
            ) : (
              <div className="w-full h-56 rounded bg-surface-raised/70 border border-border/60" />
            )}

            {/* Progress */}
            <div className="space-y-1">
              <div className="flex justify-between text-[9px] text-foreground/80 tracking-wider font-semibold">
                <span className="lowercase">{activeItem.status}</span>
                <span className="text-foreground">{Math.round(activeItem.progress)}%</span>
              </div>
              <Progress value={activeItem.progress} className="h-1.5" />

              {/* Stats row - only show when running or has data */}
              {(isRunning || hasStats) && (
                <div className="flex justify-between text-[9px] text-muted-foreground pt-0.5">
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
                  {isGenerating ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  )}
                  {isGenerating ? 'generating...' : 'generate'}
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="shadow-lg border border-border/80 bg-card/95 ring-1 ring-black/5 dark:ring-white/5 backdrop-blur overflow-hidden rounded-lg" style={{ width: '320px', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="flex-1 p-3 flex flex-col items-center justify-center text-center space-y-2 text-muted-foreground">
            <div className="w-8 h-8 rounded-full bg-muted/30 flex items-center justify-center mb-1">
              <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
            </div>
            <div className="text-xs font-medium text-muted-foreground">ready to generate</div>
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
                {isGenerating ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )}
                {isGenerating ? 'generating...' : 'generate'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
