import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X, Loader2, Grid, PenTool } from "lucide-react";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { InpaintEditor } from "@/components/InpaintEditor";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

interface ImageUploadProps {
    value?: string;
    onChange: (value: string) => void;
    engineId?: string;
    options?: string[]; // List of available files from ComfyUI
    projectSlug?: string; // If provided, uploads go to /ComfyUI/input/<project>/
    destinationFolder?: string; // If provided with projectSlug, uploads go to /ComfyUI/input/<project>/<folder>/
    mediaKind?: "image" | "video" | "any";
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

export function ImageUpload({
    value,
    onChange,
    engineId,
    options = [],
    projectSlug,
    destinationFolder,
    mediaKind = "image",
}: ImageUploadProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);
    const [previewKind, setPreviewKind] = useState<"image" | "video" | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isBrowseOpen, setIsBrowseOpen] = useState(false);
    const [recent, setRecent] = useState<string[]>([]);
    const [galleryImages, setGalleryImages] = useState<string[]>([]);

    // Mask Editor State
    const [isMaskEditorOpen, setIsMaskEditorOpen] = useState(false);
    const objectUrlRef = useRef<string | null>(null);

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

    useEffect(() => {
        if (isBrowseOpen) {
            // Load gallery images for the "Output" tab
            api.getGallery({ limit: 25, includeThumbnails: false }).then(items => {
                // Sort by created_at desc (newest first)
                const sorted = items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                setGalleryImages(sorted.slice(0, 25).map(i => i.image.path));
            }).catch(console.error);
        }
    }, [isBrowseOpen]);

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
                const relativePath = inputDirMatch[1].replace(/\\/g, '/'); // Normalize to forward slashes
                console.log(`[ImageUpload] Using existing input path: ${relativePath}`);
                onChange(relativePath);
                addToRecent(relativePath);
                setPreviewKind(guessKindFromFilename(relativePath));

                // Set preview from the original path
                const previewUrl = `/api/v1/gallery/image/path?path=${encodeURIComponent(sweetTeaPath)}`;
                setPreview(previewUrl);
                return;
            }

            // Image is NOT in input dir (e.g., from /sweet_tea/project/output/)
            // Need to copy it to input dir for LoadImage access
            setIsUploading(true);
            try {
                const url = `/api/v1/gallery/image/path?path=${encodeURIComponent(sweetTeaPath)}`;
                const res = await fetch(url);
                const blob = await res.blob();
                const filename = sweetTeaPath.split(/[\\/]/).pop() || "dropped_image.png";
                const file = new File([blob], filename, { type: blob.type });
                await processFile(file);
            } catch (err) {
                console.error("Failed to process dropped Sweet Tea image", err);
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

    const selectOption = (filename: string) => {
        onChange(filename);
        addToRecent(filename);
        setIsBrowseOpen(false);
        setPreview(null); // Clear local preview forcing usage of filename
        setPreviewKind(guessKindFromFilename(filename));
    };

    const clear = () => {
        setPreview(null);
        setPreviewKind(null);
        onChange("");
    };

    const selectGalleryImage = async (path: string) => {
        // "Upload" it by fetching blob and re-uploading to input dir
        setIsUploading(true);
        try {
            const url = `/api/v1/gallery/image/path?path=${encodeURIComponent(path)}`;
            const res = await fetch(url);
            const blob = await res.blob();
            const filename = path.split(/[\\/]/).pop() || "gallery_image.png";
            const file = new File([blob], filename, { type: blob.type });
            await processFile(file);
            setIsBrowseOpen(false);
        } catch (e) {
            console.error("Failed to copy gallery image", e);
        } finally {
            setIsUploading(false);
        }
    };

    const handleMaskSave = async (maskFile: File) => {
        try {
            const id = engineId ? parseInt(engineId) : undefined;
            const result = await api.uploadFile(maskFile, id);

            addToRecent(result.filename);
            alert(`Mask saved: ${result.filename}`);
        } catch (e) {
            console.error("Mask upload failed", e);
            alert("Failed to upload mask");
        }
    };

    // Filter "valid" recents (that actually exist in current options if options provided)
    // If options are empty (no connection), we show all recent.
    const displayRecent = (options.length > 0
        ? recent.filter(r => options.includes(r))
        : recent).slice(0, 5);

    const accept = mediaKind === "video" ? "video/*" : mediaKind === "any" ? "image/*,video/*" : "image/*";
    const browseTitle = mediaKind === "video" ? "Browse Videos" : mediaKind === "any" ? "Browse Media" : "Browse Images";
    const resolvedKind = previewKind || (value ? guessKindFromFilename(value) : null) || (mediaKind === "video" ? "video" : "image");
    const isVideoPreview = resolvedKind === "video";

    // Calculate current media URL for editor
    const currentMediaUrl = preview || (value ? `/api/v1/gallery/image/path?path=${encodeURIComponent(value)}` : "");
    const currentImageUrl = isVideoPreview ? "" : currentMediaUrl;

    return (
        <div className="space-y-3">
            {!preview && !value ? (
                <div
                    className={cn(
                        "flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 transition-colors gap-4",
                        isDragging ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                    )}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div className="flex flex-col items-center gap-2 text-center">
                        {isUploading ? <Loader2 className="h-8 w-8 animate-spin text-blue-500" /> : <Upload className="h-8 w-8 text-slate-300" />}
                        <div className="text-sm text-slate-600">
                            {isUploading ? "Uploading..." : "Click to upload or drag & drop"}
                        </div>
                    </div>

                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => document.getElementById("file-upload")?.click()}
                        disabled={isUploading}
                    >
                        Select File
                    </Button>
                    <input
                        id="file-upload"
                        type="file"
                        className="hidden"
                        accept={accept}
                        onChange={handleFileChange}
                    />

                    {/* Recent & Browse */}
                    {displayRecent.length > 0 && (
                        <div className="w-full pt-4 border-t flex flex-col gap-2">
                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recent</span>
                            <div className="flex flex-wrap gap-2">
                                {displayRecent.map(r => (
                                    <HoverCard key={r}>
                                        <HoverCardTrigger asChild>
                                            <button
                                                type="button"
                                                onClick={() => selectOption(r)}
                                                className="text-xs bg-white border px-2 py-1 rounded shadow-sm hover:border-blue-400 truncate max-w-[120px]"
                                            >
                                                {r}
                                            </button>
                                        </HoverCardTrigger>
                                        <HoverCardContent className="w-48 p-0 overflow-hidden rounded-md border shadow-lg">
                                            {guessKindFromFilename(r) === "video" ? (
                                                <video
                                                    src={`/api/v1/gallery/image/path?path=${encodeURIComponent(r)}`}
                                                    className="w-full h-auto object-contain bg-slate-950"
                                                    preload="metadata"
                                                    muted
                                                    playsInline
                                                />
                                            ) : (
                                                <img
                                                    src={`/api/v1/gallery/image/path?path=${encodeURIComponent(r)}`}
                                                    alt={r}
                                                    className="w-full h-auto object-contain bg-slate-950"
                                                />
                                            )}
                                            <div className="p-2 bg-white text-[10px] text-center truncate">
                                                {r}
                                            </div>
                                        </HoverCardContent>
                                    </HoverCard>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="w-full pt-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => setIsBrowseOpen(true)}
                        >
                            <Grid className="w-3 h-3 mr-2" /> Browse Library
                        </Button>
                    </div>
                </div>
            ) : (
                <div
                    className={cn(
                        "relative w-full h-48 bg-slate-100 rounded-lg overflow-hidden border group transition-colors",
                        isDragging ? "border-blue-500 ring-2 ring-blue-500 ring-opacity-50" : ""
                    )}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {/* Overlay for drop indication */}
                    {isDragging && (
                        <div className="absolute inset-0 bg-blue-500/20 z-10 flex items-center justify-center">
                            <div className="bg-white/90 p-2 rounded-full shadow-lg">
                                <Upload className="h-6 w-6 text-blue-600" />
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
                                className="bg-white/90 text-slate-700 p-1.5 rounded-full shadow hover:bg-blue-50 hover:text-blue-600 transition-colors"
                                title="Draw Mask (In-Painting)"
                            >
                                <PenTool className="w-4 h-4" />
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={clear}
                            className="bg-white/90 text-red-500 p-1.5 rounded-full shadow hover:bg-red-50 transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="absolute bottom-0 w-full bg-black/60 text-white text-xs p-2 truncate text-center backdrop-blur-sm z-20">
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

                    <div className="flex-1 min-h-[400px] flex flex-col gap-4">
                        <ScrollArea className="flex-1 bg-slate-50 p-4 rounded-md border text-sm">
                            {(options.length > 0) && (
                                <div className="mb-6">
                                    <h4 className="font-semibold mb-2 text-slate-500 uppercase text-xs">Input Directory (Last 25)</h4>
                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                                        {options.slice(0, 25).map(opt => (
                                            <button
                                                key={opt}
                                                type="button"
                                                onClick={() => selectOption(opt)}
                                                className="aspect-square relative group bg-white border rounded-md overflow-hidden hover:ring-2 hover:ring-blue-500 focus:outline-none"
                                            >
                                                {guessKindFromFilename(opt) === "video" ? (
                                                    <video
                                                        src={`/api/v1/gallery/image/path?path=${encodeURIComponent(opt)}`}
                                                        className="w-full h-full object-cover"
                                                        preload="metadata"
                                                        muted
                                                        playsInline
                                                    />
                                                ) : (
                                                    <img
                                                        loading="lazy"
                                                        src={`/api/v1/gallery/image/path?path=${encodeURIComponent(opt)}`}
                                                        alt={opt}
                                                        className="w-full h-full object-cover"
                                                    />
                                                )}
                                                <div className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[10px] p-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {opt}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div>
                                <h4 className="font-semibold mb-2 text-slate-500 uppercase text-xs">Gallery (Output)</h4>
                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                                    {galleryImages.map((path, i) => (
                                        <button
                                            key={i}
                                            type="button"
                                            onClick={() => selectGalleryImage(path)}
                                            className="aspect-square relative group bg-white border rounded-md overflow-hidden hover:ring-2 hover:ring-green-500 focus:outline-none"
                                        >
                                            {guessKindFromFilename(path) === "video" ? (
                                                <video
                                                    src={`/api/v1/gallery/image/path?path=${encodeURIComponent(path)}`}
                                                    className="w-full h-full object-cover"
                                                    preload="metadata"
                                                    muted
                                                    playsInline
                                                />
                                            ) : (
                                                <img
                                                    loading="lazy"
                                                    src={`/api/v1/gallery/image/path?path=${encodeURIComponent(path)}`}
                                                    alt="Gallery"
                                                    className="w-full h-full object-cover"
                                                />
                                            )}
                                            <div className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[10px] p-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                                                {path.split(/[\\/]/).pop()}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
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
}
