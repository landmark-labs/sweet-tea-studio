import { useEffect, useState } from "react";
import { api, GalleryItem } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Save, Trash2, Calendar, Terminal } from "lucide-react";

export default function Gallery() {
    const [items, setItems] = useState<GalleryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadGallery();
    }, []);

    const loadGallery = async () => {
        try {
            setIsLoading(true);
            const data = await api.getGallery();
            setItems(data);
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : "Failed to load gallery");
        } finally {
            setIsLoading(false);
        }
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

        try {
            await api.savePrompt({
                workflow_id: 1, // TODO: Store workflow_id in Job metadata? Assuming 1 for now or derive from job
                name: name,
                description: `Saved from Gallery Image #${item.image.id}`,
                parameters: item.job_params,
                preview_image_path: item.image.path
            });
            alert("Prompt saved to library!");
        } catch (err) {
            alert("Failed to save prompt");
        }
    };

    if (isLoading) return <div className="p-8">Loading gallery...</div>;

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-8">Generated Gallery</h1>

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
                        <Card key={item.image.id} className="group overflow-hidden flex flex-col">
                            <div className="relative aspect-square bg-slate-100">
                                {/* 
                  TODO: The api returns a local file path. Browsers cannot load local paths directly 
                  due to security. We need a way to serve these images.
                  For v0, we can use a specialized backend endpoint to serve the image content,
                  OR just use the 'save to static' approach using 'http-server' or similar.
                  
                  Given the user is local, we can implement an endpoint `GET /api/v1/images/{id}`
                  that streams the file content.
                  
                  Let's assume we will build `GET /images/{id}` endpoint next.
                  For now, let's use a placeholder or assume the backend serves it.
                  The backend has `comfy_client.get_images` which returns a URL?
                  Actually ComfyUI returns a view URL.
                  But we are storing the local path.
                  
                  Let's create a Serve Image endpoint in backend.
                 */}
                                <img
                                    src={`/api/v1/gallery/image/${item.image.id}`}
                                    alt={item.image.filename}
                                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).src = "https://placehold.co/400x400?text=Missing+File";
                                    }}
                                />

                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                    <Button
                                        variant="secondary"
                                        size="icon"
                                        onClick={() => handleSavePrompt(item)}
                                        title="Save Prompt to Library"
                                    >
                                        <Save className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        size="icon"
                                        onClick={() => handleDelete(item.image.id)}
                                        title="Delete"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>

                            <CardContent className="p-4 text-xs space-y-2 bg-white flex-1">
                                <div className="flex items-center gap-2 text-slate-500">
                                    <Calendar className="w-3 h-3" />
                                    <span>{new Date(item.created_at).toLocaleString()}</span>
                                </div>
                                {item.prompt && (
                                    <p className="line-clamp-2 italic text-slate-600">
                                        "{item.prompt}"
                                    </p>
                                )}
                                <div className="flex flex-wrap gap-1 mt-2">
                                    {Object.entries(item.job_params).slice(0, 4).map(([k, v]) => (
                                        <span key={k} className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500 border border-slate-200">
                                            {k}: {String(v)}
                                        </span>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
