import React from "react";
import { Download, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";

interface ImageViewerProps {
    imagePath: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: any;
}

export function ImageViewer({ imagePath, metadata }: ImageViewerProps) {
    if (!imagePath) {
        return (
            <div className="h-full flex items-center justify-center bg-slate-100 text-slate-400">
                Select an image to view
            </div>
        );
    }

    const imageUrl = `/api/v1/gallery/image/path?path=${encodeURIComponent(imagePath)}`;

    const handleDownload = async () => {
        try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = imagePath.split(/[\\/]/).pop() || "image.png";
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (e) {
            console.error("Download failed", e);
        }
    };

    return (
        <div className="h-full flex flex-col bg-white">
            <div className="flex-1 flex items-center justify-center p-8 overflow-hidden bg-slate-900/5 backdrop-blur-3xl">
                <img
                    src={imageUrl}
                    className="max-w-full max-h-full object-contain shadow-2xl rounded-lg"
                    alt="Preview"
                />
            </div>
            <div className="p-6 border-t bg-white h-64 overflow-y-auto">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 truncate max-w-md">
                            {imagePath.split(/[\\/]/).pop()}
                        </h2>
                        <p className="text-sm text-slate-500">
                            {metadata?.created_at ? new Date(metadata.created_at).toLocaleString() : "External File"}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={handleDownload}>
                            <Download className="w-4 h-4 mr-2" /> Download
                        </Button>
                    </div>
                </div>

                {metadata && (
                    <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
                        {metadata.prompt && (
                            <div className="col-span-2">
                                <span className="font-semibold text-slate-700 block mb-1">Prompt</span>
                                <p className="text-slate-600 bg-slate-50 p-2 rounded border">{metadata.prompt}</p>
                            </div>
                        )}
                        {metadata.job_params && (
                            <>
                                {Object.entries(metadata.job_params).map(([k, v]) => (
                                    <div key={k}>
                                        <span className="font-semibold text-slate-700 capitalize">{k.replace(/_/g, ' ')}:</span>
                                        <span className="ml-2 text-slate-600">{String(v)}</span>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
