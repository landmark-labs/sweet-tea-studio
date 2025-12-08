const API_BASE = "/api/v1";

export interface Engine {
    id: number;
    name: string;
    base_url: string;
    is_active: boolean;
}

export interface WorkflowTemplate {
    id: number;
    name: string;
    description: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    graph_json: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input_schema: any;
}

export interface Job {
    id: number;
    engine_id: number;
    workflow_template_id: number;
    status: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input_params: any;
    created_at: string;
    comfy_prompt_id?: string;
    error?: string;
}

export interface CaptionResponse {
    caption: string;
    ranked_tags?: string[];
    model?: string;
    backend?: string;
    image_id?: number;
}

export interface TagPromptResponse {
    prompt: string;
    ordered_tags: string[];
    prompt_id?: number;
}

export const api = {
    getEngines: async (): Promise<Engine[]> => {
        const res = await fetch(`${API_BASE}/engines/`);
        if (!res.ok) throw new Error("Failed to fetch engines");
        return res.json();
    },

    getWorkflows: async (): Promise<WorkflowTemplate[]> => {
        const res = await fetch(`${API_BASE}/workflows/`);
        if (!res.ok) throw new Error("Failed to fetch workflows");
        return res.json();
    },

    createJob: async (
        engineId: number,
        workflowId: number,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        params: any
    ): Promise<Job> => {
        const res = await fetch(`${API_BASE}/jobs/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                engine_id: engineId,
                workflow_template_id: workflowId,
                input_params: params,
            }),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to create job");
        }
        return res.json();
    },

    cancelJob: async (jobId: number): Promise<void> => {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/cancel`, {
            method: "POST",
        });
        if (!res.ok) throw new Error("Failed to cancel job");
    },

    uploadFile: async (file: File, engineId?: number) => {
        const formData = new FormData();
        formData.append("file", file);
        if (engineId) formData.append("engine_id", String(engineId));

        const res = await fetch(`${API_BASE}/files/upload`, {
            method: "POST",
            body: formData,
        });
        if (!res.ok) throw new Error("Failed to upload file");
        return res.json() as Promise<{ filename: string; path: string }>;
    },

    getFileTree: async (engineId?: number, path: string = ""): Promise<FileItem[]> => {
        let url = `${API_BASE}/files/tree?path=${encodeURIComponent(path)}`;
        if (engineId) url += `&engine_id=${engineId}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to search files");
        return res.json();
    },

    getGallery: async (search?: string): Promise<GalleryItem[]> => {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        const query = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`${API_BASE}/gallery/${query}`);
        if (!res.ok) throw new Error("Failed to fetch gallery");
        return res.json();
    },

    deleteImage: async (imageId: number): Promise<void> => {
        await fetch(`${API_BASE}/gallery/${imageId}`, { method: "DELETE" });
    },

    getPrompts: async (search?: string, workflowId?: number): Promise<Prompt[]> => {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (workflowId) params.set("workflow_id", workflowId.toString());

        const query = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`${API_BASE}/library/${query}`);
        if (!res.ok) throw new Error("Failed to fetch prompts");
        return res.json();
    },

    getPrompt: async (promptId: number): Promise<Prompt> => {
        const res = await fetch(`${API_BASE}/library/${promptId}`);
        if (!res.ok) throw new Error("Failed to fetch prompt");
        return res.json();
    },

    deletePrompt: async (promptId: number): Promise<void> => {
        await fetch(`${API_BASE}/library/${promptId}`, { method: "DELETE" });
    },

    getPromptSuggestions: async (query: string): Promise<PromptSuggestion[]> => {
        const params = new URLSearchParams({ query });
        const res = await fetch(`${API_BASE}/library/suggest?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch suggestions");
        return res.json();
    },

    savePrompt: async (prompt: Partial<Prompt>): Promise<Prompt> => {
        const res = await fetch(`${API_BASE}/library/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(prompt),
        });
        if (!res.ok) throw new Error("Failed to save prompt");
        return res.json();
    },

    installMissingNodes: async (missingNodes: string[]) => {
        const res = await fetch(`${API_BASE}/extensions/install_missing`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ missing_nodes: missingNodes }),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to install missing nodes");
        }
        return res.json();
    },

    getInstallStatus: async (jobId: string) => {
        const res = await fetch(`${API_BASE}/extensions/install_status/${jobId}`);
        if (!res.ok) throw new Error("Failed to get status");
        return res.json();
    },

    rebootComfyUI: async () => {
        try {
            await fetch(`${API_BASE}/extensions/reboot`, { method: "POST" });
        } catch (e) {
            // Ignore connection error as reboot kills server
        }
    },

    captionImage: async (file: File | Blob, imageId?: number): Promise<CaptionResponse> => {
        const formData = new FormData();
        formData.append("image", file);
        if (imageId) formData.append("image_id", String(imageId));

        const res = await fetch(`${API_BASE}/vlm/caption`, {
            method: "POST",
            body: formData,
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to caption image");
        }
        return res.json();
    },

    tagsToPrompt: async (tags: string[], promptId?: number): Promise<TagPromptResponse> => {
        const res = await fetch(`${API_BASE}/vlm/tags`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tags, prompt_id: promptId }),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to expand tags");
        }
        return res.json();
    },

    vlmHealth: async () => {
        const res = await fetch(`${API_BASE}/vlm/health`);
        if (!res.ok) throw new Error("VLM health check failed");
        return res.json();
    }
};

export interface Image {
    id: number;
    job_id: number;
    path: string;
    filename: string;
    created_at: string;
    caption?: string;
    tags?: string[];
}

export interface GalleryItem {
    image: Image;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    job_params: any;
    prompt?: string;
    workflow_template_id?: number;
    created_at: string;
    caption?: string;
    prompt_tags?: string[];
    prompt_name?: string;
}

export interface Prompt {
    id: number;
    workflow_id: number;
    name: string;
    description?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: any;
    preview_image_path?: string;
    positive_text?: string;
    negative_text?: string;
    tag_prompt?: string;
    tags?: string[];
    created_at?: string;
    updated_at?: string;
    related_images?: string[];
    tags?: string[];
}

export interface PromptSuggestion {
    value: string;
    type: "tag" | "prompt";
    frequency: number;
    source?: string;
    snippet?: string;
}

export interface FileItem {
    name: string;
    path: string;
    type: "file" | "directory";
    is_root?: boolean;
}
