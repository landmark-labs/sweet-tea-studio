import React, { useEffect, useState } from "react";
import { api, GalleryItem } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { X, RefreshCw } from "lucide-react";

export function RunningGallery({ onRefresh, onSelect }: { onRefresh?: number; onSelect?: (item: GalleryItem) => void }) {
    const [images, setImages] = useState<GalleryItem[]>([]);

    const loadGallery = async () => {
        try {
            const allImages = await api.getGallery();
            // Take top 50 recent
            setImages(allImages.slice(0, 50));
        } catch (e) {
            console.error("Failed to load running gallery", e);
        }
    };

    useEffect(() => {
        loadGallery();
    }, [onRefresh]);

    return (
        <div className="h-full flex flex-col bg-slate-50 border-l border-slate-200 w-full max-w-xs transition-all">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">Recent</h3>
                <button onClick={loadGallery} className="text-slate-500 hover:text-slate-800">
                    <RefreshCw className="w-4 h-4" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {images.map((item) => (
                    <Card
                        key={item.image.id}
                        className="cursor-pointer overflow-hidden hover:ring-2 ring-primary transition-all group relative"
                        onClick={() => onSelect?.(item)}
                        draggable
                        onDragStart={(e) => {
                            const url = `/api/v1/gallery/image/path?path=${encodeURIComponent(item.image.path)}`;
                            e.dataTransfer.setData("text/plain", url);
                            e.dataTransfer.setData("text/uri-list", url);
                        }}
                    >
                        <div className="aspect-square bg-slate-200">
                            <img
                                src={`/api/v1/gallery/image/path?path=${encodeURIComponent(item.image.path)}`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                        </div>
                        {/* Hover details could go here */}
                    </Card>
                ))}
            </div>
        </div>
    );
}
