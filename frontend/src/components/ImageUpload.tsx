import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Upload, X, Loader2, Grid, PenTool, FolderOpen, ChevronRight, Image as ImageIcon, Video as VideoIcon } from "lucide-react";
import { api, Project, FolderImage, IMAGE_API_BASE } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { getBasename, normalizePath } from "@/lib/pathUtils";
import { InpaintEditor } from "@/components/InpaintEditor";

interface ImageUploadProps {
    value?: string;
    onChange: (value: string) => void;
    engineId?: string;
    options?: string[]; // List of available files from ComfyUI
    projectSlug?: string; // If provided, uploads go to /ComfyUI/input/<project>/
    destinationFolder?: string; // If provided with projectSlug, uploads go to /ComfyUI/input/<project>/<folder>/
    mediaKind?: "image" | "video" | "any";
    compact?: boolean;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi"]);

const getExtension = (name: string) => {
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(dot).toLowerCase() : "";
};

const guessKindFromFilename = (name: string) => {
    const ext = getExtension(name);
    if (VIDEO_EXTENSIONS.has(ext)) return "video";
    if (IMAGE_EXTENSIONS.has(ext)) return "image";
    return null;
};

const detectFileKind = (file: File) => {
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("image/")) return "image";
    return guessKindFromFilename(file.name);
};

const BROWSE_THUMB_MAX_PX = 256;

const galleryMediaUrl = (path: string) =>
    `${IMAGE_API_BASE}/gallery/image/path?path=${encodeURIComponent(path)}`;

const galleryThumbnailUrl = (path: string, maxPx = BROWSE_THUMB_MAX_PX) =>
    `${IMAGE_API_BASE}/gallery/image/path/thumbnail?path=${encodeURIComponent(path)}&max_px=${maxPx}`;

export function ImageUpload({
    value,
    onChange,
    engineId,
    options: _options = [], // eslint-disable-line @typescript-eslint/no-unused-vars
    projectSlug,
    destinationFolder,
    mediaKind = "image",
    compact = false,
}: ImageUploadProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);
    const [previewKind, setPreviewKind] = useState<"image" | "video" | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isBrowseOpen, setIsBrowseOpen] = useState(false);
    const [recent, setRecent] = useState<string[]>([]);
    const [galleryImages, setGalleryImages] = useState<string[]>([]);

    // Browse dialog project/folder selection state
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
    const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
    const [projectFolderImages, setProjectFolderImages] = useState<FolderImage[]>([]);
    const [projectGalleryImages, setProjectGalleryImages] = useState<string[]>([]);
    const [isLoadingProjectImages, setIsLoadingProjectImages] = useState(false);

    // Mask Editor State
    const [isMaskEditorOpen, setIsMaskEditorOpen] = useState(false);
    const objectUrlRef = useRef<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const inputId = useId();
    const hoverOpenTimerRef = useRef<NodeJS.Timeout | null>(null);
    const hoverCloseTimerRef = useRef<NodeJS.Timeout | null>(null);
    const [hoverOpen, setHoverOpen] = useState(false);
    const popoverContentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (objectUrlRef.current && objectUrlRef.current !== preview) {
            if (objectUrlRef.current.startsWith("blob:")) {
                URL.revokeObjectURL(objectUrlRef.current);
            }
            objectUrlRef.current = null;
        }
        if (preview && preview.startsWith("blob:")) {
            objectUrlRef.current = preview;
        }
    }, [preview]);

    useEffect(() => {
        return () => {
            if (objectUrlRef.current && objectUrlRef.current.startsWith("blob:")) {
                URL.revokeObjectURL(objectUrlRef.current);
            }
        };
    }, []);
    useEffect(() => {
        return () => {
            if (hoverOpenTimerRef.current) clearTimeout(hoverOpenTimerRef.current);
            if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
        };
    }, []);

    useEffect(() => {
        const currentKind = previewKind || (value ? guessKindFromFilename(value) : null);
        if (currentKind === "video" && isMaskEditorOpen) {
            setIsMaskEditorOpen(false);
        }
    }, [previewKind, value, isMaskEditorOpen]);

    useEffect(() => {
        // Load recent form local storage
        try {
            const history = JSON.parse(localStorage.getItem("ds_recent_images") || "[]");
            setRecent(history); // Initially load whatever is there
        } catch (e) { console.error(e); }
    }, []);

    // Clear stale preview when value changes externally (e.g., from "use in pipe")
    // The preview state is set during local uploads but becomes stale when value is updated externally
    const prevValueRef = useRef(value);
    useEffect(() => {
        if (value !== prevValueRef.current) {
            // Value changed externally - clear preview so we use the API path for the new value
            if (preview && !preview.startsWith("blob:")) {
                setPreview(null);
            } else if (preview && value) {
                // If we have a blob preview but value changed, clear it
                setPreview(null);
            }
            // Update preview kind based on new value
            if (value) {
                setPreviewKind(guessKindFromFilename(value));
            }
            prevValueRef.current = value;
        }
    }, [value, preview]);

    useEffect(() => {
        if (isBrowseOpen) {
            // Load gallery images for the "Recent" tab (default view)
            api.getGallery({ limit: 25, includeThumbnails: false }).then(items => {
                // Sort by created_at desc (newest first)
                const sorted = items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                setGalleryImages(sorted.slice(0, 25).map(i => i.image.path));
            }).catch(console.error);

            // Load projects for the project picker
            api.getProjects().then(setProjects).catch(console.error);
        } else {
            // Reset selection when dialog closes
            setSelectedProjectId(null);
            setSelectedFolder(null);
            setProjectFolderImages([]);
        }
    }, [isBrowseOpen]);

    // Load folder images when project and folder are selected
    useEffect(() => {
        if (selectedProjectId && selectedFolder) {
            setIsLoadingProjectImages(true);
            api.getProjectFolderImages(selectedProjectId, selectedFolder, { includeDimensions: false })
                .then(images => {
                    // Sort by mtime desc (newest first)
                    const sorted = images.sort((a, b) =>
                        new Date(b.mtime).getTime() - new Date(a.mtime).getTime()
                    );
                    setProjectFolderImages(sorted);
                })
                .catch(console.error)
                .finally(() => setIsLoadingProjectImages(false));
            setProjectGalleryImages([]); // Clear project gallery when folder selected
        } else if (selectedProjectId && !selectedFolder) {
            // Load ALL images from all project folders combined
            setIsLoadingProjectImages(true);
            const selectedProject = projects.find(p => p.id === selectedProjectId);
            const folders = selectedProject?.config_json?.folders || [];

            // Fetch images from each folder and merge
            Promise.all(
                folders.map(folder =>
                    api.getProjectFolderImages(selectedProjectId, folder, { includeDimensions: false }).catch(() => [])
                )
            ).then(results => {
                // Flatten and dedupe by path
                const allImages = results.flat();
                const uniqueByPath = new Map<string, FolderImage>();
                allImages.forEach(img => uniqueByPath.set(img.path, img));

                // Sort all by mtime desc (newest first)
                const sorted = Array.from(uniqueByPath.values()).sort((a, b) =>
                    new Date(b.mtime).getTime() - new Date(a.mtime).getTime()
                );

                // Limit to 25 for performance
                setProjectGalleryImages(sorted.slice(0, 25).map(img => img.path));
            }).catch(console.error)
                .finally(() => setIsLoadingProjectImages(false));

            setProjectFolderImages([]);
        } else {
            setProjectFolderImages([]);
            setProjectGalleryImages([]);
            setIsLoadingProjectImages(false);
        }
    }, [selectedProjectId, selectedFolder, projects]);

    const addToRecent = (filename: string) => {
        // Ensure unique and limit to 5
        const newRecent = [filename, ...recent.filter(r => r !== filename)].slice(0, 5);
        setRecent(newRecent);
        localStorage.setItem("ds_recent_images", JSON.stringify(newRecent));
    };

    const processFile = async (file: File) => {
        const fileKind = detectFileKind(file);
        if (mediaKind === "image" && fileKind === "video") {
            console.warn("Video uploads are not allowed for this field.");
            return;
        }
        if (mediaKind === "video" && fileKind === "image") {
            console.warn("Image uploads are not allowed for this field.");
            return;
        }

        // Create local preview
        const objectUrl = URL.createObjectURL(file);
        setPreview(objectUrl);
        setPreviewKind(fileKind || (mediaKind === "video" ? "video" : "image"));

        setIsUploading(true);
        try {
            const id = engineId ? parseInt(engineId) : undefined;
            const result = await api.uploadFile(file, id, projectSlug, destinationFolder);
            onChange(result.filename);
            addToRecent(result.filename);
        } catch (error) {
            console.error("Upload failed", error);
            setPreview(null);
            onChange("");
        } finally {
            setIsUploading(false);
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        await processFile(e.target.files[0]);
    };

    // Drag counter to handle nested elements properly
    // When dragging over child elements, dragenter/dragleave fire on each child
    // The counter ensures we only set isDragging=false when truly leaving
    const dragCounterRef = useRef(0);

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current++;
        if (!isDragging) {
            setIsDragging(true);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        // Ensure isDragging stays true during drag
        if (!isDragging) {
            setIsDragging(true);
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current--;
        // Only set to false when all nested enter events have been matched with leaves
        if (dragCounterRef.current === 0) {
            setIsDragging(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        dragCounterRef.current = 0; // Reset counter for next drag operation

        // Priority 1: Check for Sweet Tea internal image path
        const sweetTeaPath = e.dataTransfer.getData("application/x-sweet-tea-image");
        if (sweetTeaPath) {
            // Check if the image is already in ComfyUI's input directory
            // If so, use the relative path directly without re-uploading
            const inputDirMatch = sweetTeaPath.match(/[/\\]input[/\\](.+)$/);
            if (inputDirMatch) {
                // Extract the relative path after /input/
                // This works for paths like /opt/ComfyUI/input/project/folder/file.jpg
                const relativePath = normalizePath(inputDirMatch[1]);
                console.log(`[ImageUpload] Using existing input path: ${relativePath}`);
                onChange(relativePath);
                addToRecent(relativePath);
                setPreviewKind(guessKindFromFilename(relativePath));

                // Set preview from the original path
                const previewUrl = galleryMediaUrl(sweetTeaPath);
                setPreview(previewUrl);
                return;
            }

            // Image is NOT in input dir (e.g., from /sweet_tea/project/output/)
            // Use server-side copy to preserve original filename
            setIsUploading(true);
            try {
                const id = engineId ? parseInt(engineId) : undefined;
                const result = await api.copyToInput(sweetTeaPath, id, projectSlug, destinationFolder);
                onChange(result.filename);
                addToRecent(result.filename);
                setPreviewKind(guessKindFromFilename(result.filename));
                // Set preview from the original path
                const previewUrl = galleryMediaUrl(sweetTeaPath);
                setPreview(previewUrl);
            } catch (err) {
                console.error("Failed to copy dropped Sweet Tea image to input", err);
            } finally {
                setIsUploading(false);
            }
            return;
        }

        // Priority 2: Handle dropped files
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            await processFile(e.dataTransfer.files[0]);
        } else {
            // Priority 3: Try to handle URL drop
            const url = e.dataTransfer.getData("text/plain");
            if (url) {
                setIsUploading(true);
                try {
                    const response = await fetch(url);
                    const blob = await response.blob();
                    const filename = url.split('/').pop() || "dropped_image.png";
                    const file = new File([blob], filename, { type: blob.type });
                    await processFile(file);
                } catch (err) {
                    console.error("Failed to process dropped URL", err);
                    setIsUploading(false);
                }
            }
        }
    };



    const clear = () => {
        setPreview(null);
        setPreviewKind(null);
        onChange("");
    };

    const selectGalleryImage = async (path: string) => {
        // Check if the image is already in ComfyUI's input directory
        // If so, use the relative path directly without re-uploading
        const inputDirMatch = path.match(/[/\\]input[/\\](.+)$/);
        if (inputDirMatch) {
            // Extract the relative path after /input/
            const relativePath = normalizePath(inputDirMatch[1]);
            console.log(`[ImageUpload] Using existing input path: ${relativePath}`);
            onChange(relativePath);
            addToRecent(relativePath);
            setPreviewKind(guessKindFromFilename(relativePath));
            setPreview(galleryMediaUrl(path));
            setIsBrowseOpen(false);
            return;
        }

        // Image is NOT in input dir - use server-side copy to preserve filename
        setIsUploading(true);
        try {
            const id = engineId ? parseInt(engineId) : undefined;
            const result = await api.copyToInput(path, id, projectSlug, destinationFolder);
            onChange(result.filename);
            addToRecent(result.filename);
            setPreviewKind(guessKindFromFilename(result.filename));
            setPreview(galleryMediaUrl(path));
            setIsBrowseOpen(false);
        } catch (e) {
            console.error("Failed to copy gallery image to input", e);
        } finally {
            setIsUploading(false);
        }
    };

    const handleMaskSave = async (maskFile: File) => {
        if (!value) {
            alert("select an image first");
            return;
        }
        try {
            const id = engineId ? parseInt(engineId) : undefined;
            const result = await api.saveMask(maskFile, value, id);

            if (result.comfy_filename) {
                addToRecent(result.comfy_filename);
            }
            alert(`mask saved: ${result.comfy_filename || result.filename}`);
        } catch (e) {
            console.error("Mask upload failed", e);
            alert("failed to upload mask");
        }
    };


    const accept = mediaKind === "video" ? "video/*" : mediaKind === "any" ? "image/*,video/*" : "image/*";
    const browseTitle = mediaKind === "video" ? "browse videos" : mediaKind === "any" ? "browse media" : "browse images";
    const resolvedKind = previewKind || (value ? guessKindFromFilename(value) : null) || (mediaKind === "video" ? "video" : "image");
    const isVideoPreview = resolvedKind === "video";
    const hasValue = Boolean(preview || value);
    const displayValue = value || "no media selected";
    const focusWithin = (target: Element | null) => {
        if (!target) return false;
        return Boolean(popoverContentRef.current?.contains(target));
    };

    const clearHoverTimers = useCallback(() => {
        if (hoverOpenTimerRef.current) {
            clearTimeout(hoverOpenTimerRef.current);
            hoverOpenTimerRef.current = null;
        }
        if (hoverCloseTimerRef.current) {
            clearTimeout(hoverCloseTimerRef.current);
            hoverCloseTimerRef.current = null;
        }
    }, []);

    const requestHoverOpen = useCallback((immediate = false) => {
        clearHoverTimers();
        if (immediate) {
            setHoverOpen(true);
            return;
        }
        hoverOpenTimerRef.current = setTimeout(() => {
            setHoverOpen(true);
        }, 150);
    }, [clearHoverTimers]);

    const requestHoverClose = useCallback(() => {
        clearHoverTimers();
        hoverCloseTimerRef.current = setTimeout(() => {
            setHoverOpen(false);
        }, 200);
    }, [clearHoverTimers]);

    const holdHoverOpen = useCallback(() => {
        if (hoverCloseTimerRef.current) {
            clearTimeout(hoverCloseTimerRef.current);
            hoverCloseTimerRef.current = null;
        }
        setHoverOpen(true);
    }, []);

    // Calculate current media URL for editor
    const currentMediaUrl = preview || (value ? galleryMediaUrl(value) : "");
    const currentImageUrl = isVideoPreview ? "" : currentMediaUrl;

    const renderExpanded = (layoutCompact: boolean) => (
        <div className={cn("space-y-3", layoutCompact && "space-y-2")}>
            {!preview && !value ? (
                <div
                    className={cn(
                        "flex flex-col items-center justify-center border-2 border-dashed rounded-lg transition-colors gap-3",
                        layoutCompact ? "p-2 gap-2" : "p-4",
                        isDragging ? "border-ring bg-accent/40" : "border-border hover:bg-hover"
                    )}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div className="flex flex-col items-center gap-1 text-center">
                        {isUploading ? <Loader2 className={cn("animate-spin text-primary", layoutCompact ? "h-4 w-4" : "h-5 w-5")} /> : <Upload className={cn("text-muted-foreground", layoutCompact ? "h-4 w-4" : "h-5 w-5")} />}
                        <div className={cn("text-muted-foreground", layoutCompact ? "text-[10px]" : "text-xs")}>
                            {isUploading ? "Uploading..." : "Drag & drop here"}
                        </div>
                    </div>

                    {/* Side-by-side buttons */}
                    <div className={cn("flex gap-2 w-full", layoutCompact && "gap-1")}>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className={cn("flex-1", layoutCompact && "h-7 text-[10px]")}
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading}
                        >
                            Select File
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className={cn("flex-1", layoutCompact && "h-7 text-[10px]")}
                            onClick={() => setIsBrowseOpen(true)}
                        >
                            <Grid className="mr-1 w-3 h-3" /> Browse
                        </Button>
                    </div>
                    <input
                        id={inputId}
                        type="file"
                        className="hidden"
                        accept={accept}
                        onChange={handleFileChange}
                        ref={fileInputRef}
                    />


                </div>
            ) : (
                <div
                    className={cn(
                        "relative w-full bg-muted/50 rounded-lg overflow-hidden border group transition-colors",
                        layoutCompact ? "h-28" : "h-48",
                        isDragging ? "border-ring ring-2 ring-ring" : ""
                    )}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {/* Overlay for drop indication */}
                    {isDragging && (
                        <div className="absolute inset-0 bg-accent/60 z-10 flex items-center justify-center">
                            <div className="bg-white/90 p-2 rounded-full shadow-lg">
                                <Upload className="h-6 w-6 text-primary" />
                            </div>
                        </div>
                    )}

                    {/* If we have a preview (local blob) use it, otherwise use API path */}
                    {isVideoPreview ? (
                        <video
                            src={currentMediaUrl}
                            className="w-full h-full object-contain"
                            preload="metadata"
                            controls
                            playsInline
                            onError={(e) => {
                                (e.target as HTMLVideoElement).src = "";
                            }}
                        />
                    ) : (
                        <img
                            src={currentMediaUrl}
                            alt="Input"
                            className="w-full h-full object-contain pointer-events-none"
                            draggable={false}
                            onError={(e) => {
                                // Fallback if image load fails
                                (e.target as HTMLImageElement).src = "";
                            }}
                        />
                    )}

                    {/* Actions Overlay */}
                    <div className="absolute top-2 right-2 flex gap-1 z-20">
                        {/* Mask Editor Trigger */}
                        {!isVideoPreview && (
                            <button
                                type="button"
                                onClick={() => setIsMaskEditorOpen(true)}
                                className="bg-surface/90 text-foreground p-1.5 rounded-full shadow hover:bg-hover hover:text-foreground transition-colors"
                                title="Draw Mask (In-Painting)"
                            >
                                <PenTool className="w-4 h-4" />
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={clear}
                            className="bg-surface/90 text-destructive p-1.5 rounded-full shadow hover:bg-destructive/10 transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className={cn("absolute bottom-0 w-full bg-black/60 text-white truncate text-center backdrop-blur-sm z-20", layoutCompact ? "text-[10px] p-1" : "text-xs p-2")}>
                        {value}
                    </div>
                </div>
            )}

            {/* Browse Dialog */}
            <Dialog open={isBrowseOpen} onOpenChange={setIsBrowseOpen}>
                <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>{browseTitle}</DialogTitle>
                    </DialogHeader>

                    {/* Project/Folder Selector */}
                    <div className="flex gap-2 items-center border-b pb-3">
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <FolderOpen className="w-4 h-4" />
                            <span>browse:</span>
                        </div>
                        <select
                            value={selectedProjectId ?? ""}
                            onChange={(e) => {
                                const val = e.target.value;
                                setSelectedProjectId(val ? parseInt(val) : null);
                                setSelectedFolder(null);
                            }}
                            className="text-sm border rounded px-2 py-1 bg-white flex-1 max-w-[180px]"
                        >
                            <option value="">recent</option>
                            {projects.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>

                        {selectedProjectId && (
                            <>
                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                <select
                                    value={selectedFolder ?? ""}
                                    onChange={(e) => setSelectedFolder(e.target.value || null)}
                                    className="text-sm border rounded px-2 py-1 bg-white flex-1 max-w-[180px]"
                                >
                                    <option value="">all images</option>
                                    {projects.find(p => p.id === selectedProjectId)?.config_json?.folders?.map(f => (
                                        <option key={f} value={f}>{f}</option>
                                    ))}
                                </select>
                            </>
                        )}
                    </div>

                    <div className="flex-1 min-h-[350px] flex flex-col">
                        <ScrollArea className="flex-1 bg-surface-raised p-4 rounded-md border border-border text-sm">
                            {/* Show project folder images when project & folder selected */}
                            {selectedProjectId && selectedFolder && projectFolderImages.length > 0 && (
                                <div className="grid grid-cols-5 gap-3">
                                    {projectFolderImages.map((img) => (
                                        <button
                                            key={img.path}
                                            type="button"
                                            onClick={() => selectGalleryImage(img.path)}
                                            className="aspect-square relative group bg-surface border border-border rounded-md overflow-hidden hover:ring-2 hover:ring-ring focus:outline-none"
                                        >
                                            <img
                                                loading="lazy"
                                                decoding="async"
                                                src={galleryThumbnailUrl(img.path)}
                                                alt={img.filename}
                                                className="w-full h-full object-cover"
                                            />
                                            {guessKindFromFilename(img.path) === "video" && (
                                                <div className="absolute left-1 top-1 rounded bg-black/60 p-1 text-white">
                                                    <VideoIcon className="h-3 w-3" />
                                                </div>
                                            )}
                                            <div className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[10px] p-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                                                {img.filename}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Show project gallery images when project selected but no specific folder */}
                            {selectedProjectId && !selectedFolder && projectGalleryImages.length > 0 && (
                                <div className="grid grid-cols-5 gap-3">
                                    {projectGalleryImages.map((path) => (
                                        <button
                                            key={path}
                                            type="button"
                                            onClick={() => selectGalleryImage(path)}
                                            className="aspect-square relative group bg-surface border border-border rounded-md overflow-hidden hover:ring-2 hover:ring-ring focus:outline-none"
                                        >
                                            <img
                                                loading="lazy"
                                                decoding="async"
                                                src={galleryThumbnailUrl(path)}
                                                alt="Project Gallery"
                                                className="w-full h-full object-cover"
                                            />
                                            {guessKindFromFilename(path) === "video" && (
                                                <div className="absolute left-1 top-1 rounded bg-black/60 p-1 text-white">
                                                    <VideoIcon className="h-3 w-3" />
                                                </div>
                                            )}
                                            <div className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[10px] p-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                                                {getBasename(path)}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Loading indicator for project images */}
                            {selectedProjectId && isLoadingProjectImages && (
                                <div className="text-center text-muted-foreground py-8 flex flex-col items-center gap-2">
                                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                    <span>Loading images...</span>
                                </div>
                            )}

                            {/* Message when project selected but no images */}
                            {selectedProjectId && !selectedFolder && !isLoadingProjectImages && projectGalleryImages.length === 0 && (
                                <div className="text-center text-muted-foreground py-8">
                                    No images in this project
                                </div>
                            )}

                            {/* Message when folder selected but empty */}
                            {selectedProjectId && selectedFolder && !isLoadingProjectImages && projectFolderImages.length === 0 && (
                                <div className="text-center text-muted-foreground py-8">
                                    No images in this folder
                                </div>
                            )}

                            {/* Default: Recent Gallery view (when no project selected) */}
                            {!selectedProjectId && (
                                <>
                                    <div>
                                        <div className="grid grid-cols-5 gap-3">
                                            {galleryImages.map((path) => (
                                                <button
                                                    key={path}
                                                    type="button"
                                                    onClick={() => selectGalleryImage(path)}
                                                    className="aspect-square relative group bg-white border rounded-md overflow-hidden hover:ring-2 hover:ring-ring focus:outline-none"
                                                >
                                                    <img
                                                        loading="lazy"
                                                        decoding="async"
                                                        src={galleryThumbnailUrl(path)}
                                                        alt="Gallery"
                                                        className="w-full h-full object-cover"
                                                    />
                                                    {guessKindFromFilename(path) === "video" && (
                                                        <div className="absolute left-1 top-1 rounded bg-black/60 p-1 text-white">
                                                            <VideoIcon className="h-3 w-3" />
                                                        </div>
                                                    )}
                                                    <div className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[10px] p-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                                                        {getBasename(path)}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}
                        </ScrollArea>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Mask Editor */}
            <InpaintEditor
                open={isMaskEditorOpen}
                onOpenChange={setIsMaskEditorOpen}
                imageUrl={currentImageUrl}
                onSave={handleMaskSave}
            />
        </div>
    );

    if (!compact) {
        return renderExpanded(false);
    }

    return (
        <Popover open={hoverOpen} onOpenChange={setHoverOpen}>
            <PopoverAnchor asChild>
                <div
                    className={cn(
                        "flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2 bg-surface-raised transition-colors",
                        isDragging ? "border-ring bg-accent/40" : "border-border hover:bg-hover"
                    )}
                    tabIndex={0}
                    onPointerEnter={() => requestHoverOpen()}
                    onPointerLeave={() => requestHoverClose()}
                    onFocus={() => requestHoverOpen(true)}
                    onBlur={(e) => {
                        if (focusWithin(e.relatedTarget as Element | null)) return;
                        requestHoverClose();
                    }}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        {isVideoPreview ? (
                            <VideoIcon className="h-4 w-4 text-muted-foreground" />
                        ) : (
                            <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-xs text-foreground/80 truncate" title={displayValue}>
                            {displayValue}
                        </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        {hasValue ? "hover preview" : "hover to select"}
                    </span>
                </div>
            </PopoverAnchor>
            <PopoverContent
                ref={popoverContentRef}
                side="right"
                align="start"
                sideOffset={12}
                className="w-[360px] max-h-[75vh] overflow-y-auto p-3 shadow-md border border-border"
                onPointerEnter={holdHoverOpen}
                onPointerLeave={requestHoverClose}
                onFocusCapture={holdHoverOpen}
                onBlurCapture={(e) => {
                    if (focusWithin(e.relatedTarget as Element | null)) return;
                    requestHoverClose();
                }}
                onOpenAutoFocus={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => e.preventDefault()}
            >
                {renderExpanded(false)}
            </PopoverContent>
        </Popover>
    );
}


