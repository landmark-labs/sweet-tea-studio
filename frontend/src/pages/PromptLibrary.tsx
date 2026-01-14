import React, { useEffect, useMemo, useState } from "react";
import { api, PromptSuggestion, WorkflowTemplate, IMAGE_API_BASE } from "@/lib/api";
import { isVideoFile } from "@/lib/media";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Trash2, Search, LayoutTemplate, Sparkles, Copy, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePromptLibraryStore } from "@/lib/stores/promptDataStore";
import { savePipeParams } from "@/lib/persistedState";

export default function PromptLibrary() {
    const { prompts, searchQuery, setSearchQuery, setPrompts, shouldRefetch, lastWorkflowId, lastQuery } = usePromptLibraryStore();
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tagInput, setTagInput] = useState("");
    const [expandedPrompt, setExpandedPrompt] = useState<string>("");
    const [expanding, setExpanding] = useState(false);
    const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);
    const [vlmEnabled, setVlmEnabled] = useState(false);
    const [vlmError, setVlmError] = useState<string | null>(null);
    const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);

    useEffect(() => {
        loadPrompts();
        api.vlmHealth().then(status => {
            setVlmEnabled(status.loaded || false);
            if (status.error) setVlmError(String(status.error));
        }).catch(() => {
            setVlmEnabled(false);
            setVlmError("Service unreachable");
        });
        // Load workflows for pipe name lookup
        api.getWorkflows().then(setWorkflows).catch(console.error);
    }, []);

    const loadPrompts = async (query?: string) => {
        try {
            setIsLoading(true);
            const search = query ?? searchQuery;
            if (!shouldRefetch(undefined, search)) {
                setIsLoading(false);
                return;
            }
            const data = await api.getPrompts(search);
            setPrompts(data, null, search);
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
            setPrompts(prompts.filter(p => p.prompt_id !== id), lastWorkflowId, lastQuery);
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
        <div className="h-full overflow-auto p-8 max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold tracking-tight">prompt library</h1>
                <form onSubmit={handleSearch} className="flex gap-2 w-full max-w-sm">
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
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

            <div className="mb-6 p-4 border border-border rounded-lg bg-card shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-indigo-600" />
                    <h3 className="font-semibold text-foreground">Tag → Prompt</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-3">Paste comma-separated tags and let the VLM expand them into a prompt.</p>
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
                    <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive">
                        <p className="font-semibold mb-1">VLM Backend Offline</p>
                        <p>The vision/language models are not loaded. Please run the download script in the backend folder to enable this feature.</p>
                    </div>
                )}
                {expandedPrompt && (
                    <div className="mt-3 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded flex items-start justify-between gap-2">
                        <p className="text-sm text-indigo-700 dark:text-indigo-200 flex-1">{expandedPrompt}</p>
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
                {filteredPrompts.map((prompt) => {
                    const key =
                        prompt.prompt_id !== undefined && prompt.prompt_id !== null
                            ? `prompt-${prompt.prompt_id}`
                            : `img-${prompt.image_id}-${prompt.prompt_name || prompt.created_at || Math.random().toString(36).slice(2)}`;
                    const pipeName = prompt.workflow_template_id
                        ? (workflows.find(w => w.id === prompt.workflow_template_id)?.name || `Pipe ${prompt.workflow_template_id}`)
                        : null;

                    const handleCopyToConfigurator = () => {
                        // Store the prompt params for the configurator to pick up
                        if (prompt.job_params && prompt.workflow_template_id) {
                            void savePipeParams(String(prompt.workflow_template_id), prompt.job_params as Record<string, unknown>);
                            localStorage.setItem("ds_selected_workflow", String(prompt.workflow_template_id));
                            alert("Prompt copied to configurator! Navigate to Generation page to use it.");
                        }
                    };

                    return (
                        <div
                            key={key}
                            className="flex items-start gap-3 p-3 bg-card rounded-lg border border-border shadow-sm hover:shadow-md transition-all group"
                        >
                            {/* Thumbnail */}
                            <div className="w-16 h-16 flex-none bg-muted/40 rounded overflow-hidden relative">
                                {prompt.preview_path ? (
                                    isVideoFile(prompt.preview_path) ? (
                                        <video
                                            src={`${IMAGE_API_BASE}/gallery/image/path?path=${encodeURIComponent(prompt.preview_path)}`}
                                            className="w-full h-full object-cover"
                                            preload="metadata"
                                            muted
                                            playsInline
                                        />
                                    ) : (
                                        <img
                                            src={`${IMAGE_API_BASE}/gallery/image/path?path=${encodeURIComponent(prompt.preview_path)}`}
                                            className="w-full h-full object-cover"
                                            alt="Prompt preview"
                                        />
                                    )
                                ) : (
                                    <div className="flex items-center justify-center h-full text-muted-foreground/40">
                                        <LayoutTemplate className="w-5 h-5" />
                                    </div>
                                )}
                            </div>

                            {/* Project + Pipe Name */}
                            <div className="flex-none w-24 min-w-0 space-y-0.5">
                                <div className="text-[11px] font-semibold text-foreground/80 truncate" title={prompt.project_name || "No project"}>
                                    {prompt.project_name || <span className="text-muted-foreground">No project</span>}
                                </div>
                                {pipeName && (
                                    <div className="text-[10px] text-blue-600 truncate font-medium" title={pipeName}>
                                        {pipeName}
                                    </div>
                                )}
                            </div>

                            {/* Prompts Side-by-Side - 75% positive, 25% negative */}
                            <div className="flex-1 flex gap-2 min-w-0">
                                <div className="min-w-0 bg-emerald-500/10 rounded p-1.5 border border-emerald-500/20" style={{ flex: '3 1 0%' }}>
                                    <p className="text-[10px] text-emerald-700 dark:text-emerald-300 leading-relaxed line-clamp-4">
                                        {prompt.active_positive || <span className="text-muted-foreground italic">No positive prompt</span>}
                                    </p>
                                </div>
                                <div className="min-w-0 bg-rose-500/10 rounded p-1.5 border border-rose-500/20" style={{ flex: '1 1 0%' }}>
                                    <p className="text-[10px] text-rose-700 dark:text-rose-300 leading-relaxed line-clamp-4">
                                        {prompt.active_negative || <span className="text-muted-foreground italic">No negative prompt</span>}
                                    </p>
                                </div>
                            </div>

                            {/* Actions - always visible */}
                            <div className="flex-none flex flex-col gap-1">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={handleCopyToConfigurator}
                                    className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200"
                                    title="Copy to Configurator"
                                >
                                    <Copy className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => prompt.prompt_id && handleDelete(prompt.prompt_id)}
                                    className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                    disabled={!prompt.prompt_id}
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                        </div>
                    );
                })}

                {filteredPrompts.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                        No prompts found matching your search.
                    </div>
                )}
            </div>
        </div>
    );
}
