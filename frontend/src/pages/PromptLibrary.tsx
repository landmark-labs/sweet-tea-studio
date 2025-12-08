import React, { useEffect, useState } from "react";
import { api, Prompt, PromptSuggestion } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Trash2, Search, LayoutTemplate, Sparkles, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function PromptLibrary() {
    const [prompts, setPrompts] = useState<Prompt[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [tagInput, setTagInput] = useState("");
    const [expandedPrompt, setExpandedPrompt] = useState<string>("");
    const [expanding, setExpanding] = useState(false);
    const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);

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

    const fetchSuggestions = async (query: string) => {
        if (!query || query.length < 2) {
            setSuggestions([]);
            return;
        }

        try {
            const hints = await api.getPromptSuggestions(query);
            setSuggestions(hints);
        } catch (err) {
            console.error(err);
        }
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        loadPrompts(searchQuery);
    };

    const handleExpandTags = async () => {
        const tags = tagInput.split(",").map(t => t.trim()).filter(Boolean);
        if (tags.length === 0) return;
        setExpanding(true);
        setError(null);
        setExpandedPrompt("");
        try {
            const res = await api.tagsToPrompt(tags);
            setExpandedPrompt(res.prompt);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to expand tags");
        } finally {
            setExpanding(false);
        }
    };

    const handleSearchChange = (value: string) => {
        setSearchQuery(value);
        fetchSuggestions(value);
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
                            onChange={(e) => handleSearchChange(e.target.value)}
                            list="prompt-suggestions"
                        />
                        <datalist id="prompt-suggestions">
                            {suggestions.map((s) => (
                                <option key={`${s.type}-${s.value}`} value={s.value} label={`${s.type} (${s.frequency})`} />
                            ))}
                        </datalist>
                    </div>
                </form>
            </div>

            {error && (
                <Alert variant="destructive" className="mb-6">
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            <div className="mb-6 p-4 border border-slate-200 rounded-lg bg-white shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-indigo-600" />
                    <h3 className="font-semibold text-slate-800">Tag → Prompt</h3>
                </div>
                <p className="text-xs text-slate-500 mb-3">Paste comma-separated tags and let the VLM expand them into a prompt.</p>
                <div className="flex gap-2">
                    <Input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        placeholder="e.g. cyberpunk, rainy night, neon lights"
                    />
                    <Button onClick={handleExpandTags} disabled={expanding}>
                        <Sparkles className="w-4 h-4 mr-1" />
                        {expanding ? "Expanding..." : "Expand"}
                    </Button>
                </div>
                {expandedPrompt && (
                    <div className="mt-3 p-3 bg-indigo-50 border border-indigo-100 rounded flex items-start justify-between gap-2">
                        <p className="text-sm text-indigo-900 flex-1">{expandedPrompt}</p>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigator.clipboard.writeText(expandedPrompt)}
                            title="Copy prompt"
                        >
                            <Copy className="w-4 h-4" />
                        </Button>
                    </div>
                )}
            </div>

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
                            {prompt.positive_text && (
                                <p className="text-xs text-slate-600 mt-1 line-clamp-1">{prompt.positive_text}</p>
                            )}
                            {prompt.tags && prompt.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                    {prompt.tags.map((tag) => (
                                        <span
                                            key={tag}
                                            className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded border border-indigo-100 text-[11px]"
                                        >
                                            #{tag}
                                        </span>
                                    ))}
                                </div>
                            )}
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
