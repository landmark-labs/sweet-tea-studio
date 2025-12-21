import { useEffect, useRef, useState } from "react";
import { api, GalleryItem, Project } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Save, Trash2, Calendar, Search, RotateCcw, Copy, Check, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ProjectSidebar } from "@/components/ProjectSidebar";

const MISSING_IMAGE_SRC =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNDAwIiB2aWV3Qm94PSIwIDAgNDAwIDQwMCI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iI2UyZThmMCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjOTRhM2I4IiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjQiPk1pc3NpbmcgRmlsZTwvdGV4dD48L3N2Zz4=";

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

    const PAGE_SIZE = 120;
    const [hasMore, setHasMore] = useState(true);

    const clickTimeout = useRef<NodeJS.Timeout | null>(null);

    const navigate = useNavigate();

    useEffect(() => {
        loadGallery();
        fetchProjects();
    }, []);

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

    const loadGallery = async (
        query?: string,
        projectId?: number | null,
        options?: { append?: boolean; loadAll?: boolean }
    ) => {
        const append = options?.append ?? false;
        const loadAll = options?.loadAll ?? false;
        const queryValue = append ? activeQuery : (query ?? search);
        try {
            setError(null);
            if (append) {
                setIsLoadingMore(true);
            } else {
                setIsLoading(true);
                setActiveQuery(queryValue);
            }
            const target = projectId !== undefined ? projectId : selectedProjectId;
            const unassignedOnly = target === -1;
            const skip = append ? items.length : 0;
            const data = await api.getGallery({
                search: queryValue,
                skip,
                limit: loadAll ? undefined : PAGE_SIZE,
                projectId: unassignedOnly ? null : target,
                unassignedOnly,
                includeThumbnails: false,
            });
            setItems((prev) => (append ? [...prev, ...data] : data));
            if (loadAll) {
                setHasMore(false);
            } else {
                setHasMore(data.length === PAGE_SIZE);
            }
            if (!append) {
                setSelectedIds(new Set());
                setLastSelectedId(null);
            }
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : "Failed to load gallery");
        } finally {
            if (append) {
                setIsLoadingMore(false);
            } else {
                setIsLoading(false);
            }
        }
    };

    const fetchProjects = async () => {
        try {
            const data = await api.getProjects();
            setProjects(data);
        } catch (err) {
            console.error(err);
        }
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        loadGallery(search, selectedProjectId);
    };

    const handleLoadMore = () => {
        if (isLoadingMore || !hasMore) return;
        loadGallery(search, selectedProjectId, { append: true });
    };

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

        if (deleteCount === 0) {
            alert("Select at least one image to keep before cleaning up.");
            return;
        }

        const keepCount = selectedIds.size;
        const confirmed = confirm(`Clean up the gallery by deleting ${deleteCount} images and keeping ${keepCount}?`);
        if (!confirmed) return;

        try {
            // Step 1: Mark selected images as "kept"
            const keepIds = Array.from(selectedIds);
            await api.keepImages(keepIds, true);

            // Step 2: Call cleanup which deletes all non-kept images in one server-side transaction
            const result = await api.cleanupGallery();

            // Step 3: Update local state - keep only the images that were marked as kept
            setItems(items.filter((item) => selectedIds.has(item.image.id)));
            setCleanupMode(false);
            setSelectedIds(new Set());
            setLastSelectedId(null);

            console.log(`Cleanup complete: ${result.count} images deleted, ${result.files_deleted} files removed`);
        } catch (err) {
            console.error(err);
            alert("Failed to clean up gallery: " + (err instanceof Error ? err.message : "Unknown error"));
        }
    };

    const handleSelectProject = (id: number | null) => {
        setSelectedProjectId(id);
        setSelectedFolder(null); // Reset folder when project changes
        loadGallery(search, id, { loadAll: cleanupMode });
    };

    const handleSelectFolder = (folder: string | null) => {
        setSelectedFolder(folder);
        // Folder filtering now happens client-side via displayItems
    };

    // Get folders for the selected project
    const selectedProject = selectedProjectId ? projects.find(p => p.id === selectedProjectId) : null;
    const projectFolders = selectedProject?.config_json?.folders || [];

    const handleDelete = async (id: number) => {
        if (!confirm("Are you sure you want to delete this image?")) return;
        try {
            await api.deleteImage(id);
            setItems((prev) => prev.filter((item) => item.image.id !== id));
            setSelectedIds((prev) => {
                if (!prev.has(id)) return prev;
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        } catch (err) {
            alert("Failed to delete image");
        }
    };

    const handleSavePrompt = async (item: GalleryItem) => {
        const name = prompt("Enter a name for this prompt preset:");
        if (!name) return;

        const workflowId = item.workflow_template_id || 1;
        const tags = (item.prompt || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);

        try {
            await api.savePrompt({
                workflow_id: workflowId,
                name: name,
                description: `Saved from Gallery Image #${item.image.id}`,
                parameters: item.job_params,
                preview_image_path: item.image.path,
                positive_text: item.job_params?.prompt,
                negative_text: item.job_params?.negative_prompt,
                tags,
            });
            alert("Prompt saved to library!");
        } catch (err) {
            alert("Failed to save prompt");
        }
    };

    const handleRegenerate = (item: GalleryItem) => {
        navigate("/", { state: { loadParams: item } });
    };

    // Helper to extract relevant prompts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getPrompts = (params: any) => {
        let positive = "";
        let negative = "";

        const paramsArray = Object.entries(params || {});

        // Pass 1: explicit keys
        paramsArray.forEach(([key, value]) => {
            const lowerKey = key.toLowerCase();
            const valStr = String(value);

            if (lowerKey.includes("positive") || lowerKey === "prompt" || lowerKey === "text_g") {
                if (valStr.length > positive.length) positive = valStr;
            } else if (lowerKey.includes("negative")) {
                if (valStr.length > negative.length) negative = valStr;
            }
        });

        // Pass 2: ComfyUI convention (CLIPTextEncode) if we still don't have labeled prompts
        if (!positive && !negative) {
            paramsArray.forEach(([key, value]) => {
                const lowerKey = key.toLowerCase();
                if (lowerKey.includes("cliptextencode") && lowerKey.includes("text")) {
                    const valStr = String(value);
                    if (lowerKey.includes("_2") || lowerKey.includes("negative")) {
                        negative = valStr;
                    } else {
                        positive = valStr;
                    }
                }
            });
        }

        return { positive, negative };
    };

    const cleanupDeleteCount = Math.max(items.length - selectedIds.size, 0);

    // Filter items by selected folder - match folder name in image path
    const displayItems = selectedFolder
        ? items.filter(item => {
            const path = item.image.path || '';
            // Check if the path contains the folder name as a directory segment
            const pathSegments = path.replace(/\\/g, '/').split('/');

            // Fix: Check parent directory specifically to avoid partial matches
            if (pathSegments.length < 2) return false;
            const parentFolder = pathSegments[pathSegments.length - 2];
            return parentFolder.toLowerCase() === selectedFolder.toLowerCase();
        })
        : items;

    const fullscreenItem = fullscreenIndex !== null ? displayItems[fullscreenIndex] : null;

    // Note: We no longer return early for loading - this keeps the sidebar visible for smoother transitions

    return (
        <div className="flex h-screen overflow-hidden bg-slate-50">
            <ProjectSidebar
                selectedProjectId={selectedProjectId}
                onSelectProject={handleSelectProject}
                projects={projects}
                className="h-full border-r bg-white"
                selectedFolder={selectedFolder}
                onSelectFolder={handleSelectFolder}
                projectFolders={projectFolders}
            />
            <div className="flex-1 overflow-auto relative">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6 sticky top-0 z-20 bg-slate-50 px-8 py-4">
                    <div className="flex items-center gap-4 flex-wrap">
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">gallery</h1>
                        <div className="text-sm text-slate-600 bg-slate-100 border border-slate-200 px-3 py-1 rounded-full whitespace-nowrap">
                            viewing {selectedProjectId ? projects.find(p => p.id === selectedProjectId)?.name || "project" : "all projects"}
                            {selectedFolder && ` / ${selectedFolder}`}
                        </div>

                        {selectedIds.size > 0 && (
                            <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm font-medium border border-blue-100 animate-in fade-in slide-in-from-left-4 whitespace-nowrap flex-shrink-0">
                                <Check className="w-4 h-4 flex-shrink-0" />
                                {cleanupMode ? `${selectedIds.size} to keep` : `${selectedIds.size} selected`}
                                <div className="h-4 w-px bg-blue-200 mx-1 flex-shrink-0" />
                                {!cleanupMode && (
                                    <button onClick={handleBulkDelete} className="hover:underline text-red-600">delete</button>
                                )}
                                <button onClick={() => setSelectedIds(new Set())} className="hover:underline text-slate-500">clear</button>
                            </div>
                        )}
                    </div>
                    <div className="w-full md:max-w-2xl flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
                        <form onSubmit={handleSearch} className="flex-1">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
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

                <div className="px-8 pb-8">
                    {cleanupMode && (
                        <Alert className="mb-4">
                            <AlertTitle>cleanup mode</AlertTitle>
                            <AlertDescription>
                                Select every image you want to keep (Ctrl/Cmd, Shift, and Ctrl+Shift all work). When you clean up, {cleanupDeleteCount} images will be removed.
                            </AlertDescription>
                        </Alert>
                    )}

                    {error && (
                        <Alert variant="destructive" className="mb-6">
                            <AlertTitle>Error</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {/* Subtle loading overlay - keeps existing content visible */}
                    {isLoading && displayItems.length > 0 && (
                        <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10 pointer-events-none">
                            <div className="text-sm text-slate-500 bg-white/90 px-4 py-2 rounded-full shadow-sm border">
                                Loading...
                            </div>
                        </div>
                    )}

                    {displayItems.length === 0 && isLoading ? (
                        <div className="text-center text-slate-500 py-20">
                            Loading gallery...
                        </div>
                    ) : displayItems.length === 0 ? (
                        <div className="text-center text-slate-500 py-20">
                            {selectedFolder ? `No images in folder "${selectedFolder}"` : "No images generated yet. Go to New Generation to create some!"}
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                {displayItems.map((item) => (
                                    <ContextMenu key={item.image.id}>
                                        <ContextMenuTrigger>
                                            <Card
                                                className={cn(
                                                    "group overflow-hidden flex flex-col relative transition-all duration-200 select-none",
                                                    selectedIds.has(item.image.id) ? "ring-2 ring-blue-500 shadow-lg scale-[0.98] bg-blue-50/50" : ""
                                                )}
                                                onClick={(e) => handleCardClick(item, e)}
                                                onDoubleClick={() => handleCardDoubleClick(item)}
                                            >
                                                <div className="relative aspect-square bg-slate-100">
                                                    {/* Selection Overlay Checkbox */}
                                                    {selectedIds.has(item.image.id) && (
                                                        <div className="absolute top-2 left-2 z-20 bg-blue-500 text-white rounded-full p-0.5 shadow-sm">
                                                            <Check className="w-3 h-3" />
                                                        </div>
                                                    )}

                                                    <img
                                                        src={`/api/v1/gallery/image/${item.image.id}`}
                                                        alt={item.image.filename}
                                                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                                        loading="lazy"
                                                        decoding="async"
                                                        onError={handleImageError}
                                                    />

                                                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                                        {/* Keep existing overlay buttons but make them stop propagation so they don't trigger select */}
                                                        <Button
                                                            variant="secondary"
                                                            size="icon"
                                                            onClick={(e) => { e.stopPropagation(); handleSavePrompt(item); }}
                                                            title="Save Prompt to Library"
                                                        >
                                                            <Save className="w-4 h-4" />
                                                        </Button>


                                                        <Button
                                                            variant="secondary"
                                                            size="icon"
                                                            onClick={(e) => { e.stopPropagation(); handleRegenerate(item); }}
                                                            title="Regenerate"
                                                        >
                                                            <RotateCcw className="w-4 h-4" />
                                                        </Button>
                                                        <Button
                                                            variant="destructive"
                                                            size="icon"
                                                            onClick={(e) => { e.stopPropagation(); handleDelete(item.image.id); }}
                                                            title="Delete"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </div>

                                                <CardContent className="p-4 text-xs space-y-2 bg-white flex-1 relative z-10" onClick={(e) => {
                                                    // Ensure text selection works, but Card click (parent) handles row selection
                                                    // Stop prop if clicking buttons
                                                }}>
                                                    {/* Existing Content Preserved */}
                                                    <div className="flex items-center gap-2 text-slate-500">
                                                        <Calendar className="w-3 h-3" />
                                                        <span>{new Date(item.created_at).toLocaleString()}</span>
                                                    </div>



                                                    {item.caption && (
                                                        <p className="text-slate-600 line-clamp-2">{item.caption}</p>
                                                    )}

                                                    {item.prompt_tags && item.prompt_tags.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {item.prompt_tags.slice(0, 6).map((tag) => (
                                                                <span key={tag} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded">#{tag}</span>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {(() => {
                                                        const { positive, negative } = getPrompts(item.job_params);
                                                        return (
                                                            <div className="mt-2 space-y-2">
                                                                {positive && (
                                                                    <div className="group/prompt">
                                                                        <div className="flex items-center justify-between mb-1">
                                                                            <span className="font-semibold text-green-600 block text-[10px] uppercase">Positive</span>
                                                                            <Button variant="ghost" size="icon" className="h-4 w-4 opacity-0 group-hover/prompt:opacity-100" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(positive); }}>
                                                                                <Copy className="h-3 w-3 text-slate-400" />
                                                                            </Button>
                                                                        </div>
                                                                        <HoverCard openDelay={200}>
                                                                            <HoverCardTrigger asChild>
                                                                                <p className="line-clamp-3 text-slate-700 leading-relaxed cursor-help select-text">{positive}</p>
                                                                            </HoverCardTrigger>
                                                                            <HoverCardContent className="w-[500px] max-h-[60vh] overflow-y-auto p-4 z-[100]" align="start">
                                                                                <div className="space-y-4">
                                                                                    <div>
                                                                                        <div className="flex items-center gap-2 mb-1">
                                                                                            <span className="font-semibold text-green-600 text-xs uppercase">Positive Prompt</span>
                                                                                        </div>
                                                                                        <p className="text-sm text-slate-700 whitespace-pre-wrap font-mono text-[11px] leading-relaxed select-text">{positive}</p>
                                                                                    </div>
                                                                                    {negative && (
                                                                                        <div className="border-t pt-3">
                                                                                            <div className="flex items-center gap-2 mb-1">
                                                                                                <span className="font-semibold text-red-500 text-xs uppercase">Negative Prompt</span>
                                                                                            </div>
                                                                                            <p className="text-sm text-slate-600 whitespace-pre-wrap font-mono text-[11px] leading-relaxed select-text">{negative}</p>
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
                                                                            <span key={k} className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500 border border-slate-200">{k}: {String(v)}</span>
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
                                            <ContextMenuItem onSelect={() => handleRegenerate(item)}>regenerate</ContextMenuItem>
                                            <ContextMenuItem onSelect={() => handleSavePrompt(item)}>save prompt</ContextMenuItem>
                                            <ContextMenuSeparator />
                                            <ContextMenuItem className="text-red-600" onSelect={() => handleDelete(item.image.id)}>delete</ContextMenuItem>
                                        </ContextMenuContent>
                                    </ContextMenu>
                                ))}
                            </div>
                            {!cleanupMode && hasMore && (
                                <div className="flex justify-center pt-6">
                                    <Button variant="outline" onClick={handleLoadMore} disabled={isLoadingMore}>
                                        {isLoadingMore ? "Loading..." : "Load more"}
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
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
                                <img
                                    src={`/api/v1/gallery/image/${fullscreenItem.image.id}`}
                                    alt={fullscreenItem.image.filename}
                                    className="max-h-[80vh] w-auto object-contain rounded-lg shadow-2xl transition-transform select-none"
                                    style={{
                                        transform: `scale(${zoomScale}) translate(${panPosition.x / zoomScale}px, ${panPosition.y / zoomScale}px)`,
                                        transformOrigin: 'center center'
                                    }}
                                    draggable={false}
                                />
                            </div>
                            <div className="bg-white/5 rounded-lg px-4 py-2 text-sm w-full flex items-center justify-between">
                                <div className="flex items-center gap-2 text-slate-100">
                                    <span className="font-semibold">{fullscreenItem.prompt_name || fullscreenItem.image.filename}</span>
                                    <span className="text-xs text-slate-300">{new Date(fullscreenItem.created_at).toLocaleString()}</span>
                                </div>
                                <div className="text-xs text-slate-200">Scroll to zoom, drag to pan. ← → arrows navigate. ESC closes.</div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}
