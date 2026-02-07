import React from "react";
import { ChevronLeft, ChevronRight, Copy, Search, X } from "lucide-react";

import { PromptLibraryItem, IMAGE_API_BASE } from "@/lib/api";
import { isVideoFile } from "@/lib/media";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MediaMetadataDialog } from "@/components/MediaMetadataDialog";

interface PromptLibraryQuickPanelProps {
  open: boolean;
  prompts: PromptLibraryItem[];
  searchValue: string;
  loading?: boolean;
  error?: string | null;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onClose: () => void;
  onApply: (prompt: PromptLibraryItem) => void;
}

const PAGE_SIZE = 20;

export function PromptLibraryQuickPanel({
  open,
  prompts,
  searchValue,
  loading,
  error,
  onSearchChange,
  onSearchSubmit,
  onClose,
  onApply,
}: PromptLibraryQuickPanelProps) {
  const [page, setPage] = React.useState(0);
  const [previewItem, setPreviewItem] = React.useState<PromptLibraryItem | null>(null);
  const [metadataItem, setMetadataItem] = React.useState<PromptLibraryItem | null>(null);

  React.useEffect(() => {
    setPage(0);
  }, [searchValue, prompts.length]);

  if (!open) return null;

  const pageCount = Math.max(1, Math.ceil(prompts.length / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const pageItems = prompts.slice(pageStart, pageStart + PAGE_SIZE);

  const copyText = (value?: string | null) => {
    if (!value) return;
    void navigator.clipboard.writeText(value);
  };

  return (
    <>
      <div className="w-80 pointer-events-auto">
        <Card className="shadow-md border border-border bg-surface/95 ring-1 ring-black/5 dark:ring-white/5 backdrop-blur">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border bg-surface-raised/80 cursor-move">
            <div className="font-semibold text-foreground text-xs">prompt library</div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="p-2 space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchValue}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search prompt media"
                  className="pl-8 h-8 text-xs"
                />
              </div>
              <Button size="sm" variant="outline" className="h-8 text-xs px-2" onClick={onSearchSubmit}>
                Go
              </Button>
            </div>

            {error && <div className="text-xs text-destructive">{error}</div>}
            {loading && <div className="text-xs text-muted-foreground">Loading prompt library...</div>}

            <ScrollArea className="h-64 pr-2">
                <div className="grid grid-cols-2 gap-2">
                {pageItems.length === 0 && !loading && (
                  <div className="col-span-2 text-xs text-muted-foreground">No matching media.</div>
                )}
                {pageItems.map((prompt) => {
                  const src = `${IMAGE_API_BASE}/gallery/image/path?path=${encodeURIComponent(prompt.preview_path)}`;
                  const isVideo = isVideoFile(prompt.preview_path);
                  return (
                    <ContextMenu key={`prompt-media-${prompt.image_id}-${prompt.created_at}`}>
                      <ContextMenuTrigger>
                        <div
                          className="border border-border rounded-lg overflow-hidden bg-background/80 cursor-pointer hover:bg-hover/30 transition-colors"
                          onClick={() => setPreviewItem(prompt)}
                        >
                          <div className="aspect-square bg-muted/30">
                            {isVideo ? (
                              <video src={src} className="w-full h-full object-contain" preload="metadata" muted playsInline />
                            ) : (
                              <img src={src} className="w-full h-full object-contain" alt={prompt.prompt_name || `Image ${prompt.image_id}`} />
                            )}
                          </div>
                          <div className="p-1.5 space-y-1">
                            <p className="text-[10px] line-clamp-1 text-foreground/80">{prompt.prompt_name || `image #${prompt.image_id}`}</p>
                            <div className="flex items-center justify-between">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyText(prompt.active_positive || "");
                                }}
                                title="Copy positive prompt"
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyText(prompt.active_negative || "");
                                }}
                                title="Copy negative prompt"
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyText(prompt.caption || "");
                                }}
                                title="Copy caption"
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onSelect={() => onApply(prompt)}>load to configurator</ContextMenuItem>
                        <ContextMenuItem onSelect={() => setPreviewItem(prompt)}>open preview</ContextMenuItem>
                        <ContextMenuItem onSelect={() => setMetadataItem(prompt)}>metadata</ContextMenuItem>
                        <ContextMenuItem onSelect={() => copyText(prompt.active_positive || "")}>copy positive prompt</ContextMenuItem>
                        <ContextMenuItem onSelect={() => copyText(prompt.active_negative || "")}>copy negative prompt</ContextMenuItem>
                        <ContextMenuItem onSelect={() => copyText(prompt.caption || "")}>copy caption</ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page <= 0}
                onClick={() => setPage((prev) => Math.max(0, prev - 1))}
              >
                <ChevronLeft className="w-3 h-3 mr-1" />
                prev
              </Button>
              <span className="text-[10px] text-muted-foreground">
                page {page + 1} / {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((prev) => Math.min(pageCount - 1, prev + 1))}
              >
                next
                <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Dialog open={previewItem !== null} onOpenChange={(nextOpen) => { if (!nextOpen) setPreviewItem(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewItem?.prompt_name || `image #${previewItem?.image_id}`}</DialogTitle>
          </DialogHeader>
          {previewItem && (
            <div className="space-y-3">
              <img
                src={`${IMAGE_API_BASE}/gallery/image/path?path=${encodeURIComponent(previewItem.preview_path)}`}
                alt={previewItem.prompt_name || `image #${previewItem.image_id}`}
                className="w-full max-h-[65vh] object-contain rounded border border-border/60 bg-muted/20"
              />
              <div className="grid grid-cols-1 gap-2 text-xs">
                <span className="font-semibold text-foreground">positive</span>
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 absolute top-1 right-1 z-10"
                    onClick={() => copyText(previewItem.active_positive || "")}
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                  <p className="rounded border border-border/60 bg-muted/20 p-2 pr-9 whitespace-pre-wrap">{previewItem.active_positive || "none"}</p>
                </div>
                <span className="font-semibold text-foreground">negative</span>
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 absolute top-1 right-1 z-10"
                    onClick={() => copyText(previewItem.active_negative || "")}
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                  <p className="rounded border border-border/60 bg-muted/20 p-2 pr-9 whitespace-pre-wrap">{previewItem.active_negative || "none"}</p>
                </div>
                <span className="font-semibold text-foreground">caption</span>
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 absolute top-1 right-1 z-10"
                    onClick={() => copyText(previewItem.caption || "")}
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                  <p className="rounded border border-border/60 bg-muted/20 p-2 pr-9 whitespace-pre-wrap">{previewItem.caption || "none"}</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <MediaMetadataDialog
        open={metadataItem !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setMetadataItem(null);
        }}
        mediaPath={metadataItem?.preview_path || null}
        imageId={metadataItem?.image_id ?? null}
      />
    </>
  );
}
