import React, { useEffect, useState } from "react";
import { api, GalleryItem } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { RefreshCw, Trash2, Check, CheckCircle2, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";

interface RunningGalleryProps {
    onRefresh?: number;
    onSelect?: (item: GalleryItem) => void;
    onLoadParams?: (item: GalleryItem) => void;
}

export function RunningGallery({ onRefresh, onSelect, onLoadParams }: RunningGalleryProps) {
    const [images, setImages] = useState<GalleryItem[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, item: GalleryItem } | null>(null);

    const loadGallery = async () => {
        try {
            // Include kept_only=false to show everything, but maybe we want to filter? 
            // Current behavior shows all recent.
            const allImages = await api.getGallery();
            setImages(allImages.slice(0, 50));
        } catch (e) {
            console.error("Failed to load running gallery", e);
        }
    };

    useEffect(() => {
        loadGallery();
        // Close context menu on global click
        const closeMenu = () => setContextMenu(null);
        window.addEventListener("click", closeMenu);
        return () => window.removeEventListener("click", closeMenu);
    }, [onRefresh]);

    const handleCardClick = (e: React.MouseEvent, item: GalleryItem) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.stopPropagation();
            const newSelected = new Set(selectedIds);
            if (newSelected.has(item.image.id)) {
                newSelected.delete(item.image.id);
            } else {
                newSelected.add(item.image.id);
            }
            setSelectedIds(newSelected);
        } else {
            if (selectedIds.size > 0) {
                setSelectedIds(new Set());
            }
            onSelect?.(item);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, item: GalleryItem) => {
        e.preventDefault();
        const menuWidth = 160; // w-40 = 10rem = 160px
        const menuHeight = 100; // Approximate max height

        let x = e.clientX;
        let y = e.clientY;

        // Prevent Right Overflow
        if (x + menuWidth > window.innerWidth) {
            x = window.innerWidth - menuWidth - 8;
        }

        // Prevent Bottom Overflow
        if (y + menuHeight > window.innerHeight) {
            y = window.innerHeight - menuHeight - 8;
        }

        setContextMenu({ x, y, item });
    };

    const handleDeleteSelected = async () => {
        if (!confirm(`Delete ${selectedIds.size} images?`)) return;

        try {
            await Promise.all(
                Array.from(selectedIds).map(id => api.deleteImage(id))
            );
            setSelectedIds(new Set());
            loadGallery();
        } catch (e) {
            alert("Failed to delete some images");
            loadGallery();
        }
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
                    <button onClick={void loadGallery} className="text-slate-500 hover:text-slate-800">
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {images.map((item) => {
                    const isSelected = selectedIds.has(item.image.id);
                    return (
                        <Card
                            key={item.image.id}
                            className={`cursor-pointer overflow-hidden transition-all group relative border-2 ${isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-transparent hover:border-slate-300'}`}
                            onClick={(e) => handleCardClick(e, item)}
                            onContextMenu={(e) => handleContextMenu(e, item)}
                            draggable
                            onDragStart={(e) => {
                                const url = `/api/v1/gallery/image/path?path=${encodeURIComponent(item.image.path)}`;
                                e.dataTransfer.setData("text/plain", url);
                                e.dataTransfer.setData("text/uri-list", url);
                            }}
                        >
                            <div className="aspect-square bg-slate-200 relative">
                                <img
                                    src={`/api/v1/gallery/image/path?path=${encodeURIComponent(item.image.path)}`}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />
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
