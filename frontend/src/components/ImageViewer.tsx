import React from "react";
import { Download, ExternalLink, X, Check, ArrowLeft, ArrowRight, RotateCcw, Copy, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { api, Image as ApiImage, GalleryItem } from "@/lib/api";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";


interface ImageViewerProps {
    images: ApiImage[];
    galleryItems?: GalleryItem[];  // Full items with per-image metadata
    metadata?: Record<string, unknown>;  // Fallback for legacy callers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workflows?: any[];
    onSelectWorkflow?: (workflowId: string, imagePath?: string) => void;
    onUseInPipe?: (payload: { workflowId: string; imagePath: string; galleryItem: GalleryItem }) => void;
    onImageUpdate?: (image: ApiImage) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onRegenerate?: (item: any) => void;
    onDelete?: (imageId: number) => void;
    selectedImagePath?: string;
    onLoadMore?: () => void;  // Callback to load more images when near end
    resetKey?: number;  // When changed, reset selectedIndex to 0 (for new generations)
}

export const ImageViewer = React.memo(function ImageViewer({
    images,
    galleryItems,
    metadata,
    workflows = [],
    onSelectWorkflow,
    onUseInPipe,
    onImageUpdate,
    onRegenerate,
    onDelete,
    selectedImagePath,
    onLoadMore,
    resetKey
}: ImageViewerProps) {
    const [copyState, setCopyState] = React.useState<{ positive: boolean; negative: boolean }>({ positive: false, negative: false });
    const [selectedIndex, setSelectedIndex] = React.useState<number>(0);
    const [contextMenu, setContextMenu] = React.useState<{ x: number, y: number } | null>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);

    // Mode-based navigation:
    // - Locked Mode (false): Show selectedImagePath directly, ignore array index
    // - Navigation Mode (true): Use displayImages[selectedIndex] for arrow navigation
    const [navigationMode, setNavigationMode] = React.useState(false);

    // Helper to extract raw file path from API URL or return path as-is
    const extractRawPath = React.useCallback((pathStr?: string | null): string => {
        if (!pathStr) return "";
        if (pathStr.includes('/api/') && pathStr.includes('?path=')) {
            try {
                const url = new URL(pathStr, window.location.origin);
                const pathParam = url.searchParams.get('path');
                if (pathParam) return pathParam;
            } catch {
                // If URL parsing fails, use as-is
            }
        }
        return pathStr;
    }, []);

    // Create a "locked" image object from selectedImagePath for display in locked mode
    const lockedImage = React.useMemo((): ApiImage | null => {
        if (!selectedImagePath) return null;
        const rawPath = extractRawPath(selectedImagePath);
        const isApiUrl = selectedImagePath.includes('/api/') && selectedImagePath.includes('?path=');
        return {
            id: -1,
            job_id: -1,
            path: selectedImagePath,
            filename: rawPath.split(/[\\/]/).pop() || "preview.png",
            created_at: new Date().toISOString(),
            // @ts-expect-error - custom property to flag API URLs
            _isApiUrl: isApiUrl
        };
    }, [selectedImagePath, extractRawPath]);

    // displayImages is used for array-based navigation
    const displayImages = React.useMemo(() => {
        // Just return images as-is for navigation mode
        return images;
    }, [images]);

    // When selectedImagePath changes, switch back to locked mode
    const lastSelectedImagePathRef = React.useRef<string | undefined>(undefined);
    React.useEffect(() => {
        if (selectedImagePath !== lastSelectedImagePathRef.current) {
            lastSelectedImagePathRef.current = selectedImagePath;
            // New image selected externally - switch to locked mode
            setNavigationMode(false);
        }
    }, [selectedImagePath]);

    // Function to enter navigation mode and align index to current image
    const enterNavigationMode = React.useCallback(() => {
        if (navigationMode) return; // Already in navigation mode

        setNavigationMode(true);

        // Try to find current locked image in the array
        if (lockedImage) {
            const lockedRawPath = extractRawPath(lockedImage.path);
            const idx = displayImages.findIndex((img) => {
                const imgRawPath = extractRawPath(img.path);
                return imgRawPath === lockedRawPath || img.path === lockedImage.path;
            });
            if (idx >= 0) {
                setSelectedIndex(idx);
            } else {
                // Image not in array, start at 0
                setSelectedIndex(0);
            }
        }
    }, [navigationMode, lockedImage, displayImages, extractRawPath]);

    // Sync selected index bounds in navigation mode
    React.useEffect(() => {
        if (navigationMode && displayImages.length > 0) {
            if (selectedIndex >= displayImages.length) {
                setSelectedIndex(Math.max(0, displayImages.length - 1));
            }
        }
    }, [navigationMode, displayImages.length, selectedIndex]);

    // Determine current image based on mode
    const currentImage = navigationMode
        ? displayImages[selectedIndex]
        : (lockedImage || displayImages[0]);
    const imagePath = currentImage?.path;

    // State for PNG-sourced metadata (fetched from the image file itself)
    const [pngMetadata, setPngMetadata] = React.useState<{
        prompt?: string | null;
        negative_prompt?: string | null;
        parameters: Record<string, unknown>;
        source: string;
    } | null>(null);
    const [metadataLoading, setMetadataLoading] = React.useState(false);
    const [useInPipeMenuOpen, setUseInPipeMenuOpen] = React.useState(false);

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


    // Track displayImages length in a ref for keyboard navigation
    const displayImagesLengthRef = React.useRef(displayImages.length);
    React.useEffect(() => {
        displayImagesLengthRef.current = displayImages.length;
    }, [displayImages.length]);

    // Ref for enterNavigationMode to use in keyboard handler
    const enterNavigationModeRef = React.useRef(enterNavigationMode);
    React.useEffect(() => {
        enterNavigationModeRef.current = enterNavigationMode;
    }, [enterNavigationMode]);

    // Keyboard Shortcuts
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Skip if user is typing in an input, textarea, or contenteditable element
            const activeEl = document.activeElement;
            const tagName = activeEl?.tagName?.toLowerCase();
            const isEditable = activeEl?.hasAttribute('contenteditable');
            if (tagName === 'input' || tagName === 'textarea' || isEditable) {
                return;
            }

            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                // Enter navigation mode first (aligns index to current image)
                enterNavigationModeRef.current();

                const maxIndex = displayImagesLengthRef.current - 1;
                if (e.key === "ArrowLeft") {
                    setSelectedIndex(prev => Math.max(0, prev - 1));
                }
                if (e.key === "ArrowRight") {
                    setSelectedIndex(prev => Math.min(maxIndex, prev + 1));
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    // Load more images when navigating near the end
    const loadMoreTriggeredRef = React.useRef(false);
    React.useEffect(() => {
        // Reset trigger when images change (more were loaded)
        loadMoreTriggeredRef.current = false;
    }, [displayImages.length]);

    React.useEffect(() => {
        if (!onLoadMore) return;
        // Trigger when within 5 images of the end
        const threshold = 5;
        if (selectedIndex >= displayImages.length - threshold && !loadMoreTriggeredRef.current) {
            loadMoreTriggeredRef.current = true;
            console.log('[ImageViewer] Near end, triggering loadMore. Index:', selectedIndex, 'of', displayImages.length);
            onLoadMore();
        }
    }, [selectedIndex, displayImages.length, onLoadMore]);

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

    const copyToClipboard = async (text: string) => {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            return navigator.clipboard.writeText(text);
        }

        return new Promise<void>((resolve, reject) => {
            try {
                const textarea = document.createElement("textarea");
                textarea.value = text;
                textarea.style.position = "fixed";
                textarea.style.left = "-9999px";
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                const successful = document.execCommand("copy");
                document.body.removeChild(textarea);
                if (successful) {
                    resolve();
                } else {
                    reject(new Error("Copy command failed"));
                }
            } catch (err) {
                reject(err as Error);
            }
        });
    };

    const handleCopy = async (text: string, key: "positive" | "negative") => {
        try {
            await copyToClipboard(text);
            setCopyState((prev) => ({ ...prev, [key]: true }));
            setTimeout(() => setCopyState((prev) => ({ ...prev, [key]: false })), 1600);
        } catch (err) {
            console.error("Failed to copy prompt", err);
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

    // Helper to get a raw path (strip API wrapper if needed)
    const resolveRawPath = (pathStr?: string) => {
        if (!pathStr) return "";
        if (pathStr.includes("/api/") && pathStr.includes("path=")) {
            try {
                const url = new URL(pathStr, window.location.origin);
                const param = url.searchParams.get("path");
                if (param) return param;
            } catch {
                // fall through
            }
        }
        return pathStr;
    };

    // Show empty state only if no image to display at all
    if (!currentImage) {
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
                    {/* Show navigation arrows when in navigation mode or when there are multiple images */}
                    {(navigationMode || displayImages.length > 1) && displayImages.length > 0 && (
                        <>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/50 hover:bg-white/80 rounded-full"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    enterNavigationMode();
                                    setSelectedIndex(p => Math.max(0, p - 1));
                                }}
                                disabled={navigationMode && selectedIndex === 0}
                            >
                                <ArrowLeft className="w-5 h-5 text-slate-800" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/50 hover:bg-white/80 rounded-full"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    enterNavigationMode();
                                    setSelectedIndex(p => Math.min(displayImages.length - 1, p + 1));
                                }}
                                disabled={navigationMode && selectedIndex === displayImages.length - 1}
                            >
                                <ArrowRight className="w-5 h-5 text-slate-800" />
                            </Button>


                        </>
                    )}

                    <img
                        src={imageUrl}
                        className="max-w-full max-h-full object-contain shadow-2xl rounded-lg transition-all"
                        alt="Preview"
                        draggable
                        onDragStart={(e) => {
                            // Extract raw file path for drag transfer
                            // This ensures full-resolution images are used, not browser-cached versions
                            let rawPath = imagePath || "";
                            if (rawPath.includes('/api/') && rawPath.includes('?path=')) {
                                try {
                                    const url = new URL(rawPath, window.location.origin);
                                    const pathParam = url.searchParams.get('path');
                                    if (pathParam) rawPath = pathParam;
                                } catch { /* use as-is */ }
                            }

                            // Set effect to allow copy operations
                            e.dataTransfer.effectAllowed = "copy";
                            e.dataTransfer.setData("application/x-sweet-tea-image", rawPath);
                            e.dataTransfer.setData("text/plain", rawPath);
                        }}
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
                            <Download size={14} /> download
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

                        {onDelete && currentImage && (
                            <div
                                className="px-3 py-2 hover:bg-red-50 cursor-pointer flex items-center gap-2 text-red-600"
                                onClick={() => {
                                    if (confirm("Delete this image permanently?")) {
                                        onDelete(currentImage.id);
                                    }
                                    setContextMenu(null);
                                }}
                            >
                                <Trash2 size={14} /> delete
                            </div>
                        )}

                        {imgWorkflows.length > 0 && (
                            <div className="relative group">
                                <div className="px-3 py-2 hover:bg-slate-100 cursor-pointer flex items-center justify-between">
                                    <span className="flex items-center gap-2">use in pipe</span>
                                    <span className="text-xs">▶</span>
                                </div>
                                {/* pl-2 + -ml-1 creates an invisible hover bridge to the right for horizontal submenus */}
                                <div className="absolute left-full top-0 pl-2 -ml-1 hidden group-hover:block">
                                    <div className="bg-white border border-slate-200 rounded-md shadow-lg py-1 w-48 max-h-64 overflow-y-auto">
                                        {imgWorkflows.map(w => (
                                            <div
                                                key={w.id}
                                                className="px-3 py-2 hover:bg-slate-100 cursor-pointer truncate"
                                                onClick={() => {
                                                    const rawPath = resolveRawPath(imagePath);
                                                    const item = galleryItems?.find(g => g.image.path === rawPath) || galleryItems?.find(g => g.image.path === imagePath);
                                                    onUseInPipe?.({
                                                        workflowId: String(w.id),
                                                        imagePath: rawPath || imagePath || "",
                                                        galleryItem: item || {
                                                            image: currentImage as any,
                                                            job_params: {
                                                                ...(currentMetadata?.job_params || {}),
                                                                prompt: currentMetadata?.prompt,
                                                                positive: currentMetadata?.prompt,
                                                                negative_prompt: currentMetadata?.negative_prompt,
                                                                negative: currentMetadata?.negative_prompt,
                                                            },
                                                            prompt: currentMetadata?.prompt as string | undefined,
                                                            negative_prompt: currentMetadata?.negative_prompt as string | undefined,
                                                            prompt_history: [],
                                                            workflow_template_id: w.id,
                                                            created_at: currentImage?.created_at || "",
                                                            caption: (currentMetadata as any)?.caption,
                                                            prompt_tags: [],
                                                            prompt_name: undefined,
                                                            engine_id: undefined,
                                                            collection_id: undefined,
                                                            project_id: undefined,
                                                        }
                                                    });
                                                    setLightboxOpen(false); // Close lightbox if selecting
                                                    setContextMenu(null);
                                                }}
                                            >
                                                {w.name}
                                            </div>
                                        ))}
                                    </div>
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
                                <div
                                    className="relative"
                                    onMouseEnter={() => setUseInPipeMenuOpen(true)}
                                    onMouseLeave={() => setUseInPipeMenuOpen(false)}
                                >
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 text-xs gap-1 border-blue-200 hover:bg-blue-50 text-blue-700"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setUseInPipeMenuOpen((open) => !open);
                                        }}
                                    >
                                        use in pipe ▶
                                    </Button>
                                    {/* pt-2 + -mt-2 creates an invisible hover bridge between button and menu */}
                                    <div className={`absolute left-0 top-full pt-2 -mt-1 z-50 ${useInPipeMenuOpen ? "block" : "hidden"}`}>
                                        <div className="bg-white border border-slate-200 rounded-md shadow-lg py-1 w-48 max-h-64 overflow-y-auto">
                                            {imgWorkflows.map(w => (
                                                <div key={w.id} className="px-3 py-2 hover:bg-slate-100 cursor-pointer truncate text-xs" onClick={() => {
                                                    const rawPath = resolveRawPath(imagePath);
                                                    const item = galleryItems?.find(g => g.image.path === rawPath) || galleryItems?.find(g => g.image.path === imagePath);
                                                    onUseInPipe?.({
                                                        workflowId: String(w.id),
                                                        imagePath: rawPath || imagePath || "",
                                                        galleryItem: item || {
                                                            image: currentImage as any,
                                                            job_params: {
                                                                ...(currentMetadata?.job_params || {}),
                                                                prompt: currentMetadata?.prompt,
                                                                positive: currentMetadata?.prompt,
                                                                negative_prompt: currentMetadata?.negative_prompt,
                                                                negative: currentMetadata?.negative_prompt,
                                                            },
                                                            prompt: currentMetadata?.prompt as string | undefined,
                                                            negative_prompt: currentMetadata?.negative_prompt as string | undefined,
                                                            prompt_history: [],
                                                            workflow_template_id: w.id,
                                                            created_at: currentImage?.created_at || "",
                                                            caption: (currentMetadata as any)?.caption,
                                                            prompt_tags: [],
                                                            prompt_name: undefined,
                                                            engine_id: undefined,
                                                            collection_id: undefined,
                                                            project_id: undefined,
                                                        }
                                                    });
                                                    setUseInPipeMenuOpen(false);
                                                    setLightboxOpen?.(false);
                                                    setContextMenu(null);
                                                }}>
                                                    {w.name}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                        </div>
                        {/* Right: Keep/Download */}
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={handleDownload} className="h-7 text-xs">
                                <Download className="w-3 h-3 mr-1" />download
                            </Button>
                            {onDelete && currentImage && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
                                    onClick={() => {
                                        if (confirm("Delete this image permanently?")) {
                                            onDelete(currentImage.id);
                                        }
                                    }}
                                >
                                    <Trash2 className="w-3 h-3 mr-1" />delete
                                </Button>
                            )}
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
                            <TooltipProvider>
                                <div className="space-y-3">
                                    {/* Positive Prompt - Full width, auto-height */}
                                    {currentMetadata.prompt && (
                                        <div className="w-full relative">
                                            <span className="font-medium text-slate-500 text-[10px] uppercase block mb-1">Positive Prompt</span>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label={copyState.positive ? "Copied positive prompt" : "Copy positive prompt"}
                                                        className="h-7 w-7 absolute top-0 right-0 text-slate-500 hover:text-slate-800"
                                                        onClick={() => handleCopy(String(currentMetadata.prompt), "positive")}
                                                    >
                                                        {copyState.positive ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>{copyState.positive ? "Copied!" : "Copy positive prompt"}</TooltipContent>
                                            </Tooltip>
                                            <p className="text-slate-700 bg-slate-50 p-2 pr-10 rounded border text-[11px] font-mono whitespace-pre-wrap leading-relaxed w-full">
                                                {String(currentMetadata.prompt)}
                                            </p>
                                        </div>
                                    )}

                                    {/* Negative Prompt - Full width, auto-height */}
                                    {currentMetadata.negative_prompt && (
                                        <div className="w-full relative">
                                            <span className="font-medium text-slate-500 text-[10px] uppercase block mb-1">Negative Prompt</span>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label={copyState.negative ? "Copied negative prompt" : "Copy negative prompt"}
                                                        className="h-7 w-7 absolute top-0 right-0 text-slate-500 hover:text-slate-800"
                                                        onClick={() => handleCopy(String(currentMetadata.negative_prompt), "negative")}
                                                    >
                                                        {copyState.negative ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>{copyState.negative ? "Copied!" : "Copy negative prompt"}</TooltipContent>
                                            </Tooltip>
                                            <p className="text-slate-700 bg-red-50/50 p-2 pr-10 rounded border border-red-100 text-[11px] font-mono whitespace-pre-wrap leading-relaxed w-full">
                                                {String(currentMetadata.negative_prompt)}
                                            </p>
                                        </div>
                                    )}

                                    {/* Parameters Grid */}
                                    {currentMetadata.job_params && typeof currentMetadata.job_params === 'object' && Object.keys(currentMetadata.job_params).length > 0 && (
                                        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-x-4 gap-y-2 pt-2 border-t border-slate-100">
                                            {Object.entries(currentMetadata.job_params as Record<string, unknown>)
                                                .filter(([k, v]) => {
                                                    // Exclude null/empty values
                                                    if (v === null || v === undefined || v === "" || typeof v === 'object') return false;
                                                    // Exclude CLIPTextEncode prompt params - these show in dedicated boxes
                                                    const keyLower = k.toLowerCase();
                                                    if (keyLower.includes('cliptextencode') || keyLower.includes('cliptext')) return false;
                                                    if (keyLower.includes('positive_prompt') || keyLower.includes('negative_prompt')) return false;
                                                    if (k === 'prompt' || k === 'text') return false;
                                                    return true;
                                                })
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
                            </TooltipProvider>
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
});
