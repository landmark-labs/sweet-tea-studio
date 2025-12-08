import React, { useEffect, useState } from "react";
import { api, Prompt } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Trash2, Search, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function PromptLibrary() {
    const [prompts, setPrompts] = useState<Prompt[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        loadPrompts();
    }, []);

    const loadPrompts = async (query?: string) => {
        try {
            setIsLoading(true);
            const data = await api.getPrompts(query);
            setPrompts(data);
        } catch (err) {
            setError("Failed to load prompts");
        } finally {
            setIsLoading(false);
        }
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        loadPrompts(searchQuery);
    };

    const handleDelete = async (id: number) => {
        if (!confirm("Are you sure you want to delete this prompt?")) return;
        try {
            await api.deletePrompt(id);
            setPrompts(prev => prev.filter(p => p.id !== id));
        } catch (e) {
            alert("Failed to delete prompt");
        }
    };

    if (isLoading) return <div className="p-8">Loading library...</div>;

    const filteredPrompts = prompts;

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">Prompt Library</h1>
                <form onSubmit={handleSearch} className="flex gap-2 w-full max-w-sm">
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                        <Input
                            type="search"
                            placeholder="Search prompts..."
                            className="pl-9"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
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

            <div className="space-y-4">
                {filteredPrompts.map((prompt) => (
                    <div
                        key={prompt.id}
                        className="flex items-center gap-4 p-4 bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-all group"
                    >
                        {/* Thumbnail */}
                        <div className="w-16 h-16 flex-none bg-slate-100 rounded overflow-hidden relative">
                            {prompt.related_images && prompt.related_images.length > 0 ? (
                                <img
                                    src={`/api/v1/gallery/image/path?path=${encodeURIComponent(prompt.related_images[0])}`}
                                    className="w-full h-full object-cover"
                                    alt="Prompt thumbnail"
                                />
                            ) : prompt.preview_image_path ? (
                                <img
                                    src={`/api/v1/gallery/image/path?path=${encodeURIComponent(prompt.preview_image_path)}`}
                                    className="w-full h-full object-cover"
                                    alt="Prompt preview"
                                />
                            ) : (
                                <div className="flex items-center justify-center h-full text-slate-300">
                                    <LayoutTemplate className="w-6 h-6" />
                                </div>
                            )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-semibold text-slate-900 truncate">{prompt.name}</h3>
                                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-xs text-slate-600 font-medium">
                                    Workflow #{prompt.workflow_id}
                                </span>
                            </div>
                            <p className="text-sm text-slate-500 truncate">{prompt.description || "No description"}</p>
                            {/* Mini Params */}
                            <div className="flex gap-4 mt-2 text-xs text-slate-400">
                                {prompt.parameters.steps && <span>Steps: {prompt.parameters.steps}</span>}
                                {prompt.parameters.cfg && <span>CFG: {prompt.parameters.cfg}</span>}
                                {prompt.parameters.sampler_name && <span>{prompt.parameters.sampler_name}</span>}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex-none opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(prompt.id)}
                                className="text-red-500 hover:text-red-600 hover:bg-red-50"
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                ))}

                {filteredPrompts.length === 0 && (
                    <div className="text-center py-12 text-slate-500">
                        No prompts found matching your search.
                    </div>
                )}
            </div>
        </div>
    );
}
