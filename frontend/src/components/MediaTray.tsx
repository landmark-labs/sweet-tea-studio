import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, GripVertical, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IMAGE_API_BASE } from "@/lib/api";
import { useMediaTrayStore, type MediaTrayItem } from "@/lib/stores/mediaTrayStore";
import { isVideoFile } from "@/lib/media";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const THUMBNAIL_MAX_PX = 256;
const THUMBNAIL_URL_VERSION = 2;

const buildMediaUrl = (path: string) =>
  `${IMAGE_API_BASE}/gallery/image/path?path=${encodeURIComponent(path)}`;

const buildThumbnailUrl = (path: string, maxPx: number = THUMBNAIL_MAX_PX) => {
  const params = new URLSearchParams({
    path,
    max_px: String(maxPx),
    thumb_v: String(THUMBNAIL_URL_VERSION),
  });
  return `${IMAGE_API_BASE}/gallery/image/path/thumbnail?${params.toString()}`;
};

type MediaTrayProps = {
  className?: string;
  onShowInViewer?: (path: string, items: MediaTrayItem[]) => void;
};

type SortableTrayCellProps = {
  item: MediaTrayItem;
  reorderMode: boolean;
  onClick: (item: MediaTrayItem) => void;
  onShowInViewer?: (path: string) => void;
  onRemove?: (path: string) => void;
  onExternalDragStart?: (e: React.DragEvent, item: MediaTrayItem) => void;
  onLongPressStart?: (item: MediaTrayItem, event: React.PointerEvent) => void;
  onLongPressEnd?: () => void;
};

function SortableTrayCell({
  item,
  reorderMode,
  onClick,
  onShowInViewer,
  onRemove,
  onExternalDragStart,
  onLongPressStart,
  onLongPressEnd,
}: SortableTrayCellProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.path,
    disabled: !reorderMode,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
  };

  const isVideo = isVideoFile(item.path, item.filename) || item.kind === "video";
  const thumbUrl = useMemo(() => buildThumbnailUrl(item.path), [item.path]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          className={cn(
            "relative aspect-square rounded overflow-hidden border transition-all select-none group",
            reorderMode ? "cursor-grab border-slate-300 bg-slate-50" : "cursor-pointer border-slate-200 hover:border-blue-400 hover:shadow-sm bg-white",
            isDragging ? "ring-2 ring-blue-500" : ""
          )}
          draggable={!reorderMode}
          onDragStart={(e) => onExternalDragStart?.(e, item)}
          onClick={() => onClick(item)}
          onPointerDown={(e) => onLongPressStart?.(item, e)}
          onPointerUp={onLongPressEnd}
          onPointerCancel={onLongPressEnd}
          onPointerLeave={onLongPressEnd}
          {...(reorderMode ? { ...attributes, ...listeners } : {})}
          title={item.filename}
        >
          <img
            src={thumbUrl}
            alt={item.filename}
            className={cn("w-full h-full object-cover", reorderMode ? "opacity-95" : "")}
            loading="lazy"
            decoding="async"
          />

          {isVideo && (
            <div className="absolute top-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
              video
            </div>
          )}

          {reorderMode && (
            <div className="absolute bottom-1 right-1 bg-white/80 text-slate-700 rounded p-0.5">
              <GripVertical className="w-3 h-3" />
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[9px] p-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="truncate">{item.filename}</div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onShowInViewer?.(item.path)}>
          <span className="flex items-center gap-2">
            <Eye className="w-4 h-4" />
            show in viewer
          </span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-red-600" onSelect={() => onRemove?.(item.path)}>
          <span className="flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
            remove from tray
          </span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function MediaTrayPreview({
  item,
  onClose,
}: {
  item: MediaTrayItem;
  onClose: () => void;
}) {
  const isVideo = isVideoFile(item.path, item.filename) || item.kind === "video";
  const url = useMemo(() => buildMediaUrl(item.path), [item.path]);

  return (
    <div
      className="fixed inset-0 z-[9998] bg-black/30 flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        className="relative bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden w-[420px] max-w-[92vw]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50">
          <div className="text-xs font-semibold text-slate-700 truncate pr-2">{item.filename}</div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="Close preview">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="bg-slate-100 flex items-center justify-center">
          {isVideo ? (
            <video src={url} className="w-full max-h-[420px] object-contain" controls preload="metadata" playsInline />
          ) : (
            <img src={url} alt={item.filename} className="w-full max-h-[420px] object-contain" />
          )}
        </div>
      </div>
    </div>
  );
}

export function MediaTray({ className, onShowInViewer }: MediaTrayProps) {
  const collapsed = useMediaTrayStore(useCallback((s) => s.collapsed, []));
  const setCollapsed = useMediaTrayStore(useCallback((s) => s.setCollapsed, []));
  const toggleCollapsed = useMediaTrayStore(useCallback((s) => s.toggleCollapsed, []));
  const items = useMediaTrayStore(useCallback((s) => s.items, []));
  const clearAll = useMediaTrayStore(useCallback((s) => s.clearAll, []));
  const removePath = useMediaTrayStore(useCallback((s) => s.removePath, []));
  const reorderByPath = useMediaTrayStore(useCallback((s) => s.reorderByPath, []));

  const [previewItem, setPreviewItem] = useState<MediaTrayItem | null>(null);
  const [reorderMode, setReorderMode] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);

  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: reorderMode ? { distance: 4 } : { distance: 9999 },
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!active?.id || !over?.id) return;
      reorderByPath(String(active.id), String(over.id));
    },
    [reorderByPath]
  );

  const handleExternalDragStart = useCallback((e: React.DragEvent, item: MediaTrayItem) => {
    clearLongPressTimer();
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-sweet-tea-image", item.path);
    e.dataTransfer.setData("text/plain", item.path);
  }, [clearLongPressTimer]);

  const handleCellClick = useCallback(
    (item: MediaTrayItem) => {
      if (reorderMode) return;
      if (longPressTriggeredRef.current) {
        longPressTriggeredRef.current = false;
        return;
      }
      setPreviewItem(item);
    },
    [reorderMode]
  );

  const handleShowInViewer = useCallback(
    (path: string) => {
      onShowInViewer?.(path, items);
    },
    [items, onShowInViewer]
  );

  const handleLongPressStart = useCallback(
    (_item: MediaTrayItem, event: React.PointerEvent) => {
      if (reorderMode) return;
      if (event.button !== 0) return;
      clearLongPressTimer();
      longPressTriggeredRef.current = false;
      longPressStartRef.current = { x: event.clientX, y: event.clientY };
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true;
        longPressTimerRef.current = null;
        longPressStartRef.current = null;
        setReorderMode(true);
      }, 260);
    },
    [clearLongPressTimer, reorderMode]
  );

  const handleLongPressEnd = useCallback(() => {
    clearLongPressTimer();
  }, [clearLongPressTimer]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!longPressTimerRef.current || !longPressStartRef.current) return;
      const dx = event.clientX - longPressStartRef.current.x;
      const dy = event.clientY - longPressStartRef.current.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 8) {
        clearLongPressTimer();
      }
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [clearLongPressTimer]);

  useEffect(() => {
    if (!reorderMode) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || !trayRef.current) return;
      if (trayRef.current.contains(target)) return;
      setReorderMode(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [reorderMode]);

  useEffect(() => {
    if (collapsed) setReorderMode(false);
  }, [collapsed]);

  if (collapsed) {
    return (
      <div className={cn("flex-none w-10 bg-white border-l flex flex-col items-center py-3 h-full", className)}>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setCollapsed(false)}
          title="Expand Media Tray"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="mt-4 [writing-mode:vertical-rl] [text-orientation:mixed] text-xs text-slate-400 font-medium tracking-wider whitespace-nowrap">
          media tray
        </div>
      </div>
    );
  }

  return (
    <div ref={trayRef} className={cn("flex-none w-40 bg-white border-l flex flex-col h-full overflow-hidden", className)}>
      <div className="flex-none p-3 border-b bg-slate-50/50">
        <div className="flex items-center">
          <div className="text-xs font-bold text-slate-800 tracking-wider">MEDIA TRAY</div>
          <button
            type="button"
            className="ml-2 flex-1 h-7 rounded hover:bg-slate-100 transition flex items-center justify-end pr-1"
            onClick={toggleCollapsed}
            title="Collapse Media Tray"
            aria-label="Collapse Media Tray"
          >
            <ChevronRight className="h-4 w-4 text-slate-600" />
          </button>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <div>
            {items.length} item{items.length === 1 ? "" : "s"}
          </div>
          {reorderMode ? (
            <div className="text-blue-600 font-semibold">reorder mode</div>
          ) : (
            <div className="text-slate-400">hold to reorder</div>
          )}
        </div>
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.path)} strategy={rectSortingStrategy}>
          <div className="flex-1 overflow-auto p-1">
            {items.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400 text-center px-4">
                Right-click an image and choose “add to media tray”
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1">
                {items.map((item) => (
                  <SortableTrayCell
                    key={item.path}
                    item={item}
                    reorderMode={reorderMode}
                    onClick={handleCellClick}
                    onShowInViewer={handleShowInViewer}
                    onRemove={removePath}
                    onExternalDragStart={handleExternalDragStart}
                    onLongPressStart={handleLongPressStart}
                    onLongPressEnd={handleLongPressEnd}
                  />
                ))}
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex-none p-3 border-t bg-slate-50">
        <Button
          variant="outline"
          size="sm"
          className="w-full h-8 text-xs"
          onClick={() => {
            if (items.length > 0) clearAll();
          }}
          disabled={items.length === 0}
          title="Clear all"
        >
          <Trash2 className="h-4 w-4 mr-1" />
          clear all
        </Button>
      </div>

      {previewItem && <MediaTrayPreview item={previewItem} onClose={() => setPreviewItem(null)} />}
    </div>
  );
}
