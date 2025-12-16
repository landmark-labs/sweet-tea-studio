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

export default function Gallery() {
    const [items, setItems] = useState<GalleryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
    const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [lastSelectedId, setLastSelectedId] = useState<number | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);
    const [cleanupMode, setCleanupMode] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
    const [folderImages, setFolderImages] = useState<{ path: string; filename: string; mtime: string }[]>([]);

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

    const loadGallery = async (query?: string, projectId?: number | null) => {
        try {
            setIsLoading(true);
            const target = projectId !== undefined ? projectId : selectedProjectId;
            const unassignedOnly = target === -1;
            const data = await api.getGallery(query || search, undefined, unassignedOnly ? null : target, unassignedOnly);
            setItems(data);
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : "Failed to load gallery");
        } finally {
            setIsLoading(false);
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

        try {
            await Promise.all(Array.from(selectedIds).map(id => api.deleteImage(id)));
            setItems(prev => prev.filter(i => !selectedIds.has(i.image.id)));
            setSelectedIds(new Set());
        } catch (e) {
            alert("Failed to delete some images");
        }
    };

    const handleCleanupStart = () => {
        setCleanupMode(true);
        setSelectedIds(new Set());
        setLastSelectedId(null);
        setSelectionMode(true);
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
            await Promise.all(deleteCandidates.map((item) => api.deleteImage(item.image.id)));
            setItems(items.filter((item) => selectedIds.has(item.image.id)));
            setCleanupMode(false);
            setSelectedIds(new Set());
            setLastSelectedId(null);
        } catch (err) {
            console.error(err);
            alert("Failed to clean up some images");
        }
    };

    const handleSelectProject = (id: number | null) => {
        setSelectedProjectId(id);
        setSelectedFolder(null); // Reset folder when project changes
        setFolderImages([]);
        loadGallery(search, id);
    };

    const handleSelectFolder = async (folder: string | null) => {
        setSelectedFolder(folder);
        if (folder && selectedProjectId) {
            setIsLoading(true);
            try {
                const images = await api.getProjectFolderImages(selectedProjectId, folder);
                setFolderImages(images);
            } catch (err) {
                console.error("Failed to load folder images", err);
                setFolderImages([]);
            } finally {
                setIsLoading(false);
            }
        } else {
            setFolderImages([]);
            loadGallery(search, selectedProjectId);
        }
    };

    // Get folders for the selected project
    const selectedProject = selectedProjectId ? projects.find(p => p.id === selectedProjectId) : null;
    const projectFolders = selectedProject?.config_json?.folders || [];

    const handleDelete = async (id: number) => {
        if (!confirm("Are you sure you want to delete this image?")) return;
        try {
            await api.deleteImage(id);
            await loadGallery(search, selectedProjectId);
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
    const fullscreenItem = fullscreenIndex !== null ? items[fullscreenIndex] : null;

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
            <div className="flex-1 overflow-auto p-8 relative">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Generated Gallery</h1>
                        <div className="text-sm text-slate-600 bg-slate-100 border border-slate-200 px-3 py-1 rounded-full">
                            Viewing {selectedProjectId ? projects.find(p => p.id === selectedProjectId)?.name || "project" : "all projects"}
                            {selectedFolder && ` / ${selectedFolder}`}
                        </div>

                        {selectedIds.size > 0 && (
                            <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm font-medium border border-blue-100 animate-in fade-in slide-in-from-left-4">
                                <Check className="w-4 h-4" />
                                {cleanupMode ? `${selectedIds.size} to keep` : `${selectedIds.size} Selected`}
                                <div className="h-4 w-px bg-blue-200 mx-1" />
                                {!cleanupMode && (
                                    <button onClick={handleBulkDelete} className="hover:underline text-red-600">Delete</button>
                                )}
                                <button onClick={() => setSelectedIds(new Set())} className="hover:underline text-slate-500">Clear</button>
                            </div>
                        )}
                    </div>
                    <div className="w-full md:max-w-2xl flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
                        <form onSubmit={handleSearch} className="flex-1">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                                <Input
                                    type="search"
                                    placeholder="Search prompts, tags, captions..."
                                    className="pl-9"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                        </form>
                        <div className="flex items-center gap-2">
                            <Button variant={selectionMode ? "default" : "outline"} onClick={() => setSelectionMode(!selectionMode)}>
                                {selectionMode ? "Selection mode on" : "Selection mode off"}
                            </Button>
                            <Button variant={cleanupMode ? "secondary" : "outline"} onClick={cleanupMode ? () => setCleanupMode(false) : handleCleanupStart}>
                                {cleanupMode ? "Done selecting" : "Gallery cleanup"}
                            </Button>
                            {cleanupMode && (
                                <Button variant="destructive" onClick={handleCleanupPurge} disabled={items.length === 0}>
                                    Clean up gallery
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {cleanupMode && (
                    <Alert className="mb-4">
                        <AlertTitle>Cleanup mode</AlertTitle>
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
                {isLoading && items.length > 0 && (
                    <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10 pointer-events-none">
                        <div className="text-sm text-slate-500 bg-white/90 px-4 py-2 rounded-full shadow-sm border">
                            Loading...
                        </div>
                    </div>
                )}

                {items.length === 0 && isLoading ? (
                    <div className="text-center text-slate-500 py-20">
                        Loading gallery...
                    </div>
                ) : items.length === 0 ? (
                    <div className="text-center text-slate-500 py-20">
                        No images generated yet. Go to New Generation to create some!
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {items.map((item) => (
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
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).src = "https://placehold.co/400x400?text=Missing+File";
                                                }}
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
                                                                    <HoverCardContent className="w-[500px] max-h-[60vh] overflow-y-auto p-4" align="start">
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
                                    <ContextMenuItem onSelect={() => handleRegenerate(item)}>Regenerate</ContextMenuItem>
                                    <ContextMenuItem onSelect={() => handleSavePrompt(item)}>Save Prompt</ContextMenuItem>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem className="text-red-600" onSelect={() => handleDelete(item.image.id)}>Delete</ContextMenuItem>
                                </ContextMenuContent>
                            </ContextMenu>
                        ))}
                    </div>
                )}
            </div>
            {
                fullscreenItem && (
                    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-6 text-white">
                        <button
                            className="absolute top-4 right-4 rounded-full bg-white/10 hover:bg-white/20 transition p-2"
                            onClick={closeFullscreen}
                            aria-label="Close fullscreen"
                        >
                            <X className="w-5 h-5" />
                        </button>

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
                            <div className="relative w-full flex items-center justify-center">
                                {selectedIds.has(fullscreenItem.image.id) && (
                                    <div className="absolute top-3 left-3 bg-blue-500 text-white rounded-full p-1 shadow-sm flex items-center gap-1 text-xs">
                                        <Check className="w-3 h-3" /> Selected
                                    </div>
                                )}
                                <img
                                    src={`/api/v1/gallery/image/${fullscreenItem.image.id}`}
                                    alt={fullscreenItem.image.filename}
                                    className="max-h-[80vh] w-auto object-contain rounded-lg shadow-2xl"
                                />
                            </div>
                            <div className="bg-white/5 rounded-lg px-4 py-2 text-sm w-full flex items-center justify-between">
                                <div className="flex items-center gap-2 text-slate-100">
                                    <span className="font-semibold">{fullscreenItem.prompt_name || fullscreenItem.image.filename}</span>
                                    <span className="text-xs text-slate-300">{new Date(fullscreenItem.created_at).toLocaleString()}</span>
                                </div>
                                <div className="text-xs text-slate-200">Use ← → arrows or on-screen controls to navigate. ESC closes.</div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
}
