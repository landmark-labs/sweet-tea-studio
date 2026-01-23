import React from "react";
import { Download, ExternalLink, X, Check, ArrowLeft, ArrowRight, RotateCcw, Copy, Trash2, PenTool, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { api, Image as ApiImage, GalleryItem, IMAGE_API_BASE } from "@/lib/api";
import { isVideoFile } from "@/lib/media";
import { workflowSupportsImageInput } from "@/lib/workflowGraph";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { InpaintEditor } from "@/components/InpaintEditor";
import { useMediaTrayStore } from "@/lib/stores/mediaTrayStore";



interface ImageViewerProps {
    images: ApiImage[];
    galleryItems?: GalleryItem[];  // Full items with per-image metadata
    metadata?: Record<string, unknown>;  // Fallback for legacy callers
    onViewImagePath?: (rawPath: string) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workflows?: any[];
    onSelectWorkflow?: (workflowId: string, imagePath?: string) => void;
    onUseInPipe?: (payload: { workflowId: string; imagePath: string; galleryItem: GalleryItem }) => void;
    onImageUpdate?: (image: ApiImage) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onRegenerate?: (item: any, seedOption: 'same' | 'random') => void;
    onDelete?: (imageId: number, path?: string) => void;
    selectedImagePath?: string;
    onLoadMore?: () => void;  // Callback to load more images when near end
    resetKey?: number;  // When changed, reset selectedIndex to 0 (for new generations)

}

const METADATA_CACHE_LIMIT = 200;

export const ImageViewer = React.memo(function ImageViewer({
    images,
    galleryItems,
    metadata,
    onViewImagePath,
    workflows = [],
    onUseInPipe,
    onRegenerate,
    onDelete,
    selectedImagePath,
    onLoadMore,
    resetKey
}: ImageViewerProps) {
    const [copyState, setCopyState] = React.useState<{ positive: boolean; negative: boolean }>({ positive: false, negative: false });
    const [selectedIndex, setSelectedIndex] = React.useState<number>(0);
    const [contextMenu, setContextMenu] = React.useState<{ x: number, y: number } | null>(null);
    const [contextSubmenu, setContextSubmenu] = React.useState<"regenerate" | "useInPipe" | null>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [maskEditorOpen, setMaskEditorOpen] = React.useState(false);
    const [maskEditorSourcePath, setMaskEditorSourcePath] = React.useState<string>("");
    const submenuCloseTimerRef = React.useRef<number | null>(null);

    const clearSubmenuCloseTimer = React.useCallback(() => {
        if (submenuCloseTimerRef.current) {
            window.clearTimeout(submenuCloseTimerRef.current);
            submenuCloseTimerRef.current = null;
        }
    }, []);

    const scheduleSubmenuClose = React.useCallback(() => {
        clearSubmenuCloseTimer();
        submenuCloseTimerRef.current = window.setTimeout(() => {
            setContextSubmenu(null);
            submenuCloseTimerRef.current = null;
        }, 250);
    }, [clearSubmenuCloseTimer]);

    const handleSubmenuEnter = React.useCallback((menu: "regenerate" | "useInPipe") => {
        clearSubmenuCloseTimer();
        setContextSubmenu(menu);
    }, [clearSubmenuCloseTimer]);

    const handleSubmenuLeave = React.useCallback(() => {
        scheduleSubmenuClose();
    }, [scheduleSubmenuClose]);

    const addToMediaTray = useMediaTrayStore(React.useCallback((state) => state.addItems, []));

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

    // External reset hook (used after new generations)
    React.useEffect(() => {
        if (resetKey === undefined) return;
        setSelectedIndex(0);
        setNavigationMode(false);
    }, [resetKey]);

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

    // Calculate the effective index for UI state (buttons)
    // This allows arrows to disable correctly even when not in explicit navigation mode.
    const effectiveIndex = React.useMemo(() => {
        if (navigationMode) return selectedIndex;
        if (!currentImage) return -1;

        const rawPath = extractRawPath(currentImage.path);
        const idx = displayImages.findIndex((img) => {
            const imgRawPath = extractRawPath(img.path);
            return imgRawPath === rawPath || img.path === currentImage.path;
        });
        return idx !== -1 ? idx : 0;
    }, [navigationMode, selectedIndex, currentImage, displayImages, extractRawPath]);

    const imagePath = currentImage?.path;

    React.useEffect(() => {
        if (!onViewImagePath || !imagePath) return;
        const raw = extractRawPath(imagePath);
        onViewImagePath(raw || imagePath);
    }, [onViewImagePath, imagePath, extractRawPath]);

    const isVideo = isVideoFile(imagePath, currentImage?.filename);
    const canDrawMask = Boolean(imagePath) && !isVideo;

    // State for PNG-sourced metadata (fetched from the image file itself)
    const [pngMetadata, setPngMetadata] = React.useState<{
        prompt?: string | null;
        negative_prompt?: string | null;
        parameters: Record<string, unknown>;
        source: string;
    } | null>(null);
    const [metadataLoading, setMetadataLoading] = React.useState(false);
    const [useInPipeMenuOpen, setUseInPipeMenuOpen] = React.useState(false);
    const [regenerateMenuOpen, setRegenerateMenuOpen] = React.useState(false);
    const metadataCacheRef = React.useRef(new Map<string, {
        prompt?: string | null;
        negative_prompt?: string | null;
        parameters: Record<string, unknown>;
        source: string;
    }>());
    const metadataAbortRef = React.useRef<AbortController | null>(null);
    const metadataRequestIdRef = React.useRef(0);

    // Fetch metadata from PNG when image path changes
    React.useEffect(() => {
        if (!imagePath) {
            setPngMetadata(null);
            setMetadataLoading(false);
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

        const cacheKey = rawPath || imagePath;
        const cached = metadataCacheRef.current.get(cacheKey);
        if (cached) {
            metadataCacheRef.current.delete(cacheKey);
            metadataCacheRef.current.set(cacheKey, cached);
            setPngMetadata(cached);
            setMetadataLoading(false);
            return;
        }

        if (metadataAbortRef.current) {
            metadataAbortRef.current.abort();
        }
        const controller = new AbortController();
        metadataAbortRef.current = controller;
        const requestId = ++metadataRequestIdRef.current;

        setMetadataLoading(true);
        api.getImageMetadata(rawPath, { signal: controller.signal })
            .then((data) => {
                if (controller.signal.aborted || requestId !== metadataRequestIdRef.current) return;
                const nextMetadata = {
                    prompt: data.prompt,
                    negative_prompt: data.negative_prompt,
                    parameters: data.parameters,
                    source: data.source
                };
                metadataCacheRef.current.set(cacheKey, nextMetadata);
                if (metadataCacheRef.current.size > METADATA_CACHE_LIMIT) {
                    const oldestKey = metadataCacheRef.current.keys().next().value;
                    if (oldestKey) metadataCacheRef.current.delete(oldestKey);
                }
                setPngMetadata(nextMetadata);
            })
            .catch((err) => {
                if (controller.signal.aborted) return;
                console.warn("Failed to fetch image metadata:", err);
                setPngMetadata(null);
            })
            .finally(() => {
                if (controller.signal.aborted || requestId !== metadataRequestIdRef.current) return;
                setMetadataLoading(false);
            });

        return () => {
            controller.abort();
            if (metadataAbortRef.current === controller) {
                metadataAbortRef.current = null;
            }
        };
    }, [imagePath]);

    // Use PNG metadata as the authoritative source for prompts display
    const currentMetadata = pngMetadata ? {
        prompt: pngMetadata.prompt,
        negative_prompt: pngMetadata.negative_prompt,
        job_params: pngMetadata.parameters,
        source: pngMetadata.source
    } : metadata;

    const galleryItemByPath = React.useMemo(() => {
        if (!galleryItems?.length) return null;
        const map = new Map<string, GalleryItem>();
        for (const item of galleryItems) {
            const path = item.image?.path;
            if (path) {
                map.set(path, item);
                const raw = extractRawPath(path);
                if (raw) map.set(raw, item);
            }
        }
        return map;
    }, [galleryItems, extractRawPath]);

    // Find matching gallery item for full metadata (including workflow_template_id)
    // This is critical for regenerate to work correctly - we need the pipe ID
    const matchingGalleryItem = React.useMemo(() => {
        if (!imagePath || !galleryItemByPath) return null;
        const rawPath = extractRawPath(imagePath);
        return galleryItemByPath.get(imagePath) || (rawPath ? galleryItemByPath.get(rawPath) : null) || null;
    }, [imagePath, galleryItemByPath, extractRawPath]);

    // For regenerate, we need the full gallery item with workflow_template_id
    // Merge PNG metadata (latest prompts from file) with gallery item metadata (for pipe ID)
    const currentItemForRegenerate = React.useMemo((): GalleryItem | null => {
        if (!currentImage) return null;

        // Start with the matching gallery item if available
        const base: GalleryItem = matchingGalleryItem || {
            image: currentImage as any,
            job_params: {},
            prompt_history: [],
            created_at: currentImage?.created_at || '',
        };

        // Merge PNG metadata if available (for fresh prompt data)
        const mergedJobParams = {
            ...base.job_params,
            ...(pngMetadata?.parameters || {}),
            // Ensure prompt fields are set from best available source
            prompt: pngMetadata?.prompt || base.prompt || base.job_params?.prompt,
            positive: pngMetadata?.prompt || base.prompt || base.job_params?.positive,
            negative_prompt: pngMetadata?.negative_prompt || base.negative_prompt || base.job_params?.negative_prompt,
            negative: pngMetadata?.negative_prompt || base.negative_prompt || base.job_params?.negative,
        };

        return {
            ...base,
            image: { ...base.image, path: currentImage.path },
            prompt: pngMetadata?.prompt as string || base.prompt,
            negative_prompt: pngMetadata?.negative_prompt as string || base.negative_prompt,
            job_params: mergedJobParams,
            // Get workflow_template_id from gallery item OR from PNG metadata parameters (backend returns this for regenerate)
            workflow_template_id: base.workflow_template_id ??
                (pngMetadata?.parameters as Record<string, unknown>)?.workflow_template_id as number | undefined,
        };
    }, [currentImage, matchingGalleryItem, pngMetadata]);


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

    React.useEffect(() => {
        if (!contextMenu) {
            clearSubmenuCloseTimer();
            setContextSubmenu(null);
        }
    }, [contextMenu, clearSubmenuCloseTimer]);

    // Lightbox State
    const [lightboxOpen, setLightboxOpen] = React.useState(false);
    const [scale, setScale] = React.useState(1);
    const [position, setPosition] = React.useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = React.useState(false);
    const [dragStart, setDragStart] = React.useState({ x: 0, y: 0 });

    const MAX_MEDIA_RETRIES = 5;
    const mediaRetryTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [mediaRetryAttempt, setMediaRetryAttempt] = React.useState(0);

    // Compute image display URL - avoid double-encoding if already an API URL
    const imageUrl = React.useMemo(() => {
        if (!imagePath) return "";
        // If the path is already an API URL (including /sts-api prefixes), use it directly
        if (imagePath.startsWith("http") || (imagePath.includes("/api/") && imagePath.includes("path="))) {
            return imagePath;
        }
        // Otherwise, construct the API URL
        return `${IMAGE_API_BASE}/gallery/image/path?path=${encodeURIComponent(imagePath)}`;
    }, [imagePath]);

    const mediaSrc = React.useMemo(() => {
        if (!imageUrl) return "";
        if (mediaRetryAttempt <= 0) return imageUrl;
        if (imageUrl.startsWith("blob:") || imageUrl.startsWith("data:")) return imageUrl;
        const sep = imageUrl.includes("?") ? "&" : "?";
        return `${imageUrl}${sep}__sts_retry=${mediaRetryAttempt}`;
    }, [imageUrl, mediaRetryAttempt]);

    const handleMediaError = React.useCallback(() => {
        if (mediaRetryTimeoutRef.current) return;
        setMediaRetryAttempt((attempt) => {
            if (attempt >= MAX_MEDIA_RETRIES) return attempt;
            const nextAttempt = attempt + 1;
            const delayMs = Math.min(1000 * nextAttempt, 5000);
            mediaRetryTimeoutRef.current = setTimeout(() => {
                mediaRetryTimeoutRef.current = null;
                setMediaRetryAttempt(nextAttempt);
            }, delayMs);
            return attempt;
        });
    }, []);

    React.useEffect(() => {
        setMediaRetryAttempt(0);
        if (mediaRetryTimeoutRef.current) {
            clearTimeout(mediaRetryTimeoutRef.current);
            mediaRetryTimeoutRef.current = null;
        }
        return () => {
            if (mediaRetryTimeoutRef.current) {
                clearTimeout(mediaRetryTimeoutRef.current);
                mediaRetryTimeoutRef.current = null;
            }
        };
    }, [imageUrl]);

    const handleMediaDragStart = (e: React.DragEvent) => {
        // Extract raw file path for drag transfer
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
    };

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

    const openMaskEditor = React.useCallback(() => {
        if (!canDrawMask) return;
        const raw = extractRawPath(imagePath);
        if (!raw) return;
        setMaskEditorSourcePath(raw);
        setMaskEditorOpen(true);
        setContextMenu(null);
    }, [canDrawMask, extractRawPath, imagePath]);

    const handleMaskSave = React.useCallback(async (maskFile: File) => {
        const sourcePath = maskEditorSourcePath || extractRawPath(imagePath);
        if (!sourcePath) {
            alert("missing source image path");
            return;
        }

        try {
            const result = await api.saveMask(maskFile, sourcePath);
            const location = result.saved_to === "project_masks" ? "project masks folder" : "same folder";
            alert(`mask saved: ${result.filename} (${location})`);
        } catch (e) {
            console.error("Failed to save mask", e);
            alert("failed to save mask");
        }
    }, [extractRawPath, imagePath, maskEditorSourcePath]);

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

    const imageWorkflows = React.useMemo(() => {
        if (!workflows.length) return [];
        return workflows.filter((w) => workflowSupportsImageInput(w?.graph_json));
    }, [workflows]);

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
            <div className="h-full flex items-center justify-center bg-muted/40 text-muted-foreground">
                Select a job or image to view
            </div>
        );
    }

    // Extract and process metadata for display
    // Heuristics removed as per user request to revert the spam filter patch


    return (
        <>
            <div ref={containerRef} className="h-full flex flex-col bg-slate-900 dark:bg-background relative">

                {/* Image Area */}
                <div
                    className="flex-1 flex items-center justify-center p-2 overflow-hidden bg-black/50 cursor-default relative"
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
                                className="absolute left-4 top-1/2 -translate-y-1/2 bg-surface/70 hover:bg-surface/90 border border-border/60 rounded-full z-10"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    e.stopPropagation();
                                    enterNavigationMode();
                                    setSelectedIndex(Math.max(0, effectiveIndex - 1));
                                }}
                                disabled={effectiveIndex <= 0}
                            >
                                <ArrowLeft className="w-5 h-5 text-foreground" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-4 top-1/2 -translate-y-1/2 bg-surface/70 hover:bg-surface/90 border border-border/60 rounded-full z-10"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    e.stopPropagation();
                                    enterNavigationMode();
                                    setSelectedIndex(Math.min(displayImages.length - 1, effectiveIndex + 1));
                                }}
                                disabled={effectiveIndex >= displayImages.length - 1}
                            >
                                <ArrowRight className="w-5 h-5 text-foreground" />
                            </Button>


                        </>
                    )}

                    {isVideo ? (
                        <video
                            src={mediaSrc}
                            className="max-w-full max-h-full object-contain shadow-2xl rounded-lg transition-all"
                            controls
                            preload="metadata"
                            playsInline
                            draggable={false}
                            onError={handleMediaError}
                        />
                    ) : (
                        <img
                            src={mediaSrc}
                            className="max-w-full max-h-full object-contain shadow-2xl rounded-lg transition-all"
                            alt="Preview"
                            draggable
                            onDragStart={handleMediaDragStart}
                            onError={handleMediaError}
                        />
                    )}


                </div>

                {/* Context Menu */}
                {contextMenu && (
                    <div
                        className="fixed z-[9999] bg-popover border border-border/60 rounded-md shadow-lg py-1 w-48 text-sm text-popover-foreground font-medium"
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                    >
                        <div
                            className="px-3 py-2 hover:bg-muted/50 cursor-pointer flex items-center gap-2"
                            onClick={toggleFullScreen}
                        >
                            {lightboxOpen ? <React.Fragment><ExternalLink size={14} className="rotate-180" /> exit full screen</React.Fragment> : <React.Fragment><ExternalLink size={14} /> full screen</React.Fragment>}
                        </div>
                        <div
                            className="px-3 py-2 hover:bg-muted/50 cursor-pointer flex items-center gap-2"
                            onClick={handleDownload}
                        >
                            <Download size={14} /> download
                        </div>
                        <div
                            className="px-3 py-2 hover:bg-muted/50 cursor-pointer flex items-center gap-2"
                            onClick={() => {
                                const rawPath = resolveRawPath(imagePath);
                                if (rawPath) {
                                    addToMediaTray({ path: rawPath, filename: currentImage?.filename });
                                }
                                setContextMenu(null);
                            }}
                        >
                            <Plus size={14} /> add to media tray
                        </div>
                        {canDrawMask && (
                            <div
                                className="px-3 py-2 hover:bg-muted/50 cursor-pointer flex items-center gap-2"
                                onClick={openMaskEditor}
                            >
                                <PenTool size={14} /> draw mask
                            </div>
                        )}
                        <div className="h-px bg-border/50 my-1" />

                        {onRegenerate && (
                            <div
                                className="relative"
                                onMouseEnter={() => handleSubmenuEnter("regenerate")}
                                onMouseLeave={handleSubmenuLeave}
                            >
                                <div className="px-3 py-2 hover:bg-muted/50 cursor-pointer flex items-center justify-between">
                                    <span className="flex items-center gap-2"><RotateCcw size={14} /> regenerate</span>
                                    <span className="text-xs">▶</span>
                                </div>
                                <div
                                    className={`absolute left-full top-0 pl-2 -ml-1 ${contextSubmenu === "regenerate" ? "block" : "hidden"}`}
                                    onMouseEnter={() => handleSubmenuEnter("regenerate")}
                                    onMouseLeave={handleSubmenuLeave}
                                >
                                    <div className="bg-popover border border-border/60 rounded-md shadow-lg py-1 w-40">
                                        <div
                                            className="px-3 py-2 hover:bg-muted/50 cursor-pointer text-xs"
                                            onClick={() => {
                                                onRegenerate(currentItemForRegenerate || currentMetadata || {}, 'same');
                                                setContextMenu(null);
                                            }}
                                        >
                                            same seed
                                        </div>
                                        <div
                                            className="px-3 py-2 hover:bg-muted/50 cursor-pointer text-xs"
                                            onClick={() => {
                                                onRegenerate(currentItemForRegenerate || currentMetadata || {}, 'random');
                                                setContextMenu(null);
                                            }}
                                        >
                                            random seed (-1)
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {imageWorkflows.length > 0 && (
                            <div
                                className="relative"
                                onMouseEnter={() => handleSubmenuEnter("useInPipe")}
                                onMouseLeave={handleSubmenuLeave}
                            >
                                <div className="px-3 py-2 hover:bg-muted/50 cursor-pointer flex items-center justify-between">
                                    <span className="flex items-center gap-2">use in pipe</span>
                                    <span className="text-xs">▶</span>
                                </div>
                                {/* pl-2 + -ml-1 creates an invisible hover bridge to the right for horizontal submenus */}
                                <div
                                    className={`absolute left-full top-0 pl-2 -ml-1 ${contextSubmenu === "useInPipe" ? "block" : "hidden"}`}
                                    onMouseEnter={() => handleSubmenuEnter("useInPipe")}
                                    onMouseLeave={handleSubmenuLeave}
                                >
                                    <div className="bg-popover border border-border/60 rounded-md shadow-lg py-1 w-48 max-h-64 overflow-y-auto">
                                        {imageWorkflows.map(w => (
                                            <div
                                                key={w.id}
                                                className="px-3 py-2 hover:bg-muted/50 cursor-pointer truncate"
                                                onClick={() => {
                                                    const rawPath = resolveRawPath(imagePath);
                                                    const item = matchingGalleryItem;
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

                        {onDelete && currentImage && (
                            <>
                                <div className="h-px bg-border/50 my-1" />
                                <div
                                    className="px-3 py-2 hover:bg-destructive/10 cursor-pointer flex items-center gap-2 text-destructive"
                                    onClick={async () => {
                                        // Use matchingGalleryItem ID if available (for locked images selected via selectedImagePath)
                                        const imageId = matchingGalleryItem?.image.id ?? currentImage.id;
                                        if (!confirm("Delete this image permanently?")) {
                                            setContextMenu(null);
                                            return;
                                        }

                                        // Navigate to next image before deletion (so deleted image doesn't linger)
                                        const currentIdx = displayImages.findIndex(img =>
                                            extractRawPath(img.path) === extractRawPath(currentImage.path)
                                        );
                                        if (currentIdx >= 0 && displayImages.length > 1) {
                                            // Enter navigation mode and move to next image (or previous if at end)
                                            setNavigationMode(true);
                                            if (currentIdx < displayImages.length - 1) {
                                                setSelectedIndex(currentIdx); // Will show next after array updates
                                            } else {
                                                setSelectedIndex(Math.max(0, currentIdx - 1));
                                            }
                                        }

                                        if (imageId > 0) {
                                            // Standard deletion by ID
                                            onDelete(imageId, extractRawPath(currentImage.path));
                                        } else {
                                            // Path-based deletion for images without valid DB ID (e.g., from ProjectGallery)
                                            const rawPath = extractRawPath(currentImage.path);
                                            try {
                                                await api.deleteImageByPath(rawPath);
                                                // Trigger parent refresh by calling onDelete with -1 to signal path-based delete completed
                                                onDelete(-1, rawPath);
                                            } catch (e) {
                                                console.error("Failed to delete image by path", e);
                                                alert("failed to delete image");
                                            }
                                        }
                                        setContextMenu(null);
                                    }}
                                >
                                    <Trash2 size={14} /> delete
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Bottom Panel: Toolbar + Metadata - Takes ~35% of container height */}
                <div className="border-t border-border/60 bg-card flex flex-col" style={{ height: '35%', minHeight: '200px' }}>
                    {/* Toolbar Row */}
                    <div className="px-4 py-2 border-b border-border/60 bg-muted/20 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
                        {/* Left: Actions */}
                        <div className="flex items-center gap-2">
                            {imageWorkflows.length > 0 && (
                                <div
                                    className="relative"
                                    onMouseEnter={() => setUseInPipeMenuOpen(true)}
                                    onMouseLeave={() => setUseInPipeMenuOpen(false)}
                                >
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 text-xs gap-1 border-blue-200 hover:bg-blue-50 text-blue-700 dark:border-border/60 dark:hover:bg-muted/60 dark:text-primary"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setUseInPipeMenuOpen((open) => !open);
                                        }}
                                    >
                                        use in pipe ▶
                                    </Button>
                                    {/* pt-2 + -mt-2 creates an invisible hover bridge between button and menu */}
                                    <div className={`absolute left-0 top-full pt-2 -mt-1 z-50 ${useInPipeMenuOpen ? "block" : "hidden"}`}>
                                        <div className="bg-popover border border-border/60 rounded-md shadow-lg py-1 w-48 max-h-64 overflow-y-auto">
                                            {imageWorkflows.map(w => (
                                                <div key={w.id} className="px-3 py-2 hover:bg-muted/50 cursor-pointer truncate text-xs" onClick={() => {
                                                    const rawPath = resolveRawPath(imagePath);
                                                    const item = matchingGalleryItem;
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

                            {/* Regenerate button with dropdown */}
                            {onRegenerate && (
                                <div
                                    className="relative"
                                    onMouseEnter={() => setRegenerateMenuOpen(true)}
                                    onMouseLeave={() => setRegenerateMenuOpen(false)}
                                >
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 text-xs gap-1 border-green-200 hover:bg-green-50 text-green-700 dark:border-border/60 dark:hover:bg-muted/60 dark:text-green-400"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setRegenerateMenuOpen((open) => !open);
                                        }}
                                    >
                                        <RotateCcw className="w-3 h-3" /> regenerate ▶
                                    </Button>
                                    <div className={`absolute left-0 top-full pt-2 -mt-1 z-50 ${regenerateMenuOpen ? "block" : "hidden"}`}>
                                        <div className="bg-popover border border-border/60 rounded-md shadow-lg py-1 w-40">
                                            <div
                                                className="px-3 py-2 hover:bg-muted/50 cursor-pointer text-xs"
                                                onClick={() => {
                                                    onRegenerate(currentItemForRegenerate || currentMetadata || {}, 'same');
                                                    setRegenerateMenuOpen(false);
                                                }}
                                            >
                                                same seed
                                            </div>
                                            <div
                                                className="px-3 py-2 hover:bg-muted/50 cursor-pointer text-xs"
                                                onClick={() => {
                                                    onRegenerate(currentItemForRegenerate || currentMetadata || {}, 'random');
                                                    setRegenerateMenuOpen(false);
                                                }}
                                            >
                                                random seed (-1)
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {canDrawMask && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1 border-orange-200 hover:bg-orange-50 text-orange-700 hover:text-orange-800 dark:border-border/60 dark:hover:bg-muted/60 dark:text-orange-300 dark:hover:text-orange-200"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openMaskEditor();
                                    }}
                                >
                                    <PenTool className="w-3 h-3" /> draw mask
                                </Button>
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
                                    className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                                    onClick={async () => {
                                        // Use matchingGalleryItem ID if available (for locked images selected via selectedImagePath)
                                        // fallback to currentImage.id for in-array images
                                        const imageId = matchingGalleryItem?.image.id ?? currentImage.id;
                                        if (!confirm("Delete this image permanently?")) {
                                            return;
                                        }

                                        // Navigate to next image before deletion (so deleted image doesn't linger)
                                        const currentIdx = displayImages.findIndex(img =>
                                            extractRawPath(img.path) === extractRawPath(currentImage.path)
                                        );
                                        if (currentIdx >= 0 && displayImages.length > 1) {
                                            // Enter navigation mode and move to next image (or previous if at end)
                                            setNavigationMode(true);
                                            if (currentIdx < displayImages.length - 1) {
                                                setSelectedIndex(currentIdx); // Will show next after array updates
                                            } else {
                                                setSelectedIndex(Math.max(0, currentIdx - 1));
                                            }
                                        }

                                        if (imageId > 0) {
                                            onDelete(imageId, extractRawPath(currentImage.path));
                                        } else {
                                            // Path-based deletion for images without valid DB ID (e.g., from ProjectGallery)
                                            const rawPath = extractRawPath(currentImage.path);
                                            try {
                                                await api.deleteImageByPath(rawPath);
                                                // Trigger parent refresh by calling onDelete with -1 to signal path-based delete completed
                                                onDelete(-1, rawPath);
                                            } catch (e) {
                                                console.error("Failed to delete image by path", e);
                                                alert("failed to delete image");
                                            }
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
                            <h3 className="text-sm font-semibold text-foreground truncate">{currentImage?.filename}</h3>
                            <span className="text-[10px] text-muted-foreground font-mono ml-2 flex-shrink-0">{currentImage?.created_at ? new Date(currentImage.created_at).toLocaleString() : ""}</span>
                        </div>

                        {currentMetadata && (
                            <TooltipProvider>
                                <div className="space-y-3">
                                    {/* Positive Prompt - Full width, auto-height */}
                                    {!!currentMetadata.prompt && (
                                        <div className="w-full relative">
                                            <span className="font-medium text-muted-foreground text-[10px] uppercase block mb-1">Positive Prompt</span>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label={copyState.positive ? "Copied positive prompt" : "Copy positive prompt"}
                                                        className="h-7 w-7 absolute top-0 right-0 text-muted-foreground hover:text-foreground"
                                                        onClick={() => handleCopy(String(currentMetadata.prompt), "positive")}
                                                    >
                                                        {copyState.positive ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>{copyState.positive ? "Copied!" : "Copy positive prompt"}</TooltipContent>
                                            </Tooltip>
                                            <p className="text-foreground/80 bg-muted/20 p-2 pr-10 rounded border border-border/60 text-[11px] font-mono whitespace-pre-wrap leading-relaxed w-full">
                                                {String(currentMetadata.prompt)}
                                            </p>
                                        </div>
                                    )}

                                    {/* Negative Prompt - Full width, auto-height */}
                                    {!!currentMetadata.negative_prompt && (
                                        <div className="w-full relative">
                                            <span className="font-medium text-muted-foreground text-[10px] uppercase block mb-1">Negative Prompt</span>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label={copyState.negative ? "Copied negative prompt" : "Copy negative prompt"}
                                                        className="h-7 w-7 absolute top-0 right-0 text-muted-foreground hover:text-foreground"
                                                        onClick={() => handleCopy(String(currentMetadata.negative_prompt), "negative")}
                                                    >
                                                        {copyState.negative ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>{copyState.negative ? "Copied!" : "Copy negative prompt"}</TooltipContent>
                                            </Tooltip>
                                            <p className="text-foreground/80 bg-destructive/10 p-2 pr-10 rounded border border-destructive/20 text-[11px] font-mono whitespace-pre-wrap leading-relaxed w-full">
                                                {String(currentMetadata.negative_prompt)}
                                            </p>
                                        </div>
                                    )}

                                    {/* Parameters Grid */}
                                    {!!currentMetadata.job_params && typeof currentMetadata.job_params === 'object' && Object.keys(currentMetadata.job_params).length > 0 && (
                                        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-x-4 gap-y-2 pt-2 border-t border-border/50">
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
                                                    <Tooltip key={k}>
                                                        <TooltipTrigger asChild>
                                                            <div className="min-w-0 cursor-default">
                                                                <span className="font-medium text-muted-foreground capitalize text-[9px] uppercase tracking-wide block truncate">{k.replace(/_/g, ' ')}</span>
                                                                <span className="text-foreground font-mono text-xs block truncate">{String(v)}</span>
                                                            </div>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top" className="max-w-xs">
                                                            <div className="text-xs">
                                                                <span className="font-semibold text-foreground/80">{k.replace(/_/g, ' ')}</span>
                                                                <span className="mx-1 text-muted-foreground">:</span>
                                                                <span className="font-mono break-all">{String(v)}</span>
                                                            </div>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                ))
                                            }
                                        </div>
                                    )}

                                    {/* Loading indicator */}
                                    {metadataLoading && (
                                        <div className="text-xs text-muted-foreground italic">Loading metadata...</div>
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
                        <div
                            className="w-full h-full flex items-center justify-center"
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                            onDoubleClick={(e) => {
                                if (e.target === e.currentTarget) {
                                    toggleFullScreen();
                                }
                            }}
                            style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
                        >
                            {isVideo ? (
                                <video
                                    src={imageUrl}
                                    style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`, transition: isDragging ? 'none' : 'transform 0.1s ease-out', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                                    controls
                                    preload="metadata"
                                    playsInline
                                    draggable={false}
                                />
                            ) : (
                                <img
                                    src={imageUrl}
                                    alt="Full Screen"
                                    style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`, transition: isDragging ? 'none' : 'transform 0.1s ease-out', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                                    draggable={false}
                                />
                            )}
                        </div>
                    </div>
                )}

                <InpaintEditor
                    open={maskEditorOpen}
                    onOpenChange={setMaskEditorOpen}
                    imageUrl={imageUrl}
                    onSave={handleMaskSave}
                />
            </div>
        </>
    );
});
