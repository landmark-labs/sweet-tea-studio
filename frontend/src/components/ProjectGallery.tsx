import React, { useState, useEffect } from "react";
import { api, Project, FolderImage } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, FolderOpen, ImageIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectGalleryProps {
    projects: Project[];
    className?: string;
    onSelectImage?: (imagePath: string) => void;
}

export function ProjectGallery({ projects, className, onSelectImage }: ProjectGalleryProps) {
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

    // Get selected project
    const selectedProject = projects.find(p => String(p.id) === selectedProjectId);
    const folders = (selectedProject?.config_json as { folders?: string[] })?.folders || [];

    // Persist collapsed state
    useEffect(() => {
        localStorage.setItem("ds_project_gallery_collapsed", String(collapsed));
    }, [collapsed]);

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

        // Poll every 5 seconds
        const poll = async () => {
            if (!mounted) return;
            await loadImages(false); // Background update
            if (mounted) timeoutId = setTimeout(poll, 5000);
        };

        timeoutId = setTimeout(poll, 5000);

        return () => {
            mounted = false;
            clearTimeout(timeoutId);
        };
    }, [selectedProjectId, selectedFolder]);

    // Reset folder when project changes
    useEffect(() => {
        if (folders.length > 0 && !folders.includes(selectedFolder)) {
            setSelectedFolder(folders[0]);
        } else if (folders.length === 0) {
            setSelectedFolder("");
        }
    }, [selectedProjectId, folders]);

    // Handle drag start - set the image URL as draggable data
    const handleDragStart = (e: React.DragEvent, image: FolderImage) => {
        const imageUrl = `/api/v1/gallery/image/path?path=${encodeURIComponent(image.path)}`;
        e.dataTransfer.setData("text/plain", imageUrl);
        e.dataTransfer.effectAllowed = "copy";
    };

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
                <div className="mt-2 writing-mode-vertical text-xs text-slate-400 font-medium tracking-wider">
                    PROJECT GALLERY
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
                            {projects.length === 0 ? (
                                <SelectItem value="__empty" disabled>No projects</SelectItem>
                            ) : (
                                projects.map((p) => (
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
            <ScrollArea className="flex-1">
                <div className="p-2">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                        </div>
                    ) : !selectedProjectId ? (
                        <div className="text-center py-8 text-xs text-slate-400">
                            <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <div>Select a project to browse images</div>
                        </div>
                    ) : images.length === 0 ? (
                        <div className="text-center py-8 text-xs text-slate-400">
                            <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <div>No images in this folder</div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-1">
                            {images.map((image) => (
                                <div
                                    key={image.path}
                                    className="aspect-square relative group cursor-pointer rounded overflow-hidden border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all"
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, image)}
                                    onClick={() => onSelectImage?.(image.path)}
                                    title={`${image.filename}\nClick to view, drag to use as input`}
                                >
                                    <img
                                        src={`/api/v1/gallery/image/path?path=${encodeURIComponent(image.path)}`}
                                        alt={image.filename}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                    />
                                    <div className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[8px] p-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                                        {image.filename}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </ScrollArea>

            {/* Footer hint */}
            {images.length > 0 && (
                <div className="flex-none p-2 border-t bg-slate-50 text-[10px] text-slate-400 text-center">
                    Drag images to use as inputs
                </div>
            )}
        </div>
    );
}
