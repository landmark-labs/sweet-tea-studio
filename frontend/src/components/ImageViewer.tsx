import React from "react";
import { Download, ExternalLink, X } from "lucide-react";
import { Button } from "./ui/button";

interface ImageViewerProps {
    imagePath: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: any;
    workflows?: any[];
    onSelectWorkflow?: (workflowId: string, imagePath?: string) => void;
}

export function ImageViewer({ imagePath, metadata, workflows = [], onSelectWorkflow }: ImageViewerProps) {
    const [contextMenu, setContextMenu] = React.useState<{ x: number, y: number } | null>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);

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

    const imageUrl = `/api/v1/gallery/image/path?path=${encodeURIComponent(imagePath)}`;

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
        try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = imagePath.split(/[\\/]/).pop() || "image.png";
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
        // If in lightbox, use same context menu but adjust z-index
        setContextMenu({ x: e.clientX, y: e.clientY });
    };

    // Filter workflows that take an image (heuristic: contains "LoadImage" node or similar)
    const imgWorkflows = workflows.filter(w => {
        const jsonStr = JSON.stringify(w.graph_json || {});
        return jsonStr.includes("LoadImage") || jsonStr.includes("VAEEncode");
    });

    if (!imagePath) {
        return (
            <div className="h-full flex items-center justify-center bg-slate-100 text-slate-400">
                Select an image to view
            </div>
        );
    }

    return (
        <>
            <div ref={containerRef} className="h-full flex flex-col bg-white relative">
                <div
                    className="flex-1 flex items-center justify-center p-8 overflow-hidden bg-slate-900/5 backdrop-blur-3xl cursor-default"
                    onDoubleClick={toggleFullScreen}
                    onContextMenu={handleContextMenu}
                >
                    <img
                        src={imageUrl}
                        className="max-w-full max-h-full object-contain shadow-2xl rounded-lg"
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
                                {imagePath.split(/[\\/]/).pop()}
                            </h2>
                            <p className="text-sm text-slate-500">
                                {(() => {
                                    try {
                                        return metadata?.created_at ? new Date(metadata.created_at).toLocaleString() : "External File";
                                    } catch (e) {
                                        return "Unknown Date";
                                    }
                                })()}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={handleDownload}>
                                <Download className="w-4 h-4 mr-2" /> Download
                            </Button>
                        </div>
                    </div>

                    {metadata && (
                        <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
                            {metadata.prompt && (
                                <div className="col-span-2">
                                    <span className="font-semibold text-slate-700 block mb-1">Prompt</span>
                                    <p className="text-slate-600 bg-slate-50 p-2 rounded border">{metadata.prompt}</p>
                                </div>
                            )}
                            {metadata.job_params && typeof metadata.job_params === 'object' && (
                                <>
                                    {Object.entries(metadata.job_params).map(([k, v]) => (
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
                            {/* We need to import X if not already */}
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
