import { useState, useEffect } from "react";
import { Folder, FolderPlus, Trash2, ChevronLeft, ChevronRight, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { api, Collection } from "@/lib/api";

interface CollectionSidebarProps {
    selectedCollectionId: number | null;
    onSelectCollection: (id: number | null) => void;
    className?: string;
}

export function CollectionSidebar({ selectedCollectionId, onSelectCollection, className }: CollectionSidebarProps) {
    const [collapsed, setCollapsed] = useState(() => {
        const saved = localStorage.getItem("collection_sidebar_collapsed");
        return saved !== null ? saved === "true" : true;
    });

    useEffect(() => {
        localStorage.setItem("collection_sidebar_collapsed", String(collapsed));
    }, [collapsed]);

    const [collections, setCollections] = useState<Collection[]>([]);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newCollectionName, setNewCollectionName] = useState("");

    const fetchCollections = async () => {
        try {
            const data = await api.getCollections();
            setCollections(data);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        fetchCollections();
        // Poll for updates occasionally or we can trigger it manually? 
        // For now just fetch on mount.
    }, []);

    const handleCreate = async () => {
        if (!newCollectionName.trim()) return;
        try {
            const newCol = await api.createCollection({ name: newCollectionName });
            setCollections(prev => [...prev, newCol].sort((a, b) => a.name.localeCompare(b.name)));
            setNewCollectionName("");
            setIsCreateOpen(false);
            onSelectCollection(newCol.id);
            setCollapsed(false); // Auto expand on create
        } catch (e) {
            alert("Failed to create collection");
        }
    };

    const handleDelete = async (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("Delete this collection? Images will be kept.")) return;
        try {
            await api.deleteCollection(id, true);
            setCollections(prev => prev.filter(c => c.id !== id));
            if (selectedCollectionId === id) onSelectCollection(null);
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div
            className={cn(
                "relative border-r bg-slate-50 transition-all duration-300 flex flex-col",
                collapsed ? "w-12" : "w-64",
                className
            )}
        >
            <Button
                variant="ghost"
                size="icon"
                className="absolute -right-3 top-4 h-6 w-6 rounded-full border bg-white shadow-sm z-10"
                onClick={() => setCollapsed(!collapsed)}
            >
                {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>

            <div className="p-2 flex items-center justify-between border-b h-14">
                {!collapsed && <span className="font-semibold text-slate-700">Collections</span>}
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" title="New Collection">
                            <FolderPlus className="h-5 w-5 text-slate-600" />
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create Collection</DialogTitle>
                        </DialogHeader>
                        <div className="py-4">
                            <Input
                                placeholder="Project Name"
                                value={newCollectionName}
                                onChange={(e) => setNewCollectionName(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                            />
                        </div>
                        <DialogFooter>
                            <Button onClick={handleCreate}>Create</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <ScrollArea className="flex-1">
                <div className="p-2 space-y-1">
                    <Button
                        variant={selectedCollectionId === null ? "secondary" : "ghost"}
                        className={cn("w-full justify-start", collapsed ? "px-2" : "px-4")}
                        onClick={() => onSelectCollection(null)}
                        title="All Images"
                    >
                        <Layers className="h-4 w-4 mr-2" />
                        {!collapsed && <span>All Images</span>}
                    </Button>

                    {collections.map(col => (
                        <div key={col.id} className="group relative flex items-center">
                            <Button
                                variant={selectedCollectionId === col.id ? "secondary" : "ghost"}
                                className={cn("w-full justify-start truncate pr-8", collapsed ? "px-2" : "px-4")}
                                onClick={() => onSelectCollection(col.id)}
                                title={col.name}
                            >
                                <Folder className={cn("h-4 w-4 mr-2", selectedCollectionId === col.id ? "fill-blue-200 text-blue-600" : "text-slate-500")} />
                                {!collapsed && <span className="truncate">{col.name}</span>}
                                {!collapsed && col.item_count !== undefined && col.item_count > 0 && (
                                    <span className="ml-auto text-xs text-slate-400">{col.item_count}</span>
                                )}
                            </Button>
                            {!collapsed && (
                                <button
                                    onClick={(e) => handleDelete(col.id, e)}
                                    className="absolute right-2 opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-red-500 transition-all"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}
