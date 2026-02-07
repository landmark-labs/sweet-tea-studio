import React from "react";
import { Copy, Loader2, Search } from "lucide-react";

import { api, IMAGE_API_BASE, PromptLibraryItem } from "@/lib/api";
import { savePipeParams } from "@/lib/persistedState";
import { Button } from "@/components/ui/button";
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
import { useLibraryPageStore } from "@/lib/stores/pageStateStores";

const PAGE_SIZE = 60;

export default function PromptLibrary() {
  const searchInput = useLibraryPageStore((s) => s.searchInput);
  const setSearchInput = useLibraryPageStore((s) => s.setSearchInput);
  const query = useLibraryPageStore((s) => s.query);
  const setQuery = useLibraryPageStore((s) => s.setQuery);
  const [items, setItems] = React.useState<PromptLibraryItem[]>([]);
  const [offset, setOffset] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [previewItem, setPreviewItem] = React.useState<PromptLibraryItem | null>(null);
  const [metadataItem, setMetadataItem] = React.useState<PromptLibraryItem | null>(null);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  const copyText = React.useCallback((value?: string | null) => {
    if (!value) return;
    void navigator.clipboard.writeText(value);
  }, []);

  const load = React.useCallback(
    async (opts?: { reset?: boolean }) => {
      const reset = opts?.reset ?? false;
      const nextOffset = reset ? 0 : offset;
      if (reset) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const res = await api.searchPromptMedia({
          query,
          offset: nextOffset,
          limit: PAGE_SIZE,
        });
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
        setOffset(nextOffset + res.items.length);
        setHasMore(res.has_more);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load prompt media");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [offset, query]
  );

  React.useEffect(() => {
    void load({ reset: true });
  }, [query, load]);

  React.useEffect(() => {
    if (!sentinelRef.current) return;
    if (!hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting && !loading && !loadingMore && hasMore) {
          void load({ reset: false });
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, load, loading, loadingMore]);

  const handleSearchSubmit = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      setItems([]);
      setOffset(0);
      setHasMore(true);
      setQuery(searchInput.trim());
    },
    [searchInput, setQuery]
  );

  const handleApplyToConfigurator = React.useCallback((item: PromptLibraryItem) => {
    if (!item.workflow_template_id || !item.job_params) return;
    void savePipeParams(String(item.workflow_template_id), item.job_params as Record<string, unknown>);
    localStorage.setItem("ds_selected_workflow", String(item.workflow_template_id));
  }, []);

  return (
    <div className="h-full overflow-auto pt-4 pr-8 pb-8 pl-[83px] max-w-[1600px] space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">prompt library</h1>
        <form onSubmit={handleSearchSubmit} className="w-full max-w-xl flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
              placeholder="Search prompts, negatives, captions, tags..."
            />
          </div>
          <Button type="submit">search</Button>
        </form>
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="h-40 flex items-center justify-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          loading...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {items.map((item) => (
              <ContextMenu key={`prompt-item-${item.image_id}-${item.created_at}`}>
                <ContextMenuTrigger>
                  <div
                    className="rounded-lg border border-border/60 bg-card overflow-hidden cursor-pointer hover:shadow-md hover:border-primary/40 transition-all"
                    onClick={() => setPreviewItem(item)}
                  >
                    <div className="aspect-square bg-muted/20">
                      <img
                        src={`${IMAGE_API_BASE}/gallery/image/path?path=${encodeURIComponent(item.preview_path)}`}
                        alt={item.prompt_name || `image #${item.image_id}`}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div className="p-2 space-y-1">
                      <p className="text-xs font-medium line-clamp-1">{item.prompt_name || `image #${item.image_id}`}</p>
                      <p className="text-[10px] text-muted-foreground line-clamp-1">{new Date(item.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => setPreviewItem(item)}>open preview</ContextMenuItem>
                  <ContextMenuItem onSelect={() => handleApplyToConfigurator(item)}>load to configurator</ContextMenuItem>
                  <ContextMenuItem onSelect={() => setMetadataItem(item)}>metadata</ContextMenuItem>
                  <ContextMenuItem onSelect={() => copyText(item.active_positive || "")}>copy positive prompt</ContextMenuItem>
                  <ContextMenuItem onSelect={() => copyText(item.active_negative || "")}>copy negative prompt</ContextMenuItem>
                  <ContextMenuItem onSelect={() => copyText(item.caption || "")}>copy caption</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>

          <div ref={sentinelRef} className="h-10 flex items-center justify-center text-xs text-muted-foreground">
            {loadingMore ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                loading more...
              </span>
            ) : hasMore ? (
              "scroll for more"
            ) : (
              "end of results"
            )}
          </div>
        </>
      )}

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
              <div className="space-y-2 text-xs">
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
        onUpdated={({ caption }) => {
          if (!metadataItem) return;
          setItems((prev) =>
            prev.map((entry) =>
              entry.image_id === metadataItem.image_id
                ? { ...entry, caption: caption || undefined }
                : entry
            )
          );
        }}
      />
    </div>
  );
}

