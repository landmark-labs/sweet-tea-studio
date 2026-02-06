import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { api, Project, FolderImage, GalleryItem, IMAGE_API_BASE } from "@/lib/api";
import { isVideoFile } from "@/lib/media";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, FolderOpen, ImageIcon, Loader2, Download, Trash2, Check, RotateCcw, PenTool, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { VirtualGrid } from "@/components/VirtualGrid";
import { getScrollPosition, saveScrollPosition } from "@/lib/galleryState";
import { InpaintEditor } from "@/components/InpaintEditor";
import { useMediaTrayStore } from "@/lib/stores/mediaTrayStore";
import { workflowSupportsImageInput } from "@/lib/workflowGraph";

interface ProjectGalleryProps {
    projects: Project[];
    className?: string;
    onSelectImage?: (imagePath: string, images: FolderImage[]) => void;
    onImagesUpdate?: (payload: { projectId: string | null; folder: string | null; images: FolderImage[] }) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workflows?: any[];
    onRegenerate?: (item: any, seedOption: 'same' | 'random') => void;
    onUseInPipe?: (payload: { workflowId: string; imagePath: string; galleryItem: GalleryItem }) => void;
    onBulkDelete?: (deletedPaths: string[], remainingImages: FolderImage[], deletedImageIds?: number[]) => void;
    externalSelection?: {
        projectId?: string | null;
        folder?: string | null;
        collapsed?: boolean;
    };
    externalSelectionKey?: number;
}

const THUMBNAIL_MAX_PX = 256;
const THUMBNAIL_URL_VERSION = 2;

const buildMediaUrl = (path: string) =>
    `${IMAGE_API_BASE}/gallery/image/path?path=${encodeURIComponent(path)}`;

const buildThumbnailUrl = (path: string, mtime?: string, maxPx: number = THUMBNAIL_MAX_PX) => {
    const params = new URLSearchParams({
        path,
        max_px: String(maxPx),
        thumb_v: String(THUMBNAIL_URL_VERSION),
    });
    if (mtime) params.append("v", mtime);
    return `${IMAGE_API_BASE}/gallery/image/path/thumbnail?${params.toString()}`;
};

const buildFolderImagesUrl = (projectId: string, folder: string) => {
    const params = new URLSearchParams({
        include_dimensions: "true",
        dimensions_source: "auto",
    });
    return `${IMAGE_API_BASE}/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folder)}/images?${params.toString()}`;
};

// Memoized gallery item - only re-renders when its specific props change
interface GalleryItemCellProps {
    image: FolderImage;
    isSelected: boolean;
    onDragStart: (e: React.DragEvent, image: FolderImage) => void;
    onClick: (image: FolderImage, e: React.MouseEvent) => void;
    onContextMenu: (e: React.MouseEvent, image: FolderImage) => void;
}

const GalleryItemCell = React.memo(function GalleryItemCell({
    image,
    isSelected,
    onDragStart,
    onClick,
    onContextMenu,
}: GalleryItemCellProps) {
    const [isHovering, setIsHovering] = React.useState(false);
    const isVideo = isVideoFile(image.path, image.filename);
    const mediaUrl = useMemo(() => buildMediaUrl(image.path), [image.path]);
    const thumbnailUrl = useMemo(() => buildThumbnailUrl(image.path, image.mtime), [image.path, image.mtime]);

    const handleMouseEnter = React.useCallback(() => {
        if (isVideo) setIsHovering(true);
    }, [isVideo]);

    const handleMouseLeave = React.useCallback(() => {
        if (isVideo) setIsHovering(false);
    }, [isVideo]);

    const showVideo = isVideo && isHovering;

    return (
        <div
            className={cn(
                "h-full w-full relative group cursor-pointer rounded overflow-hidden border transition-all",
                isSelected
                    ? "border-blue-500 ring-2 ring-blue-500 scale-[0.97]"
                    : "border-border/60 hover:border-blue-400 hover:shadow-md dark:hover:border-primary/60"
            )}
            draggable
            onDragStart={(e) => onDragStart(e, image)}
            onClick={(e) => onClick(image, e)}
            onContextMenu={(e) => onContextMenu(e, image)}
            onMouseEnter={isVideo ? handleMouseEnter : undefined}
            onMouseLeave={isVideo ? handleMouseLeave : undefined}
            title={`${image.filename}\nClick to view, Ctrl+click to select, Shift+click for range`}
        >
            {/* Selection indicator */}
            {isSelected && (
                <div className="absolute top-1 left-1 z-20 bg-blue-500 text-white rounded-full p-0.5">
                    <Check className="w-3 h-3" />
                </div>
            )}
            {isVideo ? (
                showVideo ? (
                    <video
                        src={mediaUrl}
                        poster={thumbnailUrl}
                        className="w-full h-full object-contain bg-black/50"
                        preload="metadata"
                        muted
                        playsInline
                        loop
                        autoPlay
                    />
                ) : (
                    <img
                        src={thumbnailUrl}
                        alt={image.filename}
                        className="w-full h-full object-contain bg-black/50"
                        loading="lazy"
                        decoding="async"
                    />
                )
            ) : (
                <img
                    src={thumbnailUrl}
                    alt={image.filename}
                    className="w-full h-full object-contain bg-black/50"
                    loading="lazy"
                    decoding="async"
                />
            )}
            <div className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[8px] p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="truncate">{image.filename}</div>
                {image.width && image.height && (
                    <div className="text-[7px] text-white/70">{image.width}×{image.height}</div>
                )}
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparison - only re-render if these specific props change
    return prevProps.image.path === nextProps.image.path &&
        prevProps.image.mtime === nextProps.image.mtime &&
        prevProps.isSelected === nextProps.isSelected;
});

export const ProjectGallery = React.memo(function ProjectGallery({
    projects,
    className,
    onSelectImage,
    onImagesUpdate,
    workflows = [],
    onRegenerate,
    onUseInPipe,
    onBulkDelete,
    externalSelection,
    externalSelectionKey,
}: ProjectGalleryProps) {
    // Panel state - persisted
    const [collapsed, setCollapsed] = useState(() => {
        const saved = localStorage.getItem("ds_project_gallery_collapsed");
        return saved === "true";
    });

    // Selection state - persisted
    const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
        return localStorage.getItem("ds_project_gallery_project") || "";
    });
    const [selectedFolder, setSelectedFolder] = useState<string>(() => {
        return localStorage.getItem("ds_project_gallery_folder") || "";
    });
    const [images, setImages] = useState<FolderImage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; image: FolderImage; submenuFlipUp: boolean } | null>(null);
    const [contextSubmenu, setContextSubmenu] = useState<"regenerate" | "useInPipe" | null>(null);
    const [maskEditorOpen, setMaskEditorOpen] = useState(false);
    const [maskEditorSourcePath, setMaskEditorSourcePath] = useState<string>("");
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const lastSelectedPath = useRef<string | null>(null);
    const imagesRef = useRef<FolderImage[]>([]);
    const etagRef = useRef<string | null>(null);
    const submenuCloseTimerRef = useRef<number | null>(null);
    // Track previous project to avoid resetting folder on transient empty states
    const prevProjectIdRef = useRef<string>(selectedProjectId);
    const onImagesUpdateRef = useRef<ProjectGalleryProps["onImagesUpdate"]>(onImagesUpdate);

    // Keep imagesRef in sync with images state for stable callbacks
    imagesRef.current = images;
    useEffect(() => {
        onImagesUpdateRef.current = onImagesUpdate;
    }, [onImagesUpdate]);

    const addToMediaTray = useMediaTrayStore(useCallback((state) => state.addItems, []));
    const clearSubmenuCloseTimer = useCallback(() => {
        if (submenuCloseTimerRef.current) {
            window.clearTimeout(submenuCloseTimerRef.current);
            submenuCloseTimerRef.current = null;
        }
    }, []);

    const scheduleSubmenuClose = useCallback(() => {
        clearSubmenuCloseTimer();
        submenuCloseTimerRef.current = window.setTimeout(() => {
            setContextSubmenu(null);
            submenuCloseTimerRef.current = null;
        }, 250);
    }, [clearSubmenuCloseTimer]);

    const handleSubmenuEnter = useCallback((menu: "regenerate" | "useInPipe") => {
        clearSubmenuCloseTimer();
        setContextSubmenu(menu);
    }, [clearSubmenuCloseTimer]);

    const handleSubmenuLeave = useCallback(() => {
        scheduleSubmenuClose();
    }, [scheduleSubmenuClose]);

    const useInPipeWorkflows = useMemo(() => {
        if (!onUseInPipe || workflows.length === 0) return [];
        return workflows.filter((w) => workflowSupportsImageInput(w?.graph_json));
    }, [onUseInPipe, workflows]);

    // Pre-process projects: Sort "drafts" to top, rename to "drafts", ensure it has "output" folder
    const sortedProjects = useMemo(() => {
        const result = [...projects];
        const draftsIndex = result.findIndex(p => p.slug === "drafts");

        if (draftsIndex !== -1) {
            const drafts = { ...result[draftsIndex] };
            // Rename to lowercase "drafts"
            drafts.name = "drafts";

            // Ensure it has at least "output" folder
            const config = drafts.config_json || {};
            const folders = config.folders || [];
            if (!folders.includes("output")) {
                drafts.config_json = {
                    ...config,
                    folders: ["output", ...folders]
                };
            }

            // Move to start
            result.splice(draftsIndex, 1);
            result.unshift(drafts);
        }

        return result;
    }, [projects]);

    // Get selected project from sorted list
    const selectedProject = sortedProjects.find(p => String(p.id) === selectedProjectId);

    // Memoize folders for referential stability - prevents effect re-runs on every render
    // Use a ref to preserve folders when selectedProject temporarily becomes undefined
    const prevFoldersRef = useRef<string[]>([]);
    const folders = useMemo(() => {
        const currentFolders = (selectedProject?.config_json as { folders?: string[] })?.folders || [];
        // If we have a selectedProjectId but no project found, preserve previous folders
        // This handles transient states where projects array might temporarily be empty
        if (selectedProjectId && !selectedProject && prevFoldersRef.current.length > 0) {
            return prevFoldersRef.current;
        }
        prevFoldersRef.current = currentFolders;
        return currentFolders;
    }, [selectedProject?.config_json, selectedProjectId, selectedProject]);

    // Persist collapsed state
    useEffect(() => {
        localStorage.setItem("ds_project_gallery_collapsed", String(collapsed));
    }, [collapsed]);

    useEffect(() => {
        if (!externalSelection) return;
        if (externalSelection.projectId !== undefined) {
            setSelectedProjectId(externalSelection.projectId || "");
        }
        if (externalSelection.folder !== undefined) {
            setSelectedFolder(externalSelection.folder || "");
        }
        if (externalSelection.collapsed !== undefined) {
            setCollapsed(Boolean(externalSelection.collapsed));
        }
        setSelectedPaths(new Set());
        lastSelectedPath.current = null;
    }, [externalSelection, externalSelectionKey]);

    // Persist project selection
    useEffect(() => {
        localStorage.setItem("ds_project_gallery_project", selectedProjectId);
    }, [selectedProjectId]);

    // Persist folder selection
    useEffect(() => {
        localStorage.setItem("ds_project_gallery_folder", selectedFolder);
    }, [selectedFolder]);

    // Persist collapsed state
    useEffect(() => {
        localStorage.setItem("ds_project_gallery_collapsed", String(collapsed));
    }, [collapsed]);

    // Load images when project/folder changes
    useEffect(() => {
        let mounted = true;
        let timeoutId: NodeJS.Timeout;
        etagRef.current = null;

        const loadImages = async (showLoading = true) => {
            if (!selectedProjectId || !selectedFolder) {
                if (mounted) {
                    setImages([]);
                    onImagesUpdateRef.current?.({
                        projectId: selectedProjectId || null,
                        folder: selectedFolder || null,
                        images: [],
                    });
                }
                return;
            }

            if (showLoading) setIsLoading(true);
            try {
                const url = buildFolderImagesUrl(selectedProjectId, selectedFolder);
                const headers: HeadersInit = {};
                if (!showLoading && etagRef.current) {
                    headers["If-None-Match"] = etagRef.current;
                }
                const res = await fetch(url, { headers });
                if (res.status === 304) {
                    return;
                }
                if (!res.ok) {
                    throw new Error("Failed to fetch folder images");
                }
                const nextEtag = res.headers.get("ETag");
                if (nextEtag) {
                    etagRef.current = nextEtag;
                }
                const data = await res.json();
                if (mounted) {
                    setImages(data);
                    onImagesUpdateRef.current?.({
                        projectId: selectedProjectId || null,
                        folder: selectedFolder || null,
                        images: data,
                    });
                }
            } catch (e) {
                console.error("Failed to load folder images", e);
                if (mounted) {
                    etagRef.current = null;
                    setImages([]);
                    onImagesUpdateRef.current?.({
                        projectId: selectedProjectId || null,
                        folder: selectedFolder || null,
                        images: [],
                    });
                }
            } finally {
                if (mounted && showLoading) setIsLoading(false);
            }
        };

        // Initial load
        loadImages(true);

        // Poll every 5 seconds - but skip when tab is hidden or panel is collapsed
        // This is a performance optimization to reduce unnecessary network requests and state updates
        const poll = async () => {
            if (!mounted) return;

            // Skip polling if tab is hidden or panel is collapsed
            const isHidden = typeof document !== "undefined" && document.visibilityState === "hidden";
            if (!isHidden && !collapsed) {
                await loadImages(false); // Background update
            }

            if (mounted) timeoutId = setTimeout(poll, 5000);
        };

        timeoutId = setTimeout(poll, 5000);

        return () => {
            mounted = false;
            clearTimeout(timeoutId);
        };
    }, [selectedProjectId, selectedFolder, collapsed]);

    // Reset folder when project changes
    useEffect(() => {
        const projectChanged = selectedProjectId !== prevProjectIdRef.current;
        prevProjectIdRef.current = selectedProjectId;

        if (projectChanged) {
            // Project changed - reset folder selection to first available or empty
            if (folders.length > 0) {
                setSelectedFolder(folders[0]);
            } else {
                setSelectedFolder("");
            }
        } else if (folders.length > 0 && !folders.includes(selectedFolder)) {
            // Same project, but current folder no longer exists (e.g., was deleted)
            // Switch to first available folder
            setSelectedFolder(folders[0]);
        }
        // Note: Don't reset folder to empty when folders.length === 0 and project hasn't changed
        // This handles transient empty states during re-renders
    }, [selectedProjectId, folders, selectedFolder]);

    const galleryItems = !isLoading && selectedProjectId && images.length > 0 ? images : [];

    // Generate a unique key for the current view and retrieve initial scroll position
    const currentViewKey = `${selectedProjectId}:${selectedFolder}`;
    const initialScrollTop = useMemo(() => getScrollPosition(currentViewKey), [currentViewKey]);

    // Handler to save scroll position
    const handleScroll = useCallback((scrollTop: number) => {
        // Only save scroll position if we have images loaded
        // This prevents overwriting with 0 during loading/initialization
        if (images.length > 0) {
            saveScrollPosition(currentViewKey, scrollTop);
        }
    }, [currentViewKey, images.length]);

    const galleryEmptyState = React.useMemo(() => {
        if (isLoading) {
            return (
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            );
        }
        if (!selectedProjectId) {
            return (
                <div className="text-center py-8 text-xs text-muted-foreground">
                    <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <div>Select a project to browse images</div>
                </div>
            );
        }
        if (images.length === 0) {
            return (
                <div className="text-center py-8 text-xs text-muted-foreground">
                    <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <div>No images in this folder</div>
                </div>
            );
        }
        return null;
    }, [images.length, isLoading, selectedProjectId]);

    // Handle drag start - set the image URL as draggable data
    const handleDragStart = useCallback((e: React.DragEvent, image: FolderImage) => {
        const imageUrl = buildMediaUrl(image.path);
        e.dataTransfer.setData("text/plain", imageUrl);
        e.dataTransfer.effectAllowed = "copy";
        // Set the raw filesystem path so ImageUpload can detect it's internal and reuse the path
        e.dataTransfer.setData("application/x-sweet-tea-image", image.path);
    }, []);

    // Multi-select handler
    const handleImageClick = useCallback((image: FolderImage, e: React.MouseEvent) => {
        // Use imagesRef.current to ensure we always have the latest images array
        // (the memo comparison for GalleryItemCell doesn't track onClick changes)
        const currentImages = imagesRef.current;

        if (e.ctrlKey || e.metaKey) {
            // Toggle selection
            setSelectedPaths(prev => {
                const newSet = new Set(prev);
                if (newSet.has(image.path)) newSet.delete(image.path);
                else newSet.add(image.path);
                return newSet;
            });
            lastSelectedPath.current = image.path;
        } else if (e.shiftKey && lastSelectedPath.current) {
            // Range selection
            const startIdx = currentImages.findIndex(img => img.path === lastSelectedPath.current);
            const endIdx = currentImages.findIndex(img => img.path === image.path);
            if (startIdx !== -1 && endIdx !== -1) {
                const low = Math.min(startIdx, endIdx);
                const high = Math.max(startIdx, endIdx);
                setSelectedPaths(prev => {
                    const newSet = new Set(prev);
                    currentImages.slice(low, high + 1).forEach(img => newSet.add(img.path));
                    return newSet;
                });
            }
        } else {
            // Normal click - view image and pass images array for navigation
            onSelectImage?.(image.path, currentImages);
        }
    }, [onSelectImage]);

    // Bulk delete handler
    const handleBulkDelete = async () => {
        if (selectedPaths.size === 0 || !selectedProjectId || !selectedFolder) return;
        if (!confirm(`Delete ${selectedPaths.size} images? You can undo briefly if they are tracked in the generation history.`)) return;

        // Capture the paths to delete before any async operations
        // This prevents stale closure issues where selectedPaths might change during the await
        const pathsToDelete = new Set(selectedPaths);

        // Clear selection immediately for better UX
        setSelectedPaths(new Set());

        try {
            const result = await api.deleteFolderImages(parseInt(selectedProjectId), selectedFolder, Array.from(pathsToDelete));
            // Use the captured Set for filtering to ensure we remove exactly the deleted paths
            const remainingImages = imagesRef.current.filter(img => !pathsToDelete.has(img.path));
            setImages(remainingImages);
            onImagesUpdateRef.current?.({
                projectId: selectedProjectId || null,
                folder: selectedFolder || null,
                images: remainingImages,
            });
            // Notify parent so ImageViewer can update if showing a deleted image
            onBulkDelete?.(Array.from(pathsToDelete), remainingImages, result.soft_deleted_ids || []);
        } catch (e) {
            console.error("Bulk delete failed", e);
            alert("failed to delete some images");
            // Restore selection if delete failed
            setSelectedPaths(pathsToDelete);
        }
    };

    const handleAddSelectedToTray = useCallback(() => {
        if (selectedPaths.size === 0) return;
        const toAdd = imagesRef.current
            .filter((img) => selectedPaths.has(img.path))
            .map((img) => ({ path: img.path, filename: img.filename }));
        if (toAdd.length === 0) return;
        addToMediaTray(toAdd);
    }, [addToMediaTray, selectedPaths]);

    // Context menu handlers
    const handleContextMenu = useCallback((e: React.MouseEvent, image: FolderImage) => {
        e.preventDefault();
        const menuWidth = 160; // Approximate menu width
        const menuHeight = 280; // Approximate menu height (increased to account for all items + submenus)

        let x = e.clientX;
        let y = e.clientY;

        // Flip to left if would overflow right edge
        if (x + menuWidth > window.innerWidth) {
            x = window.innerWidth - menuWidth - 8;
        }

        // Ensure minimum x position
        if (x < 8) {
            x = 8;
        }

        // Flip up if would overflow bottom edge
        if (y + menuHeight > window.innerHeight) {
            y = Math.max(8, window.innerHeight - menuHeight - 8);
        }

        // Check if we need to flip submenus upward (when near bottom of viewport)
        const submenuFlipUp = e.clientY > window.innerHeight - 200;

        clearSubmenuCloseTimer();
        setContextSubmenu(null);
        setContextMenu({ x, y, image, submenuFlipUp });
    }, [clearSubmenuCloseTimer]);

    const handleDownload = async () => {
        if (!contextMenu) return;
        const { image } = contextMenu;
        try {
            const url = buildMediaUrl(image.path);
            const res = await fetch(url);
            const blob = await res.blob();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = image.filename;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (e) {
            console.error("Download failed", e);
        }
        setContextMenu(null);
    };

    const openMaskEditorForImage = useCallback((image: FolderImage) => {
        if (isVideoFile(image.path, image.filename)) return;
        setMaskEditorSourcePath(image.path);
        setMaskEditorOpen(true);
        setContextMenu(null);
    }, []);

    const handleMaskSave = useCallback(async (maskFile: File) => {
        if (!maskEditorSourcePath) {
            alert("missing source image path");
            return;
        }

        try {
            const result = await api.saveMask(maskFile, maskEditorSourcePath);
            const location = result.saved_to === "project_masks" ? "project masks folder" : "same folder";
            alert(`mask saved: ${result.filename} (${location})`);
        } catch (e) {
            console.error("Failed to save mask", e);
            alert("failed to save mask");
        }
    }, [maskEditorSourcePath]);

    const handleDelete = async () => {
        if (!contextMenu || !selectedProjectId || !selectedFolder) return;
        const { image } = contextMenu;

        if (!confirm(`Delete "${image.filename}"? You can undo briefly if it is tracked in the generation history.`)) {
            setContextMenu(null);
            return;
        }

        try {
            // Find the next image to navigate to before deleting
            const currentIdx = images.findIndex(img => img.path === image.path);
            let nextImage: FolderImage | null = null;
            if (images.length > 1) {
                if (currentIdx < images.length - 1) {
                    nextImage = images[currentIdx + 1];
                } else {
                    nextImage = images[currentIdx - 1];
                }
            }

            const result = await api.deleteFolderImages(parseInt(selectedProjectId), selectedFolder, [image.path]);
            const newImages = images.filter(img => img.path !== image.path);
            setImages(newImages);
            onImagesUpdateRef.current?.({
                projectId: selectedProjectId || null,
                folder: selectedFolder || null,
                images: newImages,
            });
            onBulkDelete?.([image.path], newImages, result.soft_deleted_ids || []);

            // Navigate to next image after deletion
            if (nextImage && onSelectImage) {
                onSelectImage(nextImage.path, newImages);
            }
        } catch (e) {
            console.error("Delete failed", e);
            alert("failed to delete image");
        }
        setContextMenu(null);
    };

    // Close context menu on click outside
    useEffect(() => {
        if (!contextMenu) return;
        const close = () => setContextMenu(null);
        window.addEventListener("click", close);
        return () => window.removeEventListener("click", close);
    }, [contextMenu]);

    useEffect(() => {
        if (!contextMenu) {
            clearSubmenuCloseTimer();
            setContextSubmenu(null);
        }
    }, [contextMenu, clearSubmenuCloseTimer]);

    if (collapsed) {
        return (
            <div className={cn("flex-none w-10 bg-card border-l border-border/70 flex flex-col items-center py-2", className)}>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCollapsed(false)}
                    title="Expand Gallery"
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="mt-4 [writing-mode:vertical-rl] [text-orientation:mixed] text-xs text-muted-foreground font-medium tracking-wider whitespace-nowrap">
                    PROJECT GALLERY
                </div>
            </div>
        );
    }

    return (
        <div className={cn("flex-none w-64 bg-card border-l border-border/70 flex flex-col h-full overflow-hidden", className)}>
            {/* Header */}
            <div className="flex-none p-3 border-b border-border/60 bg-muted/20">
                <div className="flex items-center justify-between mb-3">
                    <div className="text-xs font-bold text-foreground tracking-wider">PROJECT GALLERY</div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setCollapsed(true)}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>

                {/* Project Selector */}
                <div className="space-y-2">
                    <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select project...">
                                {selectedProject?.name || "Select project..."}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {sortedProjects.length === 0 ? (
                                <SelectItem value="__empty" disabled>No projects</SelectItem>
                            ) : (
                                sortedProjects.map((p) => (
                                    <SelectItem key={p.id} value={String(p.id)}>
                                        {p.name}
                                    </SelectItem>
                                ))
                            )}
                        </SelectContent>
                    </Select>

                    {/* Folder Selector */}
                    {selectedProjectId && folders.length > 0 && (
                        <Select value={selectedFolder} onValueChange={setSelectedFolder}>
                            <SelectTrigger className="h-7 text-[10px]">
                                <FolderOpen className="h-3 w-3 mr-1 text-muted-foreground" />
                                <SelectValue placeholder="Select folder..." />
                            </SelectTrigger>
                            <SelectContent>
                                {folders.map((folder) => (
                                    <SelectItem key={folder} value={folder}>
                                        /{folder}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </div>
            </div>

            {/* Image Grid */}
            <VirtualGrid
                key={currentViewKey}
                items={galleryItems}
                columnCount={2}
                rowHeight={(columnWidth) => columnWidth}
                gap={4}
                padding={8}
                overscan={3}
                className="flex-1"
                initialScrollTop={initialScrollTop}
                onScroll={handleScroll}
                emptyState={galleryEmptyState}
                getKey={(image) => image.path}
                renderItem={(image) => (
                    <GalleryItemCell
                        image={image}
                        isSelected={selectedPaths.has(image.path)}
                        onDragStart={handleDragStart}
                        onClick={handleImageClick}
                        onContextMenu={handleContextMenu}
                    />
                )}
            />

            {/* Footer with selection or hint */}
            {images.length > 0 && (
                <div className="flex-none p-3 border-t border-border/50 bg-background">
                    {selectedPaths.size > 0 ? (
                        <div className="flex flex-col gap-2">
                            <div className="flex flex-nowrap items-center justify-between gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-2 text-[11px] whitespace-nowrap"
                                    onClick={handleAddSelectedToTray}
                                >
                                    <Plus className="h-4 w-4 mr-1" />
                                    Add
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-2 text-[11px] whitespace-nowrap"
                                    onClick={() => setSelectedPaths(new Set())}
                                >
                                    Clear
                                </Button>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    className="h-8 px-2 text-[11px] whitespace-nowrap"
                                    onClick={handleBulkDelete}
                                >
                                    <Trash2 className="h-4 w-4 mr-1" />
                                    Delete
                                </Button>
                            </div>
                            <div className="text-[11px] text-muted-foreground text-center">
                                {selectedPaths.size} selected
                            </div>
                        </div>
                    ) : (
                        <div className="text-center text-xs text-muted-foreground">Ctrl+click to select, drag to use</div>
                    )}
                </div>
            )}

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-50 bg-popover border border-border/60 rounded-md shadow-lg py-1 min-w-[140px] text-popover-foreground"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted/50 flex items-center gap-2 cursor-pointer"
                        onClick={handleDownload}
                    >
                        <Download className="h-3 w-3" />
                        download
                    </button>

                    <button
                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted/50 flex items-center gap-2 cursor-pointer"
                        onClick={() => {
                            addToMediaTray({ path: contextMenu.image.path, filename: contextMenu.image.filename });
                            setContextMenu(null);
                        }}
                    >
                        <Plus className="h-3 w-3" />
                        add to tray
                    </button>

                    {!isVideoFile(contextMenu.image.path, contextMenu.image.filename) && (
                        <button
                            className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted/50 flex items-center gap-2 cursor-pointer"
                            onClick={() => openMaskEditorForImage(contextMenu.image)}
                        >
                            <PenTool className="h-3 w-3" />
                            draw mask
                        </button>
                    )}

                    {/* Regenerate with submenu */}
                    {onRegenerate && (
                        <div
                            className="relative"
                            onMouseEnter={() => handleSubmenuEnter("regenerate")}
                            onMouseLeave={handleSubmenuLeave}
                        >
                            <div className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted/50 flex items-center justify-between cursor-pointer">
                                <span className="flex items-center gap-2"><RotateCcw className="h-3 w-3" /> regenerate</span>
                                <span className="text-[10px]">▶</span>
                            </div>
                            <div
                                className={`absolute right-full ${contextMenu.submenuFlipUp ? 'bottom-0' : 'top-0'} pr-1 ${contextSubmenu === "regenerate" ? "block" : "hidden"}`}
                                onMouseEnter={() => handleSubmenuEnter("regenerate")}
                                onMouseLeave={handleSubmenuLeave}
                            >
                                <div className="bg-popover border border-border/60 rounded-md shadow-lg py-1 w-36">
                                    <button
                                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted/50 cursor-pointer"
                                        onClick={async () => {
                                            // Fetch metadata from image to get workflow_template_id and job_params
                                            try {
                                                const metadata = await api.getImageMetadata(contextMenu.image.path);
                                                const galleryItem: GalleryItem = {
                                                    image: { id: -1, job_id: -1, path: contextMenu.image.path, filename: contextMenu.image.filename, created_at: '' },
                                                    job_params: {
                                                        ...metadata.parameters,
                                                        prompt: metadata.prompt,
                                                        positive: metadata.prompt,
                                                        negative_prompt: metadata.negative_prompt,
                                                        negative: metadata.negative_prompt,
                                                    },
                                                    prompt: metadata.prompt || undefined,
                                                    negative_prompt: metadata.negative_prompt || undefined,
                                                    prompt_history: [],
                                                    created_at: '',
                                                    // Try to get workflow_template_id from metadata parameters
                                                    workflow_template_id: (metadata.parameters as any)?.workflow_template_id,
                                                };
                                                onRegenerate(galleryItem, 'same');
                                            } catch (e) {
                                                console.error("Failed to fetch metadata:", e);
                                                // Fallback without full metadata
                                                const galleryItem: GalleryItem = {
                                                    image: { id: -1, job_id: -1, path: contextMenu.image.path, filename: contextMenu.image.filename, created_at: '' },
                                                    job_params: {},
                                                    prompt_history: [],
                                                    created_at: '',
                                                };
                                                onRegenerate(galleryItem, 'same');
                                            }
                                            setContextMenu(null);
                                        }}
                                    >
                                        same seed
                                    </button>
                                    <button
                                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted/50 cursor-pointer"
                                        onClick={async () => {
                                            // Fetch metadata from image to get workflow_template_id and job_params
                                            try {
                                                const metadata = await api.getImageMetadata(contextMenu.image.path);
                                                const galleryItem: GalleryItem = {
                                                    image: { id: -1, job_id: -1, path: contextMenu.image.path, filename: contextMenu.image.filename, created_at: '' },
                                                    job_params: {
                                                        ...metadata.parameters,
                                                        prompt: metadata.prompt,
                                                        positive: metadata.prompt,
                                                        negative_prompt: metadata.negative_prompt,
                                                        negative: metadata.negative_prompt,
                                                    },
                                                    prompt: metadata.prompt || undefined,
                                                    negative_prompt: metadata.negative_prompt || undefined,
                                                    prompt_history: [],
                                                    created_at: '',
                                                    // Try to get workflow_template_id from metadata parameters
                                                    workflow_template_id: (metadata.parameters as any)?.workflow_template_id,
                                                };
                                                onRegenerate(galleryItem, 'random');
                                            } catch (e) {
                                                console.error("Failed to fetch metadata:", e);
                                                // Fallback without full metadata
                                                const galleryItem: GalleryItem = {
                                                    image: { id: -1, job_id: -1, path: contextMenu.image.path, filename: contextMenu.image.filename, created_at: '' },
                                                    job_params: {},
                                                    prompt_history: [],
                                                    created_at: '',
                                                };
                                                onRegenerate(galleryItem, 'random');
                                            }
                                            setContextMenu(null);
                                        }}
                                    >
                                        random seed (-1)
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Use in pipe with workflow submenu */}
                    {onUseInPipe && useInPipeWorkflows.length > 0 && (
                        <div
                            className="relative"
                            onMouseEnter={() => handleSubmenuEnter("useInPipe")}
                            onMouseLeave={handleSubmenuLeave}
                        >
                            <div className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted/50 flex items-center justify-between cursor-pointer">
                                <span className="flex items-center gap-2">use in pipe</span>
                                <span className="text-[10px]">▶</span>
                            </div>
                            <div
                                className={`absolute right-full ${contextMenu.submenuFlipUp ? 'bottom-0' : 'top-0'} pr-1 ${contextSubmenu === "useInPipe" ? "block" : "hidden"}`}
                                onMouseEnter={() => handleSubmenuEnter("useInPipe")}
                                onMouseLeave={handleSubmenuLeave}
                            >
                                <div className="bg-popover border border-border/60 rounded-md shadow-lg py-1 w-40 max-h-48 overflow-y-auto">
                                    {useInPipeWorkflows.map((w: any) => (
                                        <button
                                            key={w.id}
                                            className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted/50 truncate cursor-pointer"
                                            onClick={async () => {
                                                try {
                                                    const metadata = await api.getImageMetadata(contextMenu.image.path);
                                                    const galleryItem: GalleryItem = {
                                                        image: { id: -1, job_id: -1, path: contextMenu.image.path, filename: contextMenu.image.filename, created_at: '' },
                                                        job_params: {
                                                            ...metadata.parameters,
                                                            prompt: metadata.prompt,
                                                            positive: metadata.prompt,
                                                            negative_prompt: metadata.negative_prompt,
                                                            negative: metadata.negative_prompt,
                                                        },
                                                        prompt: metadata.prompt || undefined,
                                                        negative_prompt: metadata.negative_prompt || undefined,
                                                        prompt_history: [],
                                                        workflow_template_id: w.id,
                                                        created_at: '',
                                                    };
                                                    onUseInPipe({
                                                        workflowId: String(w.id),
                                                        imagePath: contextMenu.image.path,
                                                        galleryItem,
                                                    });
                                                } catch (e) {
                                                    console.error("Failed to fetch metadata:", e);
                                                    const galleryItem: GalleryItem = {
                                                        image: { id: -1, job_id: -1, path: contextMenu.image.path, filename: contextMenu.image.filename, created_at: '' },
                                                        job_params: {},
                                                        prompt_history: [],
                                                        workflow_template_id: w.id,
                                                        created_at: '',
                                                    };
                                                    onUseInPipe({
                                                        workflowId: String(w.id),
                                                        imagePath: contextMenu.image.path,
                                                        galleryItem,
                                                    });
                                                } finally {
                                                    setContextMenu(null);
                                                }
                                            }}
                                        >
                                            {w.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="h-px bg-border/50 my-1" />
                    <button
                        className="w-full px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10 flex items-center gap-2 cursor-pointer"
                        onClick={handleDelete}
                    >
                        <Trash2 className="h-3 w-3" />
                        delete
                    </button>
                </div>
            )}

            <InpaintEditor
                open={maskEditorOpen}
                onOpenChange={setMaskEditorOpen}
                imageUrl={maskEditorSourcePath ? buildMediaUrl(maskEditorSourcePath) : ""}
                onSave={handleMaskSave}
            />
        </div>
    );
});
