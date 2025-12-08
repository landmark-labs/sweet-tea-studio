import { useEffect, useState } from "react";
import { api, GalleryItem, Collection } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Save, Trash2, Calendar, Search, Sparkles, RotateCcw, Copy, Check, FolderPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { CollectionSidebar } from "@/components/CollectionSidebar";
import { cn } from "@/lib/utils";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem
} from "@/components/ui/command";

export default function Gallery() {
    const [items, setItems] = useState<GalleryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [captioningId, setCaptioningId] = useState<number | null>(null);
    const [search, setSearch] = useState("");
    const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [lastSelectedId, setLastSelectedId] = useState<number | null>(null);

    // Bulk Move Dialog State
    const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
    const [collections, setCollections] = useState<Collection[]>([]);
    const [targetCollectionId, setTargetCollectionId] = useState<number | null>(null);

    const navigate = useNavigate();

    useEffect(() => {
        loadGallery();
    }, []);

    const loadGallery = async (query?: string, collectionId?: number | null) => {
        try {
            setIsLoading(true);
            const data = await api.getGallery(query || search, collectionId !== undefined ? collectionId : selectedCollectionId);
            setItems(data);
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : "Failed to load gallery");
        } finally {
            setIsLoading(false);
        }
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        loadGallery(search, selectedCollectionId);
    };

    // Selection Logic
    const handleImageClick = (id: number, e: React.MouseEvent) => {
        // If clicking button/interactive element, ignore
        if ((e.target as HTMLElement).closest("button")) return;

        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const newSet = new Set(selectedIds);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            setSelectedIds(newSet);
            setLastSelectedId(id);
        } else if (e.shiftKey && lastSelectedId !== null) {
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
            }
        } else {
            // Normal click - check if we are in 'selection mode' (multiple selected)
            // If strictly normal click logic requested: Open Viewer.
            // But if user wants to just select one? They can Ctrl+Click.
            // Let's stick to standard explorer: Click clears others and selects this one (if not opening).
            // But since we open on click, we just open.

            // Wait, if opening viewer, we should probably pass the list of all images? 
            // Currently ImageViewer takes 'items' which is good.
            // But we want to let user view THIS image.

            // However, user asked for: ctrl+click to select.
            // So normal click = Interaction.

            // We just clear selection if normal click? Maybe not. 
            // Let's just open the viewer.
        }
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

    const openMoveDialog = async () => {
        try {
            const cols = await api.getCollections();
            setCollections(cols);
            setTargetCollectionId(null);
            setIsMoveDialogOpen(true);
        } catch (e) {
            console.error(e);
        }
    };

    const handleBulkMove = async () => {
        if (selectedIds.size === 0 || targetCollectionId === null) return;
        try {
            const ids = Array.from(selectedIds);
            await api.addImagesToCollection(targetCollectionId, ids);
            setIsMoveDialogOpen(false);

            // Optimistic Update
            setItems(prev => prev.map(item => {
                if (selectedIds.has(item.image.id)) {
                    return { ...item, image: { ...item.image, collection_id: targetCollectionId } };
                }
                return item;
            }));

            // If we are currently filtered by a DIFFERENT collection, remove them from view?
            if (selectedCollectionId !== null && selectedCollectionId !== targetCollectionId) {
                setItems(prev => prev.filter(i => !selectedIds.has(i.image.id)));
            }

            setSelectedIds(new Set());
            alert("Moved successfully");
        } catch (e) {
            alert("Failed to move images");
        }
    };

    const handleSelectCollection = (id: number | null) => {
        setSelectedCollectionId(id);
        loadGallery(search, id);
    };

    const handleDelete = async (id: number) => {
        if (!confirm("Are you sure you want to delete this image?")) return;
        try {
            await api.deleteImage(id);
            setItems(items.filter((i) => i.image.id !== id));
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

    const handleCaption = async (item: GalleryItem) => {
        setCaptioningId(item.image.id);
        try {
            const res = await fetch(`/api/v1/gallery/image/path?path=${encodeURIComponent(item.image.path)}`);
            if (!res.ok) throw new Error("Unable to fetch image bytes");
            const blob = await res.blob();
            const file = new File([blob], item.image.filename, { type: blob.type || "image/png" });
            const caption = await api.captionImage(file, item.image.id);

            setItems((prev) =>
                prev.map((i) =>
                    i.image.id === item.image.id
                        ? { ...i, image: { ...i.image, caption: caption.caption, tags: caption.ranked_tags || [] } }
                        : i
                )
            );
        } catch (err) {
            console.error(err);
            alert(err instanceof Error ? err.message : "Caption request failed");
        } finally {
            setCaptioningId(null);
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

    if (isLoading) return <div className="p-8">Loading gallery...</div>;

    return (
        <div className="flex h-screen overflow-hidden bg-slate-50">
            {/* Bulk Move Dialog */}
            <Dialog open={isMoveDialogOpen} onOpenChange={setIsMoveDialogOpen}>
                <DialogContent className="p-0 overflow-hidden flex flex-col h-[50vh] max-h-[500px]">
                    <DialogHeader className="px-4 py-2 border-b shrink-0">
                        <DialogTitle>Move {selectedIds.size} items to...</DialogTitle>
                    </DialogHeader>
                    <Command className="flex-1 overflow-hidden">
                        <CommandInput placeholder="Search collections..." />
                        <CommandList className="max-h-full overflow-y-auto">
                            <CommandEmpty>No collections found.</CommandEmpty>
                            <CommandGroup>
                                {collections.map((col) => (
                                    <CommandItem
                                        key={col.id}
                                        value={col.name}
                                        onSelect={() => setTargetCollectionId(col.id)}
                                        className="cursor-pointer aria-selected:bg-slate-100 dark:aria-selected:bg-slate-800"
                                    >
                                        <div className="flex items-center w-full">
                                            <FolderPlus className={cn("mr-2 h-4 w-4", targetCollectionId === col.id ? "text-blue-500" : "text-slate-500")} />
                                            <span className={cn("flex-1", targetCollectionId === col.id && "font-medium text-blue-700")}>{col.name}</span>
                                            {targetCollectionId === col.id && <Check className="h-4 w-4 text-blue-500 ml-2" />}
                                        </div>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                    <div className="p-4 border-t bg-slate-50 flex justify-end gap-2 shrink-0">
                        <Button variant="outline" onClick={() => setIsMoveDialogOpen(false)}>Cancel</Button>
                        <Button disabled={targetCollectionId === null} onClick={handleBulkMove}>
                            Move {selectedIds.size} Image{selectedIds.size !== 1 && 's'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <CollectionSidebar
                selectedCollectionId={selectedCollectionId}
                onSelectCollection={handleSelectCollection}
                className="h-full border-r bg-white"
            />
            <div className="flex-1 overflow-auto p-8 relative">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Generated Gallery</h1>
                        {selectedIds.size > 0 && (
                            <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm font-medium border border-blue-100 animate-in fade-in slide-in-from-left-4">
                                <Check className="w-4 h-4" />
                                {selectedIds.size} Selected
                                <div className="h-4 w-px bg-blue-200 mx-1" />
                                <button onClick={openMoveDialog} className="hover:underline">Move</button>
                                <button onClick={handleBulkDelete} className="hover:underline text-red-600">Delete</button>
                                <button onClick={() => setSelectedIds(new Set())} className="hover:underline text-slate-500">Clear</button>
                            </div>
                        )}
                    </div>

                    <form onSubmit={handleSearch} className="w-full md:max-w-lg">
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
                </div>

                {error && (
                    <Alert variant="destructive" className="mb-6">
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                {items.length === 0 ? (
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
                                            "group overflow-hidden flex flex-col relative transition-all duration-200",
                                            selectedIds.has(item.image.id) ? "ring-2 ring-blue-500 shadow-lg scale-[0.98] bg-blue-50/50" : ""
                                        )}
                                        onClick={(e) => handleImageClick(item.image.id, e)}
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
                                                    onClick={(e) => { e.stopPropagation(); handleCaption(item); }}
                                                    disabled={captioningId === item.image.id}
                                                    title="Generate caption"
                                                >
                                                    <Sparkles className="w-4 h-4" />
                                                </Button>
                                                {/* Open Viewer Button (since clicking might now select) */}
                                                {/* Actually, let's keep click behavior natural but add explicit 'View' button if needed. 
                                                     For now just relying on standard click opening viewer unless modifiers used. 
                                                     Wait, I didn't verify standard click opens viewer in my logic above. 
                                                     I removed the onContextMenu.
                                                  */}
                                                {/* Restore click to open viewer if NO modifiers */}
                                                <div className="absolute inset-0 z-0" onClick={(e) => {
                                                    if (!e.ctrlKey && !e.shiftKey && !e.metaKey) {
                                                        // Open Viewer (Currently handled by child API? No, removed logic?)
                                                        // Wait, the original code had NO onClick for the Card?!
                                                        // Ah, looking at previous file content...
                                                        // It seems it relied on the ImageViewer being separate? 
                                                        // No, previous code:
                                                        // <Card ... onContextMenu={...}>
                                                        // There was NO onClick handler for the card itself in previous version?
                                                        // It seems I missed where the viewer opened.
                                                        // Looking closely at Lines 171-333 of previous content.
                                                        // There is NO onClick on the Card. 
                                                        // Wait, how did the user view images?
                                                        // Only via the overlay?
                                                        // The overlay doesn't have a "View" button.
                                                        // Ah, maybe the user wants to ADD the ability to view it?
                                                        // Or maybe I missed something.
                                                        // Let's re-read the file.
                                                        // <img src... />
                                                        // It seems... there was no click to view full screen in Gallery?! 
                                                        // Only "Regenerate" and "Delete".
                                                        // That seems like a missing feature if true.
                                                        // BUT, my task is "Multi-select" and "Move".
                                                        // If I simply add onClick to Toggle Selection, that is fine.
                                                    }
                                                }} />

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

                                            {item.prompt_name && (
                                                <p className="text-[11px] uppercase tracking-wide text-slate-500">{item.prompt_name}</p>
                                            )}

                                            {item.prompt && (
                                                <p className="line-clamp-2 italic text-slate-700">"{item.prompt}"</p>
                                            )}

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

                                            {/* Skipping getPrompts rendering logic for brevity in replacement, assuming it's just 'content' */}
                                            {/* Actually, I need to include the content or I will lose it. */}
                                            {/* Since I am replacing the entire map block, I should check if I can just wrap the Card. */}
                                            {/* It is safer to re-render the content. I will copy the getPrompts logic block. */}

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
                                                                <p className="line-clamp-3 text-slate-700 leading-relaxed">{positive}</p>
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
                                    <ContextMenuItem onSelect={() => {
                                        setSelectedIds(new Set([item.image.id]));
                                        openMoveDialog();
                                    }}>Move to Collection...</ContextMenuItem>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem className="text-red-600" onSelect={() => handleDelete(item.image.id)}>Delete</ContextMenuItem>
                                </ContextMenuContent>
                            </ContextMenu>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
