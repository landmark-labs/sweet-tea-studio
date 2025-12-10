import React, { useEffect, useMemo, useState } from "react";
import { api, PromptLibraryItem, PromptSuggestion } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Trash2, Search, LayoutTemplate, Sparkles, Copy, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function PromptLibrary() {
    const [prompts, setPrompts] = useState<PromptLibraryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [tagInput, setTagInput] = useState("");
    const [expandedPrompt, setExpandedPrompt] = useState<string>("");
    const [expanding, setExpanding] = useState(false);
    const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);
    const [vlmEnabled, setVlmEnabled] = useState(false);
    const [vlmError, setVlmError] = useState<string | null>(null);

    useEffect(() => {
        loadPrompts();
        api.vlmHealth().then(status => {
            setVlmEnabled(status.loaded || false);
            if (status.error) setVlmError(String(status.error));
        }).catch(() => {
            setVlmEnabled(false);
            setVlmError("Service unreachable");
        });
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
            setPrompts(prev => prev.filter(p => p.prompt_id !== id));
        } catch (e) {
            alert("Failed to delete prompt");
        }
    };

    const filteredPrompts = useMemo(() => {
        if (!searchQuery) return prompts;
        const needle = searchQuery.toLowerCase();
        return prompts.filter((p) => {
            const haystack = [
                p.active_positive || "",
                p.active_negative || "",
                p.caption || "",
                p.prompt_history.map((stage) => `${stage.positive_text || ""} ${stage.negative_text || ""}`).join(" "),
                p.tags.join(" "),
                p.prompt_name || "",
            ]
                .join(" ")
                .toLowerCase();

            return haystack.includes(needle);
        });
    }, [prompts, searchQuery]);

    if (isLoading) return <div className="p-8">Loading library...</div>;

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
                        disabled={!vlmEnabled}
                    />
                    <Button
                        onClick={handleExpandTags}
                        disabled={expanding || !vlmEnabled}
                        variant={vlmEnabled ? "default" : "secondary"}
                        title={!vlmEnabled ? "VLM Model not loaded. Run backend/download_models.py" : "Generate Prompt"}
                    >
                        {expanding ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Dreaming...
                            </>
                        ) : !vlmEnabled ? (
                            "VLM Offline"
                        ) : (
                            <>
                                <Wand2 className="w-4 h-4 mr-2" />
                                Expand
                            </>
                        )}
                    </Button>
                </div>
                {vlmError && !vlmEnabled && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded text-xs text-red-600">
                        <p className="font-semibold mb-1">VLM Backend Offline</p>
                        <p>The vision/language models are not loaded. Please run the download script in the backend folder to enable this feature.</p>
                    </div>
                )}
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
                        key={prompt.image_id}
                        className="flex items-center gap-4 p-4 bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-all group"
                    >
                        {/* Thumbnail */}
                        <div className="w-16 h-16 flex-none bg-slate-100 rounded overflow-hidden relative">
                            {prompt.preview_path ? (
                                <img
                                    src={`/api/v1/gallery/image/path?path=${encodeURIComponent(prompt.preview_path)}`}
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
                        <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
                                <span className="font-semibold truncate">
                                    {prompt.job_params?.project_name || prompt.prompt_name || `Image #${prompt.image_id}`}
                                </span>
                                <span className="text-[11px] text-slate-500">#{prompt.image_id}</span>
                                {prompt.workflow_template_id && (
                                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[11px] text-slate-600 font-medium">
                                        Pipe {prompt.workflow_template_id}
                                    </span>
                                )}
                            </div>

                            {(prompt.active_positive || prompt.active_negative) && (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {prompt.active_positive && (
                                        <div className="min-w-0">
                                            <p className="text-[11px] uppercase tracking-wide text-green-600 font-semibold mb-1">Positive</p>
                                            <p className="text-xs text-slate-700 leading-relaxed line-clamp-3">{prompt.active_positive}</p>
                                        </div>
                                    )}
                                    {prompt.active_negative && (
                                        <div className="min-w-0">
                                            <p className="text-[11px] uppercase tracking-wide text-rose-500 font-semibold mb-1">Negative</p>
                                            <p className="text-xs text-rose-600 leading-relaxed line-clamp-3">{prompt.active_negative}</p>
                                        </div>
                                    )}
                                </div>
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
                            {prompt.prompt_history.length > 1 && (
                                <div className="mt-2 space-y-1">
                                    <p className="text-[11px] text-slate-500">Prompt history:</p>
                                    {prompt.prompt_history.slice(0, 3).map((stage) => (
                                        <p key={`${prompt.image_id}-${stage.stage}`} className="text-[11px] text-slate-600 line-clamp-1">
                                            #{stage.stage} {stage.positive_text}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="flex-none opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => prompt.prompt_id && handleDelete(prompt.prompt_id)}
                                className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                disabled={!prompt.prompt_id}
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
