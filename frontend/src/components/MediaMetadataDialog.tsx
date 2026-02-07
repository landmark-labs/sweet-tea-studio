import React from "react";
import { Check, Copy, Loader2 } from "lucide-react";

import { api, type ImageMetadata, type ImageMetadataUpdate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { groupGenerationParamsByNode } from "@/lib/metadataParams";

interface MediaMetadataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mediaPath: string | null;
  imageId?: number | null;
  onUpdated?: (payload: { caption: string | null }) => void;
}

const extractRawPath = (pathStr: string): string => {
  if (!pathStr) return "";
  if (pathStr.includes("/api/") && pathStr.includes("path=")) {
    try {
      const url = new URL(pathStr, window.location.origin);
      const pathParam = url.searchParams.get("path");
      if (pathParam) return pathParam;
    } catch {
      return pathStr;
    }
  }
  return pathStr;
};

export function MediaMetadataDialog({
  open,
  onOpenChange,
  mediaPath,
  imageId,
  onUpdated,
}: MediaMetadataDialogProps) {
  const [metadata, setMetadata] = React.useState<ImageMetadata | null>(null);
  const [captionInput, setCaptionInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<"positive" | "negative" | "caption" | null>(null);

  const rawPath = React.useMemo(() => (mediaPath ? extractRawPath(mediaPath) : ""), [mediaPath]);

  const loadMetadata = React.useCallback(async () => {
    if (!rawPath || !open) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getImageMetadata(rawPath);
      let captionHistory = data.caption_history || [];
      if (!captionHistory.length) {
        if (imageId && imageId > 0) {
          captionHistory = await api.getCaptionHistoryByImageId(imageId);
        } else {
          captionHistory = await api.getCaptionHistoryByPath(rawPath);
        }
      }
      const merged: ImageMetadata = {
        ...data,
        caption_history: captionHistory,
      };
      setMetadata(merged);
      setCaptionInput(merged.caption || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load metadata");
      setMetadata(null);
      setCaptionInput("");
    } finally {
      setLoading(false);
    }
  }, [imageId, open, rawPath]);

  React.useEffect(() => {
    if (!open) return;
    void loadMetadata();
  }, [open, loadMetadata]);

  const handleCopy = React.useCallback((value: string, key: "positive" | "negative" | "caption") => {
    if (!value) return;
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied((prev) => (prev === key ? null : prev)), 1200);
    });
  }, []);

  const handleSave = React.useCallback(async () => {
    if (!rawPath) return;
    setSaving(true);
    setError(null);
    try {
      let response: ImageMetadataUpdate;
      if (imageId && imageId > 0) {
        response = await api.updateImage(imageId, { caption: captionInput, source: "manual" });
      } else {
        response = await api.updateImageMetadataByPath(rawPath, { caption: captionInput, source: "manual" });
      }

      setMetadata((prev) =>
        prev
          ? {
              ...prev,
              caption: response.caption ?? null,
              caption_history: response.caption_versions,
            }
          : prev
      );
      setCaptionInput(response.caption ?? "");
      onUpdated?.({ caption: response.caption ?? null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save caption");
    } finally {
      setSaving(false);
    }
  }, [captionInput, imageId, onUpdated, rawPath]);

  const positive = typeof metadata?.prompt === "string" ? metadata.prompt : "";
  const negative = typeof metadata?.negative_prompt === "string" ? metadata.negative_prompt : "";
  const groupedGenerationParams = React.useMemo(
    () => groupGenerationParamsByNode((metadata?.parameters as Record<string, unknown> | undefined) ?? null),
    [metadata?.parameters]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>media metadata</DialogTitle>
          <DialogDescription className="truncate">{rawPath || "No media selected"}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            loading metadata...
          </div>
        ) : (
          <ScrollArea className="max-h-[70vh] pr-3">
            <div className="space-y-4">
              {error && <div className="text-xs text-destructive">{error}</div>}

              <section className="space-y-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground">positive prompt</span>
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 absolute top-1 right-1 z-10"
                    onClick={() => handleCopy(positive, "positive")}
                  >
                    {copied === "positive" ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                  </Button>
                  <p className="text-xs bg-muted/30 rounded border border-border p-2 pr-9 whitespace-pre-wrap">{positive || "none"}</p>
                </div>
              </section>

              <section className="space-y-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground">negative prompt</span>
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 absolute top-1 right-1 z-10"
                    onClick={() => handleCopy(negative, "negative")}
                  >
                    {copied === "negative" ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                  </Button>
                  <p className="text-xs bg-muted/30 rounded border border-border p-2 pr-9 whitespace-pre-wrap">{negative || "none"}</p>
                </div>
              </section>

              <section className="space-y-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground">caption</span>
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 absolute top-1 right-1 z-10"
                    onClick={() => handleCopy(captionInput, "caption")}
                  >
                    {copied === "caption" ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                  </Button>
                  <Textarea
                    value={captionInput}
                    onChange={(e) => setCaptionInput(e.target.value)}
                    placeholder="Enter or paste caption..."
                    className="min-h-28 text-xs pr-9"
                  />
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleSave} disabled={saving || !rawPath}>
                    {saving && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                    save caption
                  </Button>
                </div>
              </section>

              <section className="space-y-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground">caption history</span>
                <div className="space-y-1">
                  {(metadata?.caption_history || []).map((row) => (
                    <div key={row.id} className="text-xs border border-border rounded p-2 bg-muted/20">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{new Date(row.created_at).toLocaleString()}</span>
                        <span className={row.is_active ? "text-success font-medium" : "text-muted-foreground"}>
                          {row.is_active ? "active" : "inactive"}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap">{row.caption}</p>
                    </div>
                  ))}
                  {(!metadata?.caption_history || metadata.caption_history.length === 0) && (
                    <div className="text-xs text-muted-foreground">no caption history</div>
                  )}
                </div>
              </section>

              <section className="space-y-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground">generation parameters</span>
                {groupedGenerationParams.length === 0 ? (
                  <div className="text-xs text-muted-foreground">no generation parameters detected</div>
                ) : (
                  <div className="space-y-2">
                    {groupedGenerationParams.map((group) => (
                      <div key={group.node} className="rounded border border-border/70 bg-muted/20 p-2">
                        <div className="text-xs font-semibold text-foreground mb-2">{group.node}</div>
                        <div className="grid grid-cols-[minmax(150px,220px)_1fr] gap-x-3 gap-y-1">
                          {group.items.map((entry) => (
                            <React.Fragment key={entry.key}>
                              <div className="text-xs text-muted-foreground truncate">{entry.label}</div>
                              <div className="text-xs font-mono text-foreground break-all">{entry.value}</div>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

