import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X, Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface ImageUploadProps {
    value?: string;
    onChange: (value: string) => void;
    engineId?: string;
}

export function ImageUpload({ value, onChange, engineId }: ImageUploadProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const processFile = async (file: File) => {
        // Create local preview
        const objectUrl = URL.createObjectURL(file);
        setPreview(objectUrl);

        setIsUploading(true);
        try {
            const id = engineId ? parseInt(engineId) : undefined;
            const result = await api.uploadFile(file, id);
            onChange(result.filename);
            console.log("Uploaded:", result);
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

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            await processFile(e.dataTransfer.files[0]);
        } else {
            // Try to handle URL drop (from gallery)
            const url = e.dataTransfer.getData("text/plain");
            if (url) {
                setIsUploading(true);
                try {
                    const response = await fetch(url);
                    const blob = await response.blob();
                    // Guess filename
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
        onChange("");
    };

    return (
        <div className="space-y-2">
            {!preview && !value ? (
                <div
                    className={`flex items-center gap-2 border-2 border-dashed rounded-lg p-2 transition-colors ${isDragging ? "border-primary bg-primary/10" : "border-slate-200"}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => document.getElementById("file-upload")?.click()}
                        disabled={isUploading}
                        className="w-full h-24"
                    >
                        <div className="flex flex-col items-center gap-2">
                            {isUploading ? <Loader2 className="animate-spin" /> : <Upload className="h-6 w-6 text-slate-400" />}
                            <span className="text-sm text-slate-500">
                                {isUploading ? "Uploading..." : "Click or Drag Image Here"}
                            </span>
                        </div>
                    </Button>
                    <input
                        id="file-upload"
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={handleFileChange}
                    />
                </div>
            ) : (
                <div className="relative w-full h-48 bg-slate-100 rounded-lg overflow-hidden border">
                    <img
                        src={preview || ""}
                        alt="Uploaded input"
                        className="w-full h-full object-contain"
                    />
                    <div className="absolute top-2 right-2 flex gap-1">
                        <div className="bg-green-500 text-white p-1 rounded-full shadow">
                            <Check className="w-3 h-3" />
                        </div>
                        <button
                            type="button"
                            onClick={clear}
                            className="bg-red-500 text-white p-1 rounded-full shadow hover:bg-red-600"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                    {value && (
                        <div className="absolute bottom-0 w-full bg-black/50 text-white text-xs p-1 truncate text-center">
                            {value}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
