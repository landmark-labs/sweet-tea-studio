import React from "react";
import { Download, ExternalLink, X, Check, Trash2, ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";
import { api, Image as ApiImage } from "@/lib/api";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";

interface ImageViewerProps {
    images: ApiImage[];
    metadata?: Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workflows?: any[];
    onSelectWorkflow?: (workflowId: string, imagePath?: string) => void;
    // autoCleanup logic lifted to parent or handled via props
    autoCleanup?: boolean;
    onAutoCleanupChange?: (enabled: boolean) => void;
    onImageUpdate?: (image: ApiImage) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onRegenerate?: (item: any) => void;
}

export function ImageViewer({
    images,
    metadata,
    workflows = [],
    onSelectWorkflow,
    autoCleanup = true,
    onAutoCleanupChange,
    onImageUpdate,
    onRegenerate
}: ImageViewerProps) {
    const [selectedIndex, setSelectedIndex] = React.useState<number>(0);
    const [contextMenu, setContextMenu] = React.useState<{ x: number, y: number } | null>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);

    // Local state backoff if no prop provided
    const [localAutoCleanup, setLocalAutoCleanup] = React.useState(true);
    const effectiveAutoCleanup = onAutoCleanupChange !== undefined ? autoCleanup : localAutoCleanup;
    const handleAutoCleanupChange = onAutoCleanupChange || setLocalAutoCleanup;

    // Sync selected index with images length if it changes
    React.useEffect(() => {
        if (images.length > 0) {
            if (selectedIndex >= images.length) {
                setSelectedIndex(0);
            }
        }
    }, [images, selectedIndex]);

    const currentImage = images[selectedIndex];
    const imagePath = currentImage?.path;

    // Toggle Keep Status
    const toggleKeep = async (e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (!currentImage || !currentImage.id || currentImage.id < 0) return;

        const newStatus = !currentImage.is_kept;
        try {
            // Optimistic update using callback if available
            const updatedImage = { ...currentImage, is_kept: newStatus };

            if (onImageUpdate) {
                onImageUpdate(updatedImage);
            } else {
                // Fallback to mutation if handler not provided
                currentImage.is_kept = newStatus;
                setSelectedIndex(prev => prev);
            }

            await api.keepImages([currentImage.id], newStatus);
        } catch (error) {
            console.error("Failed to toggle keep", error);
        }
    };

    // Keyboard Shortcuts
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === "Enter") {
                toggleKeep();
            }
            if (e.key === "ArrowLeft") {
                setSelectedIndex(prev => Math.max(0, prev - 1));
            }
            if (e.key === "ArrowRight") {
                setSelectedIndex(prev => Math.min(images.length - 1, prev + 1));
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [currentImage, images]);

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

    const imageUrl = imagePath ? `/api/v1/gallery/image/path?path=${encodeURIComponent(imagePath)}` : "";

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

    if (!images || images.length === 0) {
        return (
            <div className="h-full flex items-center justify-center bg-slate-100 text-slate-400">
                Select a job or image to view
            </div>
        );
    }

    return (
        <>
            <div ref={containerRef} className="h-full flex flex-col bg-white relative">

                {/* Image Area */}
                <div
                    className="flex-1 flex items-center justify-center p-8 overflow-hidden bg-slate-900/5 backdrop-blur-3xl cursor-default relative"
                    onDoubleClick={toggleFullScreen}
                    onContextMenu={handleContextMenu}
                >
                    {/* Batch Navigation (Overlay) */}
                    {images.length > 1 && (
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
                                onClick={(e) => { e.stopPropagation(); setSelectedIndex(p => Math.min(images.length - 1, p + 1)); }}
                                disabled={selectedIndex === images.length - 1}
                            >
                                <ArrowRight className="w-5 h-5 text-slate-800" />
                            </Button>

                            {/* Thumbnails */}
                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 p-2 bg-black/20 backdrop-blur-sm rounded-lg overflow-x-auto max-w-[80%]">
                                {images.map((img, idx) => (
                                    <div
                                        key={img.id}
                                        className={`w-12 h-12 rounded overflow-hidden cursor-pointer border-2 transition-all ${idx === selectedIndex ? 'border-primary scale-105' : 'border-transparent opacity-70 hover:opacity-100'}`}
                                        onClick={(e) => { e.stopPropagation(); setSelectedIndex(idx); }}
                                    >
                                        <img src={`/api/v1/gallery/image/path?path=${encodeURIComponent(img.path)}`} className="w-full h-full object-cover" />
                                        {/* Status Indicator */}
                                        {img.is_kept && (
                                            <div className="absolute top-0 right-0 bg-green-500 w-3 h-3 rounded-full border border-white" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}

                    <img
                        src={imageUrl}
                        className={`max-w-full max-h-full object-contain shadow-2xl rounded-lg transition-all ${currentImage?.is_kept ? 'ring-4 ring-green-500/50' : ''}`}
                        alt="Preview"
                    />

                    {currentImage?.is_kept && (
                        <div className="absolute top-8 right-8 bg-green-500 text-white px-3 py-1 rounded-full shadow-lg flex items-center gap-2">
                            <Check size={14} strokeWidth={3} />
                            <span className="text-sm font-bold">KEPT</span>
                        </div>
                    )}
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
                        <div
                            className="px-3 py-2 hover:bg-slate-100 cursor-pointer flex items-center gap-2 text-primary"
                            onClick={(e) => { toggleKeep(e); setContextMenu(null); }}
                        >
                            {currentImage?.is_kept ? <><Trash2 size={14} /> Discard</> : <><Check size={14} /> Keep (Ctrl+Enter)</>}
                        </div>

                        {onRegenerate && (
                            <div
                                className="px-3 py-2 hover:bg-slate-100 cursor-pointer flex items-center gap-2 text-slate-700"
                                onClick={() => {
                                    onRegenerate(metadata || {});
                                    setContextMenu(null);
                                }}
                            >
                                <RotateCcw size={14} /> Regenerate
                            </div>
                        )}

                        {imgWorkflows.length > 0 && (
                            <div className="relative group">
                                <div className="px-3 py-2 hover:bg-slate-100 cursor-pointer flex items-center justify-between">
                                    <span className="flex items-center gap-2">Use in Workflow</span>
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

                <div className="p-6 border-t bg-white h-64 overflow-y-auto">
                    <div className="flex items-start justify-between mb-4">
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 truncate max-w-md">
                                {currentImage?.filename}
                            </h2>
                            <p className="text-sm text-slate-500">
                                {(() => {
                                    try {
                                        return currentImage?.created_at ? new Date(currentImage.created_at).toLocaleString() : "External File";
                                    } catch (e) {
                                        return "Unknown Date";
                                    }
                                })()}
                            </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            <div className="flex gap-2">
                                <Button
                                    variant={currentImage?.is_kept ? "default" : "outline"}
                                    size="sm"
                                    onClick={(e) => toggleKeep(e)}
                                    className={currentImage?.is_kept ? "bg-green-600 hover:bg-green-700" : ""}
                                >
                                    {currentImage?.is_kept ? <Check className="w-4 h-4 mr-2" /> : <Check className="w-4 h-4 mr-2 opacity-50" />}
                                    {currentImage?.is_kept ? "Kept" : "Keep"}
                                </Button>
                                <Button variant="outline" size="sm" onClick={handleDownload}>
                                    <Download className="w-4 h-4 mr-2" /> Download
                                </Button>
                            </div>

                            {/* Auto Cleanup Toggle */}
                            <div className="flex items-center gap-2 px-2 py-1 bg-slate-50 rounded border border-slate-100">
                                <Switch
                                    id="auto-cleanup"
                                    checked={effectiveAutoCleanup}
                                    onCheckedChange={handleAutoCleanupChange}
                                    className="scale-75"
                                />
                                <Label htmlFor="auto-cleanup" className="text-xs text-slate-600 cursor-pointer">
                                    Auto-discard unkept
                                </Label>
                            </div>

                        </div>
                    </div>

                    {metadata && (
                        <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
                            {metadata.prompt && (
                                <div className="col-span-2">
                                    <span className="font-semibold text-slate-700 block mb-1">Prompt</span>
                                    <p className="text-slate-600 bg-slate-50 p-2 rounded border">{String(metadata.prompt)}</p>
                                </div>
                            )}
                            {metadata.job_params && typeof metadata.job_params === 'object' && (
                                <>
                                    {Object.entries(metadata.job_params as Record<string, unknown>).map(([k, v]) => (
                                        <div key={k}>
                                            <span className="font-semibold text-slate-700 capitalize">{k.replace(/_/g, ' ')}:</span>
                                            <span className="ml-2 text-slate-600">{String(v)}</span>
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Lightbox Overlay */}
            {lightboxOpen && (
                <div
                    className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center overflow-hidden"
                    onWheel={handleWheel}
                    onContextMenu={handleContextMenu}
                >
                    <div className="absolute top-4 right-4 z-[101] flex gap-2">
                        <div className="bg-white/10 text-white px-3 py-1 rounded backdrop-blur-md text-xs font-mono">
                            {Math.round(scale * 100)}%
                        </div>
                        <button
                            onClick={() => setLightboxOpen(false)}
                            className="text-white hover:text-red-400 transition-colors"
                        >
                            <X className="w-8 h-8" />
                        </button>
                    </div>

                    <div
                        className="w-full h-full flex items-center justify-center"
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
                    >
                        <img
                            src={imageUrl}
                            alt="Full Screen"
                            style={{
                                transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                                maxWidth: '100%',
                                maxHeight: '100%',
                                objectFit: 'contain'
                            }}
                            draggable={false}
                        />
                    </div>
                </div>
            )}
        </>
    );
}
