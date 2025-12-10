import React from "react";
import { Download, ExternalLink, X, Check, Trash2, ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";
import { api, Image as ApiImage, GalleryItem } from "@/lib/api";
import { cn } from "@/lib/utils";


interface ImageViewerProps {
    images: ApiImage[];
    galleryItems?: GalleryItem[];  // Full items with per-image metadata
    metadata?: Record<string, unknown>;  // Fallback for legacy callers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workflows?: any[];
    onSelectWorkflow?: (workflowId: string, imagePath?: string) => void;
    onImageUpdate?: (image: ApiImage) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onRegenerate?: (item: any) => void;
    onDelete?: (imageId: number) => void;
    selectedImagePath?: string;
}

export function ImageViewer({
    images,
    galleryItems,
    metadata,
    workflows = [],
    onSelectWorkflow,
    onImageUpdate,
    onRegenerate,
    onDelete,
    selectedImagePath
}: ImageViewerProps) {
    const [selectedIndex, setSelectedIndex] = React.useState<number>(0);
    const [contextMenu, setContextMenu] = React.useState<{ x: number, y: number } | null>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);


    const displayImages = React.useMemo(() => {
        if (selectedImagePath && !images.some((img) => img.path === selectedImagePath)) {
            // Extract raw file path if selectedImagePath is an API URL
            let rawFilePath = selectedImagePath;
            let isApiUrl = false;

            if (selectedImagePath.includes('/api/') && selectedImagePath.includes('?path=')) {
                isApiUrl = true;
                try {
                    const url = new URL(selectedImagePath, window.location.origin);
                    const pathParam = url.searchParams.get('path');
                    if (pathParam) {
                        rawFilePath = pathParam;
                    }
                } catch {
                    // If URL parsing fails, use as-is
                }
            }

            const synthetic: ApiImage = {
                id: -1,
                job_id: -1,
                // Store the original selectedImagePath for display purposes
                // but use _isApiPath to signal that it's already an API URL
                path: selectedImagePath,
                filename: rawFilePath.split(/[\\/]/).pop() || "preview.png",
                created_at: new Date().toISOString(),
                // @ts-expect-error - custom property to flag API URLs
                _isApiUrl: isApiUrl
            };
            return [synthetic, ...images];
        }
        return images;
    }, [images, selectedImagePath]);

    // Sync selected index with images length if it changes
    React.useEffect(() => {
        if (displayImages.length > 0) {
            if (selectedIndex >= displayImages.length) {
                setSelectedIndex(0);
            }
        }
    }, [displayImages, selectedIndex]);

    // Align selection when a specific image path is provided
    React.useEffect(() => {
        if (!selectedImagePath) return;
        const idx = displayImages.findIndex((img) => img.path === selectedImagePath);
        if (idx >= 0 && idx !== selectedIndex) {
            setSelectedIndex(idx);
        }
    }, [displayImages, selectedImagePath, selectedIndex]);

    const currentImage = displayImages[selectedIndex];
    const imagePath = currentImage?.path;

    // State for PNG-sourced metadata (fetched from the image file itself)
    const [pngMetadata, setPngMetadata] = React.useState<{
        prompt?: string | null;
        negative_prompt?: string | null;
        parameters: Record<string, unknown>;
        source: string;
    } | null>(null);
    const [metadataLoading, setMetadataLoading] = React.useState(false);

    // Fetch metadata from PNG when image path changes
    React.useEffect(() => {
        if (!imagePath) {
            setPngMetadata(null);
            return;
        }

        // Extract the actual file path from API URLs
        // e.g., "/api/v1/gallery/image/path?path=C%3A%5C..." -> "C:\..."
        let rawPath = imagePath;
        if (imagePath.includes('/api/') && imagePath.includes('?path=')) {
            try {
                const url = new URL(imagePath, window.location.origin);
                const pathParam = url.searchParams.get('path');
                if (pathParam) {
                    rawPath = pathParam;
                }
            } catch {
                // If URL parsing fails, use the path as-is
            }
        }

        setMetadataLoading(true);
        api.getImageMetadata(rawPath)
            .then((data) => {
                setPngMetadata({
                    prompt: data.prompt,
                    negative_prompt: data.negative_prompt,
                    parameters: data.parameters,
                    source: data.source
                });
            })
            .catch((err) => {
                console.warn("Failed to fetch image metadata:", err);
                setPngMetadata(null);
            })
            .finally(() => setMetadataLoading(false));
    }, [imagePath]);

    // Use PNG metadata as the authoritative source
    const currentMetadata = pngMetadata ? {
        prompt: pngMetadata.prompt,
        negative_prompt: pngMetadata.negative_prompt,
        job_params: pngMetadata.parameters,
        source: pngMetadata.source
    } : metadata;


    // Keyboard Shortcuts
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") {
                setSelectedIndex(prev => Math.max(0, prev - 1));
            }
            if (e.key === "ArrowRight") {
                setSelectedIndex(prev => Math.min(displayImages.length - 1, prev + 1));
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [currentImage, displayImages]);

    // Close menu on global click
    React.useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener("click", handleClick);
        return () => window.removeEventListener("click", handleClick);
    }, []);

    // Lightbox State
    const [lightboxOpen, setLightboxOpen] = React.useState(false);
    const [scale, setScale] = React.useState(1);
    const [position, setPosition] = React.useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = React.useState(false);
    const [dragStart, setDragStart] = React.useState({ x: 0, y: 0 });

    // Compute image display URL - avoid double-encoding if already an API URL
    const imageUrl = React.useMemo(() => {
        if (!imagePath) return "";
        // If the path is already an API URL, use it directly
        if (imagePath.startsWith('/api/') || imagePath.startsWith('http')) {
            return imagePath;
        }
        // Otherwise, construct the API URL
        return `/api/v1/gallery/image/path?path=${encodeURIComponent(imagePath)}`;
    }, [imagePath]);

    // Reset zoom on close
    React.useEffect(() => {
        if (!lightboxOpen) {
            setScale(1);
            setPosition({ x: 0, y: 0 });
        }
    }, [lightboxOpen]);

    const toggleFullScreen = () => {
        setLightboxOpen(!lightboxOpen);
        setContextMenu(null);
    };

    const handleWheel = (e: React.WheelEvent) => {
        if (!lightboxOpen) return;
        e.stopPropagation();
        const delta = e.deltaY * -0.001;
        const newScale = Math.min(Math.max(1, scale + delta), 4);
        setScale(newScale);
        if (newScale === 1) setPosition({ x: 0, y: 0 });
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (scale > 1) {
            setIsDragging(true);
            setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
            e.preventDefault();
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging && scale > 1) {
            setPosition({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleDownload = async () => {
        if (!currentImage) return;
        try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = currentImage.filename || "image.png";
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (e) {
            console.error("Download failed", e);
        }
    };



    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const menuWidth = 192; // w-48 = 12rem = 192px
        const menuHeight = 220; // Approximate max height (with workflows list etc)

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

        setContextMenu({ x, y });
    };

    // Filter workflows that take an image
    const imgWorkflows = workflows.filter(w => {
        const jsonStr = JSON.stringify(w.graph_json || {});
        return jsonStr.includes("LoadImage") || jsonStr.includes("VAEEncode");
    });

    if (!displayImages || displayImages.length === 0) {
        return (
            <div className="h-full flex items-center justify-center bg-slate-100 text-slate-400">
                Select a job or image to view
            </div>
        );
    }

    // Extract and process metadata for display
    // Heuristics removed as per user request to revert the spam filter patch


    return (
        <>
            <div ref={containerRef} className="h-full flex flex-col bg-white relative">

                {/* Image Area */}
                <div
                    className="flex-1 flex items-center justify-center p-8 overflow-hidden bg-slate-900/5 backdrop-blur-3xl cursor-default relative"
                    onDoubleClick={toggleFullScreen}
                    onContextMenu={handleContextMenu}
                >
                    {/* (Image Area Content Omitted for Brevity - Unchanged) */}
                    {displayImages.length > 1 && (
                        <>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/50 hover:bg-white/80 rounded-full"
                                onClick={(e) => { e.stopPropagation(); setSelectedIndex(p => Math.max(0, p - 1)); }}
                                disabled={selectedIndex === 0}
                            >
                                <ArrowLeft className="w-5 h-5 text-slate-800" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/50 hover:bg-white/80 rounded-full"
                                onClick={(e) => { e.stopPropagation(); setSelectedIndex(p => Math.min(displayImages.length - 1, p + 1)); }}
                                disabled={selectedIndex === displayImages.length - 1}
                            >
                                <ArrowRight className="w-5 h-5 text-slate-800" />
                            </Button>

                            {/* Thumbnails - Limited to last 12 images */}
                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 p-2 bg-black/20 backdrop-blur-sm rounded-lg overflow-x-auto max-w-[80%]">
                                {displayImages.slice(0, 12).map((img, idx) => {
                                    // Construct proper thumbnail URL
                                    const thumbUrl = img.path.startsWith('/api/') || img.path.startsWith('http')
                                        ? img.path
                                        : `/api/v1/gallery/image/path?path=${encodeURIComponent(img.path)}`;
                                    return (
                                        <div
                                            key={img.id !== -1 ? img.id : `synth-${idx}`}
                                            className={`w-12 h-12 rounded overflow-hidden cursor-pointer border-2 transition-all flex-shrink-0 ${idx === selectedIndex ? 'border-primary scale-105' : 'border-transparent opacity-70 hover:opacity-100'}`}
                                            onClick={(e) => { e.stopPropagation(); setSelectedIndex(idx); }}
                                        >
                                            <img src={thumbUrl} className="w-full h-full object-cover" alt="" />
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    <img
                        src={imageUrl}
                        className="max-w-full max-h-full object-contain shadow-2xl rounded-lg transition-all"
                        alt="Preview"
                    />


                </div>

                {/* Context Menu */}
                {contextMenu && (
                    <div
                        className="fixed z-[9999] bg-white border border-slate-200 rounded-md shadow-lg py-1 w-48 text-sm text-slate-700 font-medium"
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                    >
                        <div
                            className="px-3 py-2 hover:bg-slate-100 cursor-pointer flex items-center gap-2"
                            onClick={toggleFullScreen}
                        >
                            {lightboxOpen ? <React.Fragment><ExternalLink size={14} className="rotate-180" /> Exit Full Screen</React.Fragment> : <React.Fragment><ExternalLink size={14} /> Full Screen</React.Fragment>}
                        </div>
                        <div
                            className="px-3 py-2 hover:bg-slate-100 cursor-pointer flex items-center gap-2"
                            onClick={handleDownload}
                        >
                            <Download size={14} /> Download
                        </div>
                        <div className="h-px bg-slate-100 my-1" />

                        {onRegenerate && (
                            <div
                                className="px-3 py-2 hover:bg-slate-100 cursor-pointer flex items-center gap-2 text-slate-700"
                                onClick={() => {
                                    onRegenerate(currentMetadata || {});
                                    setContextMenu(null);
                                }}
                            >
                                <RotateCcw size={14} /> Regenerate
                            </div>
                        )}

                        {imgWorkflows.length > 0 && (
                            <div className="relative group">
                                <div className="px-3 py-2 hover:bg-slate-100 cursor-pointer flex items-center justify-between">
                                    <span className="flex items-center gap-2">use in pipe</span>
                                    <span className="text-xs">▶</span>
                                </div>
                                <div className="absolute left-full top-0 ml-1 hidden group-hover:block bg-white border border-slate-200 rounded-md shadow-lg py-1 w-48 max-h-64 overflow-y-auto">
                                    {imgWorkflows.map(w => (
                                        <div
                                            key={w.id}
                                            className="px-3 py-2 hover:bg-slate-100 cursor-pointer truncate"
                                            onClick={() => {
                                                onSelectWorkflow?.(String(w.id), imagePath || undefined);
                                                setLightboxOpen(false); // Close lightbox if selecting
                                            }}
                                        >
                                            {w.name}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Bottom Panel: Toolbar + Metadata - Takes ~35% of container height */}
                <div className="border-t bg-white flex flex-col" style={{ height: '35%', minHeight: '200px' }}>
                    {/* Toolbar Row */}
                    <div className="px-4 py-2 border-b bg-slate-50 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
                        {/* Left: Actions */}
                        <div className="flex items-center gap-2">
                            {imgWorkflows.length > 0 && (
                                <div className="relative group/wf">
                                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1 border-blue-200 hover:bg-blue-50 text-blue-700">
                                        use in pipe ▶
                                    </Button>
                                    <div className="absolute left-0 top-full mt-1 hidden group-hover/wf:block bg-white border border-slate-200 rounded-md shadow-lg py-1 w-48 max-h-64 overflow-y-auto z-50">
                                        {imgWorkflows.map(w => (
                                            <div key={w.id} className="px-3 py-2 hover:bg-slate-100 cursor-pointer truncate text-xs" onClick={() => onSelectWorkflow?.(String(w.id), imagePath || undefined)}>
                                                {w.name}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                        </div>
                        {/* Right: Keep/Download */}
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={handleDownload} className="h-7 text-xs">
                                <Download className="w-3 h-3 mr-1" />Download
                            </Button>
                        </div>
                    </div>

                    {/* Metadata Section - Scrollable */}
                    <div className="flex-1 overflow-y-auto px-4 py-3">
                        {/* Header */}
                        <div className="flex items-baseline justify-between mb-3">
                            <h3 className="text-sm font-semibold text-slate-800 truncate">{currentImage?.filename}</h3>
                            <span className="text-[10px] text-slate-400 font-mono ml-2 flex-shrink-0">{currentImage?.created_at ? new Date(currentImage.created_at).toLocaleString() : ""}</span>
                        </div>

                        {currentMetadata && (
                            <div className="space-y-3">
                                {/* Positive Prompt - Full width, auto-height */}
                                {currentMetadata.prompt && (
                                    <div className="w-full">
                                        <span className="font-medium text-slate-500 text-[10px] uppercase block mb-1">Positive Prompt</span>
                                        <p className="text-slate-700 bg-slate-50 p-2 rounded border text-[11px] font-mono whitespace-pre-wrap leading-relaxed w-full">
                                            {String(currentMetadata.prompt)}
                                        </p>
                                    </div>
                                )}

                                {/* Negative Prompt - Full width, auto-height */}
                                {currentMetadata.negative_prompt && (
                                    <div className="w-full">
                                        <span className="font-medium text-slate-500 text-[10px] uppercase block mb-1">Negative Prompt</span>
                                        <p className="text-slate-700 bg-red-50/50 p-2 rounded border border-red-100 text-[11px] font-mono whitespace-pre-wrap leading-relaxed w-full">
                                            {String(currentMetadata.negative_prompt)}
                                        </p>
                                    </div>
                                )}

                                {/* Parameters Grid */}
                                {currentMetadata.job_params && typeof currentMetadata.job_params === 'object' && Object.keys(currentMetadata.job_params).length > 0 && (
                                    <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-x-4 gap-y-2 pt-2 border-t border-slate-100">
                                        {Object.entries(currentMetadata.job_params as Record<string, unknown>)
                                            .filter(([, v]) => v !== null && v !== undefined && v !== "" && typeof v !== 'object')
                                            .map(([k, v]) => (
                                                <div key={k} className="min-w-0">
                                                    <span className="font-medium text-slate-500 capitalize text-[9px] uppercase tracking-wide block truncate">{k.replace(/_/g, ' ')}</span>
                                                    <span className="text-slate-800 font-mono text-xs block truncate" title={String(v)}>{String(v)}</span>
                                                </div>
                                            ))
                                        }
                                    </div>
                                )}

                                {/* Loading indicator */}
                                {metadataLoading && (
                                    <div className="text-xs text-slate-400 italic">Loading metadata...</div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Lightbox Overlay */}
                {lightboxOpen && (
                    <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center" onWheel={handleWheel} onContextMenu={handleContextMenu}>
                        <div className="absolute top-4 right-4 z-[101] flex gap-2">
                            <div className="bg-white/10 text-white px-3 py-1 rounded backdrop-blur-md text-xs font-mono">{Math.round(scale * 100)}%</div>
                            <button onClick={() => setLightboxOpen(false)} className="text-white hover:text-red-400"><X className="w-8 h-8" /></button>
                        </div>
                        <div className="w-full h-full flex items-center justify-center" onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}>
                            <img src={imageUrl} alt="Full Screen" style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`, transition: isDragging ? 'none' : 'transform 0.1s ease-out', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} draggable={false} />
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
