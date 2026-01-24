import { useEffect, useRef, useState, useCallback } from "react";
import { api, GalleryItem, Project, IMAGE_API_BASE } from "@/lib/api";
import { isVideoFile } from "@/lib/media";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Download, Trash2, Calendar, Search, RotateCcw, Copy, Check, X, ChevronLeft, ChevronRight, FolderInput, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { resolvePromptsForGalleryItem } from "@/lib/promptUtils";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ProjectSidebar } from "@/components/ProjectSidebar";
import { VirtualGrid } from "@/components/VirtualGrid";
import { MoveImagesDialog } from "@/components/MoveImagesDialog";
import React from "react";
import { useMediaTrayStore } from "@/lib/stores/mediaTrayStore";

const MISSING_IMAGE_SRC =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNDAwIiB2aWV3Qm94PSIwIDAgNDAwIDQwMCI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iI2UyZThmMCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjOTRhM2I4IiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjQiPk1pc3NpbmcgRmlsZTwvdGV4dD48L3N2Zz4=";
const PAGE_SIZE = 80;
const CARD_META_HEIGHT = 260;
const GRID_GAP = 16;
const GRID_PADDING = 8;
const MIN_COLUMN_WIDTH = 260;
const MAX_COLUMN_COUNT = 4;

// Larger thumbnails for Gallery (512px) vs ProjectGallery sidebar (256px) due to bigger cards
const GALLERY_THUMBNAIL_PX = 512;

const buildThumbnailUrl = (imageId: number, maxPx: number = GALLERY_THUMBNAIL_PX) =>
    `${IMAGE_API_BASE}/gallery/image/${imageId}/thumbnail?max_px=${maxPx}`;

// Build actual video/image URL for hover-to-play video thumbnails
const buildMediaUrl = (imageId: number) =>
    `${IMAGE_API_BASE}/gallery/image/${imageId}`;


// Hover-to-play video thumbnail component
// Uses isHovering prop from parent to control playback (overlay blocks direct mouse events)
function VideoThumbnail({ src, className, isHovering }: { src: string; className?: string; isHovering?: boolean }) {
    const videoRef = React.useRef<HTMLVideoElement>(null);

    React.useEffect(() => {
        if (videoRef.current) {
            if (isHovering) {
                videoRef.current.play().catch(() => { });
            } else {
                videoRef.current.pause();
                videoRef.current.currentTime = 0;
            }
        }
    }, [isHovering]);

    return (
        <video
            ref={videoRef}
            src={src}
            className={className}
            preload="metadata"
            muted
            playsInline
            loop
        />
    );
}

// Wrapper for gallery card content to track hover state for video playback
interface GalleryCardContentProps {
    item: GalleryItem;
    isSelected: boolean;
    handleImageError: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}

function GalleryCardContent({ item, isSelected, handleImageError }: GalleryCardContentProps) {
    const [isHovering, setIsHovering] = useState(false);
    const isVideo = isVideoFile(item.image.path, item.image.filename);

    return (
        <div
            className="relative bg-slate-100 aspect-square overflow-hidden"
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
        >
            {isSelected && (
                <div className="absolute top-2 left-2 z-20 bg-blue-500 text-white rounded-full p-0.5 shadow-sm">
                    <Check className="w-3 h-3" />
                </div>
            )}

            {isVideo ? (
                <VideoThumbnail
                    src={buildMediaUrl(item.image.id)}
                    className="w-full h-full object-contain transition-transform group-hover:scale-105"
                    isHovering={isHovering}
                />
            ) : (
                <img
                    src={buildThumbnailUrl(item.image.id)}
                    alt={item.image.filename}
                    className="w-full h-full object-contain transition-transform group-hover:scale-105"
                    loading="lazy"
                    decoding="async"
                    onError={handleImageError}
                />
            )}
        </div>
    );
}

export default function Gallery() {
    const [items, setItems] = useState<GalleryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [activeQuery, setActiveQuery] = useState("");
    const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
    const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [lastSelectedId, setLastSelectedId] = useState<number | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);
    const [cleanupMode, setCleanupMode] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
    const [zoomScale, setZoomScale] = useState(1);
    const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const [hasMore, setHasMore] = useState(true);
    const [nextSkip, setNextSkip] = useState(0);
    const [gridResetKey, setGridResetKey] = useState(0);
    const [moveDialogOpen, setMoveDialogOpen] = useState(false);
    const [moveTargetIds, setMoveTargetIds] = useState<number[]>([]);

    const searchRef = useRef(search);
    const selectedProjectIdRef = useRef(selectedProjectId);
    const selectedFolderRef = useRef(selectedFolder);
    const activeQueryRef = useRef(activeQuery);
    const nextSkipRef = useRef(nextSkip);
    const queryTokenRef = useRef(0);
    const isLoadingRef = useRef(false);
    const isLoadingMoreRef = useRef(false);

    const clickTimeout = useRef<NodeJS.Timeout | null>(null);

    const navigate = useNavigate();
    const addToMediaTray = useMediaTrayStore(useCallback((state) => state.addItems, []));

    // Keep fullscreen index valid when items update
    useEffect(() => {
        if (fullscreenIndex !== null && fullscreenIndex >= items.length) {
            setFullscreenIndex(null);
        }
    }, [items, fullscreenIndex]);

    // Keyboard navigation for fullscreen
    useEffect(() => {
        if (fullscreenIndex === null) return;

        const handleKey = (event: KeyboardEvent) => {
            // Skip if user is typing in an input, textarea, or contenteditable element
            const activeEl = document.activeElement;
            const tagName = activeEl?.tagName?.toLowerCase();
            const isEditable = activeEl?.hasAttribute('contenteditable');
            if (tagName === 'input' || tagName === 'textarea' || isEditable) {
                return;
            }

            if (event.key === "Escape") {
                closeFullscreen();
            } else if (event.key === "ArrowRight") {
                navigateFullscreen(1);
            } else if (event.key === "ArrowLeft") {
                navigateFullscreen(-1);
            }
        };

        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [fullscreenIndex, items.length]);

    // Clear click timeout on unmount
    useEffect(() => {
        return () => {
            if (clickTimeout.current) clearTimeout(clickTimeout.current);
        };
    }, []);

    useEffect(() => {
        searchRef.current = search;
    }, [search]);

    useEffect(() => {
        selectedProjectIdRef.current = selectedProjectId;
    }, [selectedProjectId]);

    const loadGallery = useCallback(async (
        query?: string,
        projectId?: number | null,
        options?: { append?: boolean; loadAll?: boolean; folder?: string | null }
    ) => {
        const append = options?.append ?? false;
        const loadAll = options?.loadAll ?? false;
        const folderValue = options?.folder !== undefined ? options.folder : selectedFolderRef.current;
        const queryValue = append ? activeQueryRef.current : (query ?? searchRef.current);
        const token = append ? queryTokenRef.current : queryTokenRef.current + 1;
        try {
            setError(null);
            if (append) {
                isLoadingMoreRef.current = true;
                setIsLoadingMore(true);
            } else {
                isLoadingRef.current = true;
                setIsLoading(true);
                setActiveQuery(queryValue);
                activeQueryRef.current = queryValue;
                queryTokenRef.current = token;
            }
            const target = projectId !== undefined ? projectId : selectedProjectIdRef.current;
            const unassignedOnly = target === -1;
            const skip = append ? nextSkipRef.current : 0;
            const limit = loadAll ? undefined : PAGE_SIZE;
            const data = await api.getGallery({
                search: queryValue,
                skip,
                limit,
                projectId: unassignedOnly ? null : target,
                folder: folderValue,
                unassignedOnly,
                includeThumbnails: false,
            });
            if (token !== queryTokenRef.current) return;
            setItems((prev) => (append ? [...prev, ...data] : data));
            if (loadAll) {
                setHasMore(false);
                setNextSkip(0);
                nextSkipRef.current = 0;
            } else {
                const received = data.length;
                const pageHasMore = limit !== undefined && received === limit;
                setHasMore(pageHasMore);
                const newSkip = append ? skip + received : received;
                setNextSkip(newSkip);
                nextSkipRef.current = newSkip;
            }
            if (!append) {
                setSelectedIds(new Set());
                setLastSelectedId(null);
                setGridResetKey((prev) => prev + 1);
            }
        } catch (err) {
            console.error(err);
            if (token !== queryTokenRef.current) return;
            setError(err instanceof Error ? err.message : "Failed to load gallery");
        } finally {
            if (append) {
                isLoadingMoreRef.current = false;
                setIsLoadingMore(false);
            } else if (token === queryTokenRef.current) {
                isLoadingRef.current = false;
                setIsLoading(false);
            }
        }
    }, []);

    const fetchProjects = useCallback(async () => {
        try {
            const data = await api.getProjects();
            setProjects(data);
        } catch (err) {
            console.error(err);
        }
    }, []);

    useEffect(() => {
        loadGallery();
        fetchProjects();
    }, [loadGallery, fetchProjects]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        loadGallery(search, selectedProjectId);
    };

    const handleLoadMore = useCallback(() => {
        if (isLoadingRef.current || isLoadingMoreRef.current || !hasMore) return;
        loadGallery(undefined, undefined, { append: true });
    }, [hasMore, loadGallery]);

    const handleRangeChange = useCallback((range: { endIndex: number; total: number; columnCount: number; startIndex: number }) => {
        if (!hasMore || isLoading || isLoadingMore) return;
        if (range.total === 0) return;
        const preload = Math.max(range.columnCount * 2, 12);
        const nearEnd = range.endIndex >= range.total - preload;
        const hasScrolled = range.startIndex > 0 || range.total <= preload;
        if (nearEnd && hasScrolled) {
            handleLoadMore();
        }
    }, [handleLoadMore, hasMore, isLoading, isLoadingMore]);

    // Selection & fullscreen logic
    const handleSelectionToggle = (id: number, e?: React.MouseEvent) => {
        if (e?.shiftKey && lastSelectedId !== null) {
            e.preventDefault();
            const startIdx = items.findIndex(i => i.image.id === lastSelectedId);
            const endIdx = items.findIndex(i => i.image.id === id);

            if (startIdx !== -1 && endIdx !== -1) {
                const low = Math.min(startIdx, endIdx);
                const high = Math.max(startIdx, endIdx);
                const newRange = items.slice(low, high + 1).map(i => i.image.id);
                const newSet = new Set(selectedIds);
                newRange.forEach(rid => newSet.add(rid));
                setSelectedIds(newSet);
                setLastSelectedId(id);
                return;
            }
        }

        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
        setLastSelectedId(id);
    };

    const openFullscreen = (index: number) => {
        if (index < 0 || index >= items.length) return;
        setFullscreenIndex(index);
    };

    const closeFullscreen = () => setFullscreenIndex(null);

    const navigateFullscreen = (direction: 1 | -1) => {
        if (fullscreenIndex === null || items.length === 0) return;
        const nextIndex = (fullscreenIndex + direction + items.length) % items.length;
        setFullscreenIndex(nextIndex);
        // Reset zoom/pan when navigating
        setZoomScale(1);
        setPanPosition({ x: 0, y: 0 });
    };

    // Zoom with wheel
    const handleFullscreenWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.15 : 0.15;
        setZoomScale(prev => Math.max(0.5, Math.min(5, prev + delta)));
    };

    // Pan handlers
    const handlePanStart = (e: React.MouseEvent) => {
        if (zoomScale <= 1) return;
        setIsDragging(true);
        dragStart.current = { x: e.clientX - panPosition.x, y: e.clientY - panPosition.y };
    };

    const handlePanMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        setPanPosition({
            x: e.clientX - dragStart.current.x,
            y: e.clientY - dragStart.current.y
        });
    };

    const handlePanEnd = () => setIsDragging(false);

    // Reset zoom on double-click
    const handleZoomReset = () => {
        setZoomScale(1);
        setPanPosition({ x: 0, y: 0 });
    };

    const handleImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
        const img = event.currentTarget;
        if (img.dataset.fallbackApplied === "true") return;
        img.dataset.fallbackApplied = "true";
        img.src = MISSING_IMAGE_SRC;
    };

    const handleImageInteraction = (item: GalleryItem, e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest("button")) return;

        // Determine whether to select or view
        const shouldSelect = selectionMode || cleanupMode || e.ctrlKey || e.metaKey || e.shiftKey;

        if (shouldSelect) {
            handleSelectionToggle(item.image.id, e);
            return;
        }

        const index = items.findIndex(i => i.image.id === item.image.id);
        openFullscreen(index);
    };

    const handleImageDoubleClick = (item: GalleryItem) => {
        setSelectionMode(true);
        handleSelectionToggle(item.image.id);
    };

    const handleCardClick = (item: GalleryItem, e: React.MouseEvent) => {
        e.persist();
        if (clickTimeout.current) clearTimeout(clickTimeout.current);
        clickTimeout.current = setTimeout(() => {
            handleImageInteraction(item, e);
            clickTimeout.current = null;
        }, 200);
    };

    const handleCardDoubleClick = (item: GalleryItem) => {
        if (clickTimeout.current) {
            clearTimeout(clickTimeout.current);
            clickTimeout.current = null;
        }
        handleImageDoubleClick(item);
    };

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(`Delete ${selectedIds.size} images?`)) return;

        const ids = Array.from(selectedIds);

        try {
            // Prefer single bulk call to avoid hammering the API and DB
            const res = await api.bulkDeleteImages(ids);

            // Update UI for all deleted IDs
            const deletedSet = new Set(ids);
            setItems(prev => prev.filter(i => !deletedSet.has(i.image.id)));
            setSelectedIds(new Set());

            if (res.not_found.length || res.file_errors.length) {
                alert(`Deleted ${res.deleted} images. Skipped ${res.not_found.length} missing. File errors: ${res.file_errors.length}.`);
            }
        } catch (e) {
            console.error("Bulk delete failed, retrying sequentially", e);
            // Fallback: delete sequentially to reduce concurrent load
            let failed = 0;
            for (const id of ids) {
                try {
                    await api.deleteImage(id);
                } catch {
                    failed += 1;
                }
            }
            const deletedSet = new Set(ids);
            setItems(prev => prev.filter(i => !deletedSet.has(i.image.id)));
            setSelectedIds(new Set());

            if (failed > 0) alert(`Failed to delete ${failed} images`);
        }
    };

    const handleCleanupStart = () => {
        setCleanupMode(true);
        setSelectedIds(new Set());
        setLastSelectedId(null);
        setSelectionMode(true);
        loadGallery(search, selectedProjectId, { loadAll: true });
    };

    const handleCleanupStop = () => {
        setCleanupMode(false);
        loadGallery(search, selectedProjectId);
    };

    const handleCleanupPurge = async () => {
        const deleteCandidates = items.filter(item => !selectedIds.has(item.image.id));
        const deleteCount = deleteCandidates.length;
        const keepCount = selectedIds.size;
        const confirmed = confirm(`Clean up the gallery by deleting ${deleteCount} images and keeping ${keepCount}?`);
        if (!confirmed) return;

        try {
            const keepIds = Array.from(selectedIds);
            const result = await api.cleanupGallery({
                projectId: selectedProjectId,
                folder: selectedFolder,
                keepImageIds: keepIds,
            });

            setCleanupMode(false);
            setSelectedIds(new Set());
            setLastSelectedId(null);
            loadGallery(search, selectedProjectId);

            console.log(`Cleanup complete: ${result.count} images deleted, ${result.files_deleted} files removed`);
        } catch (err) {
            console.error(err);
            alert("Failed to clean up gallery: " + (err instanceof Error ? err.message : "Unknown error"));
        }
    };

    const handleSelectProject = (id: number | null) => {
        selectedProjectIdRef.current = id;
        setSelectedProjectId(id);
        setSelectedFolder(null); // Reset folder when project changes
        loadGallery(search, id, { loadAll: cleanupMode });
    };

    const handleSelectFolder = (folder: string | null) => {
        selectedFolderRef.current = folder;
        setSelectedFolder(folder);
        // Reload with new folder filter (server-side filtering)
        loadGallery(search, selectedProjectId, { loadAll: cleanupMode, folder });
    };

    // Get folders for the selected project
    const selectedProject = selectedProjectId ? projects.find(p => p.id === selectedProjectId) : null;
    const projectFolders = selectedProject?.config_json?.folders || [];

    const handleDelete = async (id: number) => {
        if (!confirm("Are you sure you want to delete this image?")) return;

        // Find index before async operation/state updates
        const deletedIndex = items.findIndex(i => i.image.id === id);

        try {
            await api.deleteImage(id);

            // Calculate new items
            const newItems = items.filter((item) => item.image.id !== id);
            setItems(newItems);

            // Update selection
            setSelectedIds((prev) => {
                if (!prev.has(id)) return prev;
                const next = new Set(prev);
                next.delete(id);
                return next;
            });

            // Update Fullscreen Index logic
            if (fullscreenIndex !== null && deletedIndex !== -1) {
                if (deletedIndex < fullscreenIndex) {
                    // Item before current was deleted, shift left to maintain view
                    setFullscreenIndex(fullscreenIndex - 1);
                } else if (deletedIndex === fullscreenIndex) {
                    // Current item deleted
                    if (newItems.length === 0) {
                        setFullscreenIndex(null);
                    } else if (fullscreenIndex >= newItems.length) {
                        // Was last item, go to new last item
                        setFullscreenIndex(newItems.length - 1);
                    } else {
                        // Was not last item, index stays same (points to next item)
                        setFullscreenIndex(fullscreenIndex);
                    }
                }
            }
        } catch (err) {
            console.error("Delete error:", err);
            alert("Failed to delete image");
        }
    };

    const handleDownload = async (item: GalleryItem) => {
        try {
            const url = `${IMAGE_API_BASE}/gallery/image/${item.image.id}`;
            const res = await fetch(url);
            const blob = await res.blob();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = item.image.filename || `image_${item.image.id}`;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (e) {
            console.error("Download failed", e);
            alert("Failed to download image");
        }
    };

    const handleBulkDownload = async () => {
        if (selectedIds.size === 0) return;

        try {
            const blob = await api.downloadImages(Array.from(selectedIds));
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            // Check content type to determine filename
            const isZip = blob.type === "application/zip";
            a.download = isZip ? `gallery_export_${Date.now()}.zip` : `image_${Date.now()}`;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (e) {
            console.error("Bulk download failed", e);
            alert("Failed to download images");
        }
    };

    const handleAddSelectedToTray = useCallback(() => {
        if (selectedIds.size === 0) return;
        const toAdd = items
            .filter((item) => selectedIds.has(item.image.id))
            .map((item) => ({ path: item.image.path, filename: item.image.filename }));
        if (toAdd.length === 0) return;
        addToMediaTray(toAdd);
    }, [addToMediaTray, items, selectedIds]);

    const handleRegenerate = (item: GalleryItem) => {
        navigate("/", { state: { loadParams: item, isRegenerate: true } });
    };

    const cleanupDeleteCount = Math.max(items.length - selectedIds.size, 0);

    // Items are now filtered server-side via folder parameter
    const displayItems = items;

    const fullscreenItem = fullscreenIndex !== null ? displayItems[fullscreenIndex] : null;

    // Note: We no longer return early for loading - this keeps the sidebar visible for smoother transitions

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            <ProjectSidebar
                selectedProjectId={selectedProjectId}
                onSelectProject={handleSelectProject}
                projects={projects}
                className="h-full border-r border-border bg-card"
                selectedFolder={selectedFolder}
                onSelectFolder={handleSelectFolder}
                projectFolders={projectFolders}
            />
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between px-8 py-4 border-b border-border bg-background">
                    <div className="flex items-center gap-4 flex-wrap">
                        <h1 className="text-3xl font-bold tracking-tight">gallery</h1>
                        <div className="text-sm text-muted-foreground bg-muted/40 border border-border px-3 py-1 rounded-full whitespace-nowrap">
                            viewing {selectedProjectId ? projects.find(p => p.id === selectedProjectId)?.name || "project" : "all projects"}
                            {selectedFolder && ` / ${selectedFolder}`}
                        </div>

                        {selectedIds.size > 0 && (
                            <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm font-medium border border-blue-100 animate-in fade-in slide-in-from-left-4 whitespace-nowrap flex-shrink-0">
                                <Check className="w-4 h-4 flex-shrink-0" />
                                {cleanupMode ? `${selectedIds.size} to keep` : `${selectedIds.size} selected`}
                                <div className="h-4 w-px bg-blue-200 mx-1 flex-shrink-0" />
                                {!cleanupMode && (
                                    <>
                                        <button onClick={handleBulkDownload} className="hover:underline text-blue-600 flex items-center gap-1">
                                            <Download className="w-3 h-3" />
                                            download
                                        </button>
                                        <div className="h-4 w-px bg-blue-200 flex-shrink-0" />
                                        <button onClick={() => { setMoveTargetIds(Array.from(selectedIds)); setMoveDialogOpen(true); }} className="hover:underline text-blue-600 flex items-center gap-1">
                                            <FolderInput className="w-3 h-3" />
                                            move
                                        </button>
                                        <div className="h-4 w-px bg-blue-200 flex-shrink-0" />
                                        <button onClick={handleAddSelectedToTray} className="hover:underline text-blue-600 flex items-center gap-1">
                                            <Plus className="w-3 h-3" />
                                            add to tray
                                        </button>
                                        <div className="h-4 w-px bg-blue-200 flex-shrink-0" />
                                        <button onClick={handleBulkDelete} className="hover:underline text-red-600">delete</button>
                                    </>
                                )}
                                <button onClick={() => setSelectedIds(new Set())} className="hover:underline text-muted-foreground">clear</button>
                            </div>
                        )}
                    </div>
                    <div className="w-full md:max-w-2xl flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
                        <form onSubmit={handleSearch} className="flex-1">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    type="search"
                                    placeholder="search prompts, tags, captions..."
                                    className="pl-9"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                        </form>
                        <div className="flex items-center gap-2">
                            <Button variant={selectionMode ? "default" : "outline"} onClick={() => setSelectionMode(!selectionMode)}>
                                {selectionMode ? "selection mode on" : "selection mode off"}
                            </Button>
                            <Button variant={cleanupMode ? "secondary" : "outline"} onClick={cleanupMode ? handleCleanupStop : handleCleanupStart}>
                                {cleanupMode ? "done selecting" : "gallery cleanup"}
                            </Button>
                            {cleanupMode && (
                                <Button variant="destructive" onClick={handleCleanupPurge} disabled={items.length === 0}>
                                    clean up gallery
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex-1 min-h-0 px-8 pb-8 flex flex-col gap-4">
                    {cleanupMode && (
                        <Alert>
                            <AlertTitle>cleanup mode</AlertTitle>
                            <AlertDescription>
                                Select every image you want to keep (Ctrl/Cmd, Shift, and Ctrl+Shift all work). When you clean up, {cleanupDeleteCount} images will be removed.
                            </AlertDescription>
                        </Alert>
                    )}

                    {error && (
                        <Alert variant="destructive">
                            <AlertTitle>Error</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                    <div className="relative flex-1 min-h-0">
                        {isLoading && displayItems.length > 0 && (
                            <div className="absolute inset-0 bg-background/60 flex items-center justify-center z-10 pointer-events-none">
                                <div className="text-sm text-muted-foreground bg-card/90 px-4 py-2 rounded-full shadow-sm border border-border">
                                    Loading...
                                </div>
                            </div>
                        )}

                        <VirtualGrid
                            items={displayItems}
                            columnCount={MAX_COLUMN_COUNT}
                            minColumnWidth={MIN_COLUMN_WIDTH}
                            maxColumnCount={MAX_COLUMN_COUNT}
                            rowHeight={(columnWidth) => Math.round(columnWidth + CARD_META_HEIGHT)}
                            gap={GRID_GAP}
                            padding={GRID_PADDING}
                            overscan={4}
                            className="h-full"
                            scrollToTopKey={gridResetKey}
                            getKey={(item) => item.image.id}
                            onRangeChange={handleRangeChange}
                            emptyState={(
                                <div className="text-center text-muted-foreground py-20">
                                    {isLoading
                                        ? "Loading gallery..."
                                        : selectedFolder
                                            ? `No images in folder "${selectedFolder}"`
                                            : "No images generated yet. Go to New Generation to create some!"}
                                </div>
                            )}
                            renderItem={(item) => (
                                <ContextMenu>
                                    <ContextMenuTrigger>
                                        <Card
                                            className={cn(
                                                "group overflow-hidden flex flex-col relative transition-all duration-200 select-none h-full",
                                                selectedIds.has(item.image.id) ? "ring-2 ring-blue-500 shadow-lg scale-[0.98] bg-blue-50/50" : ""
                                            )}
                                            onClick={(e) => handleCardClick(item, e)}
                                            onDoubleClick={() => handleCardDoubleClick(item)}
                                        >
                                            <GalleryCardContent
                                                item={item}
                                                isSelected={selectedIds.has(item.image.id)}
                                                handleImageError={handleImageError}
                                            />
                                            <div className="absolute inset-x-0 top-0 aspect-square flex items-center justify-center pointer-events-none">
                                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                                    <Button
                                                        className="pointer-events-auto"
                                                        variant="secondary"
                                                        size="icon"
                                                        onClick={(e) => { e.stopPropagation(); handleDownload(item); }}
                                                        title="Download"
                                                    >
                                                        <Download className="w-4 h-4" />
                                                    </Button>

                                                    <Button
                                                        className="pointer-events-auto"
                                                        variant="secondary"
                                                        size="icon"
                                                        onClick={(e) => { e.stopPropagation(); handleRegenerate(item); }}
                                                        title="Regenerate"
                                                    >
                                                        <RotateCcw className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        className="pointer-events-auto"
                                                        variant="destructive"
                                                        size="icon"
                                                        onClick={(e) => { e.stopPropagation(); handleDelete(item.image.id); }}
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </div>

                                            <CardContent
                                                className="p-4 text-xs space-y-2 bg-card flex-1 relative z-10 overflow-hidden"
                                                style={{ minHeight: CARD_META_HEIGHT - 40 }}
                                                onClick={() => { }}
                                            >
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {item.workflow_name && (
                                                        <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 border border-purple-100 rounded text-[10px] font-medium">
                                                            {item.workflow_name}
                                                        </span>
                                                    )}
                                                    {item.width && item.height && (
                                                        <span className="px-1.5 py-0.5 bg-muted/40 text-muted-foreground border border-border rounded text-[10px]">
                                                            {item.width}A-{item.height}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2 text-muted-foreground">
                                                    <Calendar className="w-3 h-3" />
                                                    <span>{new Date(item.created_at).toLocaleString()}</span>
                                                </div>

                                                {item.caption && (
                                                    <p className="text-muted-foreground line-clamp-2">{item.caption}</p>
                                                )}

                                                {item.prompt_tags && item.prompt_tags.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {item.prompt_tags.slice(0, 6).map((tag) => (
                                                            <span key={tag} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded">#{tag}</span>
                                                        ))}
                                                    </div>
                                                )}

                                                {(() => {
                                                    const { positive, negative } = resolvePromptsForGalleryItem({
                                                        prompt: item.prompt,
                                                        negative_prompt: item.negative_prompt,
                                                        job_params: item.job_params,
                                                    });
                                                    return (
                                                        <div className="mt-2 space-y-2">
                                                            {positive && (
                                                                <div className="group/prompt">
                                                                    <div className="flex items-center justify-between mb-1">
                                                                        <span className="font-semibold text-green-600 block text-[10px] uppercase">Positive</span>
                                                                        <Button variant="ghost" size="icon" className="h-4 w-4 opacity-0 group-hover/prompt:opacity-100" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(positive); }}>
                                                                            <Copy className="h-3 w-3 text-muted-foreground" />
                                                                        </Button>
                                                                    </div>
                                                                    <HoverCard openDelay={200}>
                                                                        <HoverCardTrigger asChild>
                                                                            <p className="line-clamp-6 text-foreground/80 leading-relaxed cursor-help select-text">{positive}</p>
                                                                        </HoverCardTrigger>
                                                                        <HoverCardContent className="w-[500px] max-h-[60vh] overflow-y-auto p-4 z-[100]" align="start">
                                                                            <div className="space-y-4">
                                                                                <div>
                                                                                    <div className="flex items-center gap-2 mb-1">
                                                                                        <span className="font-semibold text-green-600 text-xs uppercase">Positive Prompt</span>
                                                                                    </div>
                                                                                    <p className="text-sm text-foreground/80 whitespace-pre-wrap font-mono text-[11px] leading-relaxed select-text">{positive}</p>
                                                                                </div>
                                                                                {negative && (
                                                                                    <div className="border-t pt-3">
                                                                                        <div className="flex items-center gap-2 mb-1">
                                                                                            <span className="font-semibold text-red-500 text-xs uppercase">Negative Prompt</span>
                                                                                        </div>
                                                                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap font-mono text-[11px] leading-relaxed select-text">{negative}</p>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </HoverCardContent>
                                                                    </HoverCard>
                                                                </div>
                                                            )}
                                                            {!positive && !negative && (
                                                                <div className="flex flex-wrap gap-1 mt-2">
                                                                    {Object.entries(item.job_params).slice(0, 4).map(([k, v]) => (
                                                                        <span key={k} className="px-1.5 py-0.5 bg-muted/40 rounded text-muted-foreground border border-border">{k}: {String(v)}</span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
                                            </CardContent>
                                        </Card>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent>
                                        <ContextMenuItem onSelect={() => handleDownload(item)}>download</ContextMenuItem>
                                        <ContextMenuItem onSelect={() => handleRegenerate(item)}>regenerate</ContextMenuItem>
                                        <ContextMenuItem onSelect={() => addToMediaTray({ path: item.image.path, filename: item.image.filename })}>add to media tray</ContextMenuItem>
                                        <ContextMenuItem onSelect={() => { setMoveTargetIds([item.image.id]); setMoveDialogOpen(true); }}>move</ContextMenuItem>
                                        <ContextMenuSeparator />
                                        <ContextMenuItem className="text-red-600" onSelect={() => handleDelete(item.image.id)}>delete</ContextMenuItem>
                                    </ContextMenuContent>
                                </ContextMenu>
                            )}
                        />

                        {isLoadingMore && (
                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-muted-foreground bg-card/90 px-3 py-1 rounded-full border border-border shadow-sm">
                                Loading more...
                            </div>
                        )}
                    </div>

                </div>
            </div>
            {
                fullscreenItem && (
                    <div
                        className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-6 text-white"
                        onWheel={handleFullscreenWheel}
                        onMouseMove={handlePanMove}
                        onMouseUp={handlePanEnd}
                        onMouseLeave={handlePanEnd}
                    >
                        <button
                            className="absolute top-4 right-4 rounded-full bg-white/10 hover:bg-white/20 transition p-2"
                            onClick={closeFullscreen}
                            aria-label="Close fullscreen"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        {/* Zoom indicator */}
                        {zoomScale !== 1 && (
                            <div className="absolute top-4 left-4 bg-white/10 rounded-full px-3 py-1 text-sm">
                                {Math.round(zoomScale * 100)}%
                                <button className="ml-2 text-xs underline" onClick={handleZoomReset}>reset</button>
                            </div>
                        )}

                        <button
                            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/20 p-3"
                            onClick={() => navigateFullscreen(-1)}
                            aria-label="Previous image"
                        >
                            <ChevronLeft className="w-6 h-6" />
                        </button>
                        <button
                            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/20 p-3"
                            onClick={() => navigateFullscreen(1)}
                            aria-label="Next image"
                        >
                            <ChevronRight className="w-6 h-6" />
                        </button>

                        <div className="max-w-6xl w-full flex flex-col items-center gap-4">
                            <div
                                className="relative w-full flex items-center justify-center overflow-hidden"
                                style={{ cursor: zoomScale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in' }}
                                onMouseDown={handlePanStart}
                                onDoubleClick={handleZoomReset}
                            >
                                {selectedIds.has(fullscreenItem.image.id) && (
                                    <div className="absolute top-3 left-3 z-10 bg-blue-500 text-white rounded-full p-1 shadow-sm flex items-center gap-1 text-xs">
                                        <Check className="w-3 h-3" /> Selected
                                    </div>
                                )}
                                {isVideoFile(fullscreenItem.image.path, fullscreenItem.image.filename) ? (
                                    <video
                                        src={`${IMAGE_API_BASE}/gallery/image/${fullscreenItem.image.id}`}
                                        className="max-h-[80vh] w-auto object-contain rounded-lg shadow-2xl transition-transform select-none"
                                        style={{
                                            transform: `scale(${zoomScale}) translate(${panPosition.x / zoomScale}px, ${panPosition.y / zoomScale}px)`,
                                            transformOrigin: 'center center'
                                        }}
                                        controls
                                        preload="metadata"
                                        playsInline
                                        draggable={false}
                                    />
                                ) : (
                                    <img
                                        src={`${IMAGE_API_BASE}/gallery/image/${fullscreenItem.image.id}`}
                                        alt={fullscreenItem.image.filename}
                                        className="max-h-[80vh] w-auto object-contain rounded-lg shadow-2xl transition-transform select-none"
                                        style={{
                                            transform: `scale(${zoomScale}) translate(${panPosition.x / zoomScale}px, ${panPosition.y / zoomScale}px)`,
                                            transformOrigin: 'center center'
                                        }}
                                        draggable={false}
                                    />
                                )}
                            </div>
                            <div className="bg-white/5 rounded-lg px-4 py-2 text-sm w-full flex items-center justify-between">
                                <div className="flex items-center gap-2 text-slate-100">
                                    <span className="font-semibold">{fullscreenItem.prompt_name || fullscreenItem.image.filename}</span>
                                    <span className="text-xs text-slate-300">{new Date(fullscreenItem.created_at).toLocaleString()}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => handleRegenerate(fullscreenItem)}
                                            className="gap-1.5"
                                        >
                                            <RotateCcw className="w-3.5 h-3.5" />
                                            Regenerate
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => handleDownload(fullscreenItem)}
                                            className="gap-1.5"
                                        >
                                            <Download className="w-3.5 h-3.5" />
                                            Download
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={() => {
                                                handleDelete(fullscreenItem.image.id);
                                                // closeFullscreen(); // Don't close, let handleDelete handle navigation
                                            }}
                                            className="gap-1.5"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            Delete
                                        </Button>
                                    </div>
                                    <div className="text-xs text-slate-200">Scroll to zoom, drag to pan. ← → arrows navigate. ESC closes.</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Move Images Dialog */}
            <MoveImagesDialog
                open={moveDialogOpen}
                onOpenChange={setMoveDialogOpen}
                selectedImageIds={moveTargetIds}
                projects={projects}
                currentProjectId={selectedProjectId}
                onMoveComplete={() => {
                    setSelectedIds(new Set());
                    setSelectionMode(false);
                    loadGallery(search, selectedProjectId);
                }}
            />
        </div >
    );
}
