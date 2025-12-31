import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { api, Project, FolderImage, GalleryItem } from "@/lib/api";
import { isVideoFile } from "@/lib/media";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, FolderOpen, ImageIcon, Loader2, Download, Trash2, Check, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { VirtualGrid } from "@/components/VirtualGrid";

interface ProjectGalleryProps {
    projects: Project[];
    className?: string;
    onSelectImage?: (imagePath: string, images: FolderImage[]) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workflows?: any[];
    onRegenerate?: (item: any, seedOption: 'same' | 'random') => void;
    onUseInPipe?: (payload: { workflowId: string; imagePath: string; galleryItem: GalleryItem }) => void;
    externalSelection?: {
        projectId?: string | null;
        folder?: string | null;
        collapsed?: boolean;
    };
    externalSelectionKey?: number;
}

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
    const videoRef = React.useRef<HTMLVideoElement>(null);
    const isVideo = isVideoFile(image.path, image.filename);

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
        <div
            className={cn(
                "h-full w-full relative group cursor-pointer rounded overflow-hidden border transition-all",
                isSelected
                    ? "border-blue-500 ring-2 ring-blue-500 scale-[0.97]"
                    : "border-slate-200 hover:border-blue-400 hover:shadow-md"
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
                <video
                    ref={videoRef}
                    src={`/api/v1/gallery/image/path?path=${encodeURIComponent(image.path)}`}
                    className="w-full h-full object-cover"
                    preload="metadata"
                    muted
                    playsInline
                    loop
                />
            ) : (
                <img
                    src={`/api/v1/gallery/image/path?path=${encodeURIComponent(image.path)}`}
                    alt={image.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                />
            )}
            <div className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[8px] p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="truncate">{image.filename}</div>
                {image.width && image.height && (
                    <div className="text-[7px] text-slate-300">{image.width}×{image.height}</div>
                )}
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparison - only re-render if these specific props change
    return prevProps.image.path === nextProps.image.path &&
        prevProps.isSelected === nextProps.isSelected;
});

export const ProjectGallery = React.memo(function ProjectGallery({ projects, className, onSelectImage, workflows = [], onRegenerate, onUseInPipe, externalSelection, externalSelectionKey }: ProjectGalleryProps) {
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
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; image: FolderImage } | null>(null);
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const lastSelectedPath = useRef<string | null>(null);
    const imagesRef = useRef<FolderImage[]>([]);
    const [gridResetKey, setGridResetKey] = useState(0);
    // Track previous project to avoid resetting folder on transient empty states
    const prevProjectIdRef = useRef<string>(selectedProjectId);

    // Keep imagesRef in sync with images state for stable callbacks
    imagesRef.current = images;

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

        // Reset VirtualGrid scroll position when switching folders
        setGridResetKey(prev => prev + 1);

        const loadImages = async (showLoading = true) => {
            if (!selectedProjectId || !selectedFolder) {
                if (mounted) setImages([]);
                return;
            }

            if (showLoading) setIsLoading(true);
            try {
                const data = await api.getProjectFolderImages(
                    parseInt(selectedProjectId),
                    selectedFolder
                );
                if (mounted) setImages(data);
            } catch (e) {
                console.error("Failed to load folder images", e);
                if (mounted) setImages([]);
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
    const galleryEmptyState = React.useMemo(() => {
        if (isLoading) {
            return (
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
            );
        }
        if (!selectedProjectId) {
            return (
                <div className="text-center py-8 text-xs text-slate-400">
                    <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <div>Select a project to browse images</div>
                </div>
            );
        }
        if (images.length === 0) {
            return (
                <div className="text-center py-8 text-xs text-slate-400">
                    <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <div>No images in this folder</div>
                </div>
            );
        }
        return null;
    }, [images.length, isLoading, selectedProjectId]);

    // Handle drag start - set the image URL as draggable data
    const handleDragStart = useCallback((e: React.DragEvent, image: FolderImage) => {
        const imageUrl = `/api/v1/gallery/image/path?path=${encodeURIComponent(image.path)}`;
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
        if (!confirm(`Delete ${selectedPaths.size} images? This cannot be undone.`)) return;

        // Capture the paths to delete before any async operations
        // This prevents stale closure issues where selectedPaths might change during the await
        const pathsToDelete = new Set(selectedPaths);

        // Clear selection immediately for better UX
        setSelectedPaths(new Set());

        try {
            await api.deleteFolderImages(parseInt(selectedProjectId), selectedFolder, Array.from(pathsToDelete));
            // Use the captured Set for filtering to ensure we remove exactly the deleted paths
            setImages(prev => prev.filter(img => !pathsToDelete.has(img.path)));
        } catch (e) {
            console.error("Bulk delete failed", e);
            alert("Failed to delete some images");
            // Restore selection if delete failed
            setSelectedPaths(pathsToDelete);
        }
    };

    // Context menu handlers
    const handleContextMenu = useCallback((e: React.MouseEvent, image: FolderImage) => {
        e.preventDefault();
        const menuWidth = 160; // Approximate menu width
        const menuHeight = 200; // Approximate menu height with submenus

        let x = e.clientX;
        let y = e.clientY;

        // Flip to left if would overflow right edge
        if (x + menuWidth > window.innerWidth) {
            x = window.innerWidth - menuWidth - 8;
        }

        // Flip up if would overflow bottom edge
        if (y + menuHeight > window.innerHeight) {
            y = window.innerHeight - menuHeight - 8;
        }

        setContextMenu({ x, y, image });
    }, []);

    const handleDownload = async () => {
        if (!contextMenu) return;
        const { image } = contextMenu;
        try {
            const url = `/api/v1/gallery/image/path?path=${encodeURIComponent(image.path)}`;
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

    const handleDelete = async () => {
        if (!contextMenu || !selectedProjectId || !selectedFolder) return;
        const { image } = contextMenu;

        if (!confirm(`Delete "${image.filename}"? This cannot be undone.`)) {
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

            await api.deleteFolderImages(parseInt(selectedProjectId), selectedFolder, [image.path]);
            const newImages = images.filter(img => img.path !== image.path);
            setImages(newImages);

            // Navigate to next image after deletion
            if (nextImage && onSelectImage) {
                onSelectImage(nextImage.path, newImages);
            }
        } catch (e) {
            console.error("Delete failed", e);
            alert("Failed to delete image");
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

    if (collapsed) {
        return (
            <div className={cn("flex-none w-10 bg-white border-l flex flex-col items-center py-2", className)}>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCollapsed(false)}
                    title="Expand Gallery"
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="mt-4 [writing-mode:vertical-rl] [text-orientation:mixed] text-xs text-slate-400 font-medium tracking-wider whitespace-nowrap">
                    project gallery
                </div>
            </div>
        );
    }

    return (
        <div className={cn("flex-none w-64 bg-white border-l flex flex-col h-full overflow-hidden", className)}>
            {/* Header */}
            <div className="flex-none p-3 border-b bg-slate-50/50">
                <div className="flex items-center justify-between mb-3">
                    <div className="text-xs font-bold text-slate-800 tracking-wider">PROJECT GALLERY</div>
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
                                <FolderOpen className="h-3 w-3 mr-1 text-slate-400" />
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
                items={galleryItems}
                columnCount={2}
                rowHeight={(columnWidth) => columnWidth}
                gap={4}
                padding={8}
                overscan={3}
                className="flex-1"
                scrollToTopKey={gridResetKey}
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
                <div className="flex-none p-3 border-t bg-slate-50">
                    {selectedPaths.size > 0 ? (
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-blue-600">{selectedPaths.size} selected</span>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-3 text-xs"
                                    onClick={() => setSelectedPaths(new Set())}
                                >
                                    Clear
                                </Button>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    className="h-8 px-3 text-xs"
                                    onClick={handleBulkDelete}
                                >
                                    <Trash2 className="h-4 w-4 mr-1" />
                                    Delete
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center text-xs text-slate-400">Ctrl+click to select, drag to use</div>
                    )}
                </div>
            )}

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-50 bg-white border border-slate-200 rounded-md shadow-lg py-1 min-w-[140px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-slate-100 flex items-center gap-2"
                        onClick={handleDownload}
                    >
                        <Download className="h-3 w-3" />
                        download
                    </button>

                    {/* Regenerate with submenu */}
                    {onRegenerate && (
                        <div className="relative group">
                            <div className="w-full px-3 py-1.5 text-left text-xs hover:bg-slate-100 flex items-center justify-between cursor-pointer">
                                <span className="flex items-center gap-2"><RotateCcw className="h-3 w-3" /> regenerate</span>
                                <span className="text-[10px]">▶</span>
                            </div>
                            <div className="absolute right-full top-0 pr-1 hidden group-hover:block">
                                <div className="bg-white border border-slate-200 rounded-md shadow-lg py-1 w-36">
                                    <button
                                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-slate-100"
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
                                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-slate-100"
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
                    {onUseInPipe && workflows.filter(w => {
                        const jsonStr = JSON.stringify(w.graph_json || {});
                        return jsonStr.includes("LoadImage") || jsonStr.includes("VAEEncode");
                    }).length > 0 && (
                            <div className="relative group">
                                <div className="w-full px-3 py-1.5 text-left text-xs hover:bg-slate-100 flex items-center justify-between cursor-pointer">
                                    <span className="flex items-center gap-2">use in pipe</span>
                                    <span className="text-[10px]">▶</span>
                                </div>
                                <div className="absolute right-full top-0 pr-1 hidden group-hover:block">
                                    <div className="bg-white border border-slate-200 rounded-md shadow-lg py-1 w-40 max-h-48 overflow-y-auto">
                                        {workflows.filter(w => {
                                            const jsonStr = JSON.stringify(w.graph_json || {});
                                            return jsonStr.includes("LoadImage") || jsonStr.includes("VAEEncode");
                                        }).map((w: any) => (
                                            <button
                                                key={w.id}
                                                className="w-full px-3 py-1.5 text-left text-xs hover:bg-slate-100 truncate"
                                                onClick={() => {
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
                                                    setContextMenu(null);
                                                }}
                                            >
                                                {w.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                    <div className="h-px bg-slate-100 my-1" />
                    <button
                        className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 flex items-center gap-2"
                        onClick={handleDelete}
                    >
                        <Trash2 className="h-3 w-3" />
                        delete
                    </button>
                </div>
            )}
        </div>
    );
});
