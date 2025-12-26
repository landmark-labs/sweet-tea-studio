import React, { useState } from "react";
import { GalleryItem } from "@/lib/api";
import { isVideoFile } from "@/lib/media";
import { Card } from "@/components/ui/card";
import { RefreshCw, Trash2, Check, CheckCircle2, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";

// Hover-to-play video thumbnail component
function VideoThumbnail({ src, className }: { src: string; className?: string }) {
    const videoRef = React.useRef<HTMLVideoElement>(null);

    const handleMouseEnter = React.useCallback(() => {
        if (videoRef.current) {
            videoRef.current.play().catch(() => { });
        }
    }, []);

    const handleMouseLeave = React.useCallback(() => {
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
        }
    }, []);

    return (
        <video
            ref={videoRef}
            src={src}
            className={className}
            preload="metadata"
            muted
            playsInline
            loop
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        />
    );
}

interface RunningGalleryProps {
    images: GalleryItem[];
    selectedIds: Set<number>;
    onRefresh?: () => void;
    onSelectionChange?: (ids: Set<number>) => void;
    onLoadParams?: (item: GalleryItem) => void;
    onDelete?: (ids: Set<number>) => void;
    onPreview?: (item: GalleryItem) => void;
}

export function RunningGallery({
    images,
    selectedIds,
    onRefresh,
    onSelectionChange,
    onLoadParams,
    onDelete,
    onPreview
}: RunningGalleryProps) {
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, item: GalleryItem } | null>(null);

    // Context menu close
    React.useEffect(() => {
        const closeMenu = () => setContextMenu(null);
        window.addEventListener("click", closeMenu);
        return () => window.removeEventListener("click", closeMenu);
    }, []);

    const handleCardClick = (e: React.MouseEvent, item: GalleryItem) => {
        // Handle selection modifiers
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.stopPropagation();
            if (!onSelectionChange) return;

            const newSelected = new Set(selectedIds);
            if (newSelected.has(item.image.id)) {
                newSelected.delete(item.image.id);
            } else {
                newSelected.add(item.image.id);
            }
            onSelectionChange(newSelected);
        } else {
            // Normal click usually means "Preview this"
            // But we also want to clear selection if we had one?
            // User expectation: Click = Preview.
            // If selection active, Click off = Clear selection?

            if (selectedIds.size > 0 && onSelectionChange) {
                onSelectionChange(new Set());
            }
            if (onPreview) onPreview(item);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, item: GalleryItem) => {
        e.preventDefault();
        const menuWidth = 160;
        const menuHeight = 100;
        let x = e.clientX;
        let y = e.clientY;

        if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
        if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;

        setContextMenu({ x, y, item });
    };

    const handleDeleteSelected = () => {
        if (!onDelete || selectedIds.size === 0) return;
        if (!confirm(`Delete ${selectedIds.size} images?`)) return;
        onDelete(selectedIds);
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 border-l border-slate-200 w-full max-w-xs transition-all relative">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-white">
                <h3 className="font-semibold text-slate-800">
                    {selectedIds.size > 0 ? `${selectedIds.size} Selected` : "Recent"}
                </h3>
                <div className="flex items-center gap-1">
                    {selectedIds.size > 0 && (
                        <Button variant="destructive" size="icon" className="h-6 w-6" onClick={handleDeleteSelected}>
                            <Trash2 className="w-3 h-3" />
                        </Button>
                    )}
                    <button onClick={onRefresh} className="text-slate-500 hover:text-slate-800" title="Refresh Gallery">
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                {images.map((item) => {
                    const isSelected = selectedIds.has(item.image.id);
                    const isVideo = isVideoFile(item.image.path, item.image.filename);
                    const mediaUrl = `/api/v1/gallery/image/path?path=${encodeURIComponent(item.image.path)}`;
                    return (
                        <Card
                            key={item.image.id}
                            className={`cursor-pointer overflow-hidden transition-all group relative border-2 select-none ${isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-transparent hover:border-slate-300'}`}
                            onClick={(e) => handleCardClick(e, item)}
                            onContextMenu={(e) => handleContextMenu(e, item)}
                            draggable
                            onDragStart={(e) => {
                                const url = mediaUrl;
                                e.dataTransfer.setData("text/plain", url);
                                e.dataTransfer.setData("text/uri-list", url);
                            }}
                        >
                            <div className="aspect-square bg-slate-200 relative">
                                {isVideo ? (
                                    <VideoThumbnail
                                        src={mediaUrl}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <img
                                        src={mediaUrl}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                    />
                                )}
                                {item.image.is_kept && (
                                    <div className="absolute top-1 right-1 bg-green-500 text-white rounded-full p-0.5 shadow-sm">
                                        <Check className="w-3 h-3" />
                                    </div>
                                )}
                                {isSelected && (
                                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                                        <CheckCircle2 className="w-8 h-8 text-primary fill-white" />
                                    </div>
                                )}
                            </div>
                        </Card>
                    );
                })}
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-50 bg-white border border-slate-200 rounded shadow-xl py-1 w-40 text-sm"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div
                        className="px-3 py-2 hover:bg-slate-100 cursor-pointer flex items-center gap-2"
                        onClick={() => {
                            if (onLoadParams) onLoadParams(contextMenu.item);
                            setContextMenu(null);
                        }}
                    >
                        <RotateCcw className="w-4 h-4 text-slate-500" />
                        <span>Regenerate</span>
                    </div>
                </div>
            )}
        </div>
    );
}
