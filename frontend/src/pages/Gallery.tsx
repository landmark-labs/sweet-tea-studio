import { useEffect, useState } from "react";
import { api, GalleryItem } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Save, Trash2, Calendar, Search, Sparkles, RotateCcw, Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";

export default function Gallery() {
    const [items, setItems] = useState<GalleryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [captioningId, setCaptioningId] = useState<number | null>(null);
    const [search, setSearch] = useState("");
    const navigate = useNavigate();

    useEffect(() => {
        loadGallery();
    }, []);

    const loadGallery = async (query?: string) => {
        try {
            setIsLoading(true);
            const data = await api.getGallery(query);
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
        loadGallery(search);
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
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">Generated Gallery</h1>

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
                        <Card
                            key={item.image.id}
                            className="group overflow-hidden flex flex-col relative"
                            onContextMenu={(e) => {
                                e.preventDefault();
                                handleRegenerate(item);
                            }}
                        >
                            <div className="relative aspect-square bg-slate-100">
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
                                        variant="secondary"
                                        size="icon"
                                        onClick={() => handleCaption(item)}
                                        disabled={captioningId === item.image.id}
                                        title="Generate caption"
                                    >
                                        <Sparkles className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="icon"
                                        onClick={() => handleRegenerate(item)}
                                        title="Regenerate"
                                    >
                                        <RotateCcw className="w-4 h-4" />
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

                                {item.prompt_name && (
                                    <p className="text-[11px] uppercase tracking-wide text-slate-500">{item.prompt_name}</p>
                                )}

                                {item.prompt && (
                                    <p className="line-clamp-2 italic text-slate-700">
                                        "{item.prompt}"
                                    </p>
                                )}

                                {item.caption && (
                                    <p className="text-slate-600 line-clamp-2">{item.caption}</p>
                                )}

                                {item.prompt_tags && item.prompt_tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {item.prompt_tags.slice(0, 6).map((tag) => (
                                            <span
                                                key={tag}
                                                className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded"
                                            >
                                                #{tag}
                                            </span>
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
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-4 w-4 opacity-0 group-hover/prompt:opacity-100 transition-opacity"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                navigator.clipboard.writeText(positive);
                                                            }}
                                                            title="Copy Positive Prompt"
                                                        >
                                                            <Copy className="h-3 w-3 text-slate-400 hover:text-green-600" />
                                                        </Button>
                                                    </div>
                                                    <p className="line-clamp-3 text-slate-700 leading-relaxed" title={positive}>
                                                        {positive}
                                                    </p>
                                                </div>
                                            )}
                                            {negative && (
                                                <div className="group/prompt pt-2 border-t border-slate-100">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="font-semibold text-red-500 block text-[10px] uppercase">Negative</span>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-4 w-4 opacity-0 group-hover/prompt:opacity-100 transition-opacity"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                navigator.clipboard.writeText(negative);
                                                            }}
                                                            title="Copy Negative Prompt"
                                                        >
                                                            <Copy className="h-3 w-3 text-slate-400 hover:text-red-500" />
                                                        </Button>
                                                    </div>
                                                    <p className="line-clamp-2 text-slate-500 leading-relaxed" title={negative}>
                                                        {negative}
                                                    </p>
                                                </div>
                                            )}
                                            {!positive && !negative && (
                                                <div className="flex flex-wrap gap-1 mt-2">
                                                    {Object.entries(item.job_params).slice(0, 4).map(([k, v]) => (
                                                        <span key={k} className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500 border border-slate-200">
                                                            {k}: {String(v)}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
