const API_BASE = "/api/v1";

export interface Engine {
    id: number;
    name: string;
    base_url: string;
    is_active: boolean;
}

export interface EngineHealth {
    engine_id: number;
    engine_name?: string;
    healthy: boolean;
    last_error?: string;
    last_checked_at?: string;
    next_check_in: number;
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

export interface PromptSuggestion {
    value: string;
    type: "tag" | "prompt";
    frequency: number;
    source?: string;
    snippet?: string;
}

export interface Collection {
    id: number;
    name: string;
    description?: string;
    created_at: string;
    item_count?: number;
}

export interface CollectionCreate {
    name: string;
    description?: string;
}

export interface SystemGpuMetrics {
    index: number;
    name: string;
    memory_total_mb: number;
    memory_used_mb: number;
    utilization_percent: number;
    temperature_c?: number | null;
    pcie_generation?: number;
    pcie_width?: number;
    bandwidth_gb_s?: number | null;
}

export interface SystemMetrics {
    timestamp?: number;
    cpu: { percent: number; count: number };
    memory: { total: number; available: number; used: number; percent: number };
    temperatures?: { cpu?: number | null };
    disk: { read_bytes: number; write_bytes: number; bandwidth_mb_s?: number | null };
    gpus: SystemGpuMetrics[];
}

export interface TagSuggestion {
    name: string;
    source: string;
    frequency: number;
    description?: string;
}
export interface PromptStage {
    stage: number;
    positive_text?: string;
    negative_text?: string;
    source?: string;
    timestamp?: string;
}

export interface PromptLibraryItem {
    image_id: number;
    job_id?: number;
    workflow_template_id?: number;
    created_at: string;
    preview_path: string;
    active_positive?: string;
    active_negative?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    job_params: any;
    prompt_history: PromptStage[];
    tags: string[];
    caption?: string;
    prompt_id?: number;
    prompt_name?: string;
}

export interface Collection {
    id: number;
    name: string;
    description?: string;
    created_at: string;
    item_count?: number;
}

export interface CollectionCreate {
    name: string;
    description?: string;
}

// --- Projects ---
export interface Project {
    id: number;
    slug: string;
    name: string;
    created_at: string;
    updated_at: string;
    archived_at: string | null;
    config_json: Record<string, unknown> | null;
}

export interface ProjectCreate {
    name: string;
    slug?: string;
}

// --- Status ---
export interface StatusItem {
    state: "ok" | "warn" | "error";
    detail: string;
    last_check_at?: string;
}

export interface StatusSummary {
    engine: StatusItem;
    queue: StatusItem & { pending_jobs: number; oldest_job_age_s: number };
    io: StatusItem;
    models: StatusItem & { missing_models: number };
}


export const api = {
    getEngines: async (): Promise<Engine[]> => {
        const res = await fetch(`${API_BASE}/engines/`);
        if (!res.ok) throw new Error("Failed to fetch engines");
        return res.json();
    },

    getEngineHealth: async (): Promise<EngineHealth[]> => {
        const res = await fetch(`${API_BASE}/engines/health`);
        if (!res.ok) throw new Error("Failed to fetch engine health");
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

    getGallery: async (search?: string, collectionId?: number | null): Promise<GalleryItem[]> => {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (collectionId !== undefined && collectionId !== null) params.set("collection_id", String(collectionId));
        const query = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`${API_BASE}/gallery/${query}`);
        if (!res.ok) throw new Error("Failed to fetch gallery");
        return res.json();
    },

    deleteImage: async (imageId: number): Promise<void> => {
        await fetch(`${API_BASE}/gallery/${imageId}`, { method: "DELETE" });
    },

    getPrompts: async (search?: string, workflowId?: number): Promise<PromptLibraryItem[]> => {
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

    getTagSuggestions: async (query: string, limit = 25): Promise<TagSuggestion[]> => {
        const params = new URLSearchParams({ query, limit: String(limit) });
        const res = await fetch(`${API_BASE}/library/tags/suggest?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch tag suggestions");
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

    installMissingNodes: async (missingNodes: string[], allowManualClone = false) => {
        const res = await fetch(`${API_BASE}/extensions/install_missing`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ missing_nodes: missingNodes, allow_manual_clone: allowManualClone }),
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

    launchComfyUI: async (): Promise<{ success: boolean; message?: string; error?: string; pid?: number }> => {
        const res = await fetch(`${API_BASE}/engines/comfyui/launch`, { method: "POST" });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            return { success: false, error: data.detail || "Failed to launch ComfyUI" };
        }
        return res.json();
    },

    stopComfyUI: async (): Promise<{ success: boolean; message?: string }> => {
        const res = await fetch(`${API_BASE}/engines/comfyui/stop`, { method: "POST" });
        return res.json();
    },

    getComfyUIStatus: async (): Promise<{
        is_running: boolean;
        can_launch: boolean;
        path?: string;
        detection_method: string;
    }> => {
        const res = await fetch(`${API_BASE}/engines/comfyui/status`);
        if (!res.ok) throw new Error("Failed to get ComfyUI status");
        return res.json();
    },

    getComfyUIConfig: async (): Promise<{
        path?: string;
        python_path?: string;
        port: number;
        is_available: boolean;
        detection_method: string;
    }> => {
        const res = await fetch(`${API_BASE}/engines/comfyui/config`);
        if (!res.ok) throw new Error("Failed to get ComfyUI config");
        return res.json();
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
    },

    // --- Kept Logic Preserved ---
    keepImages: async (imageIds: number[], keep: boolean) => {
        const res = await fetch(`${API_BASE}/gallery/keep`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_ids: imageIds, keep }),
        });
        if (!res.ok) throw new Error("Failed to update keep status");
        return res.json();
    },

    cleanupImages: async (jobId?: number) => {
        const res = await fetch(`${API_BASE}/gallery/cleanup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ job_id: jobId }),
        });
        if (!res.ok) throw new Error("Failed to cleanup images");
        return res.json();
    },

    // --- Collections ---
    getCollections: async (): Promise<Collection[]> => {
        const res = await fetch(`${API_BASE}/collections/`);
        if (!res.ok) throw new Error("Failed to fetch collections");
        return res.json();
    },

    createCollection: async (data: CollectionCreate): Promise<Collection> => {
        const res = await fetch(`${API_BASE}/collections/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to create collection");
        }
        return res.json();
    },

    deleteCollection: async (id: number, keepImages: boolean = true) => {
        const res = await fetch(`${API_BASE}/collections/${id}?keep_images=${keepImages}`, {
            method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete collection");
    },

    addImagesToCollection: async (collectionId: number, imageIds: number[]) => {
        const res = await fetch(`${API_BASE}/collections/${collectionId}/add`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(imageIds),
        });
        if (!res.ok) throw new Error("Failed to add images to collection");
        return res.json();
    },

    removeImagesFromCollection: async (imageIds: number[]) => {
        const res = await fetch(`${API_BASE}/collections/remove`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(imageIds),
        });
        if (!res.ok) throw new Error("Failed to remove images from collection");
        return res.json();
    },

    getSystemMetrics: async (): Promise<SystemMetrics> => {
        const res = await fetch(`${API_BASE}/monitoring/metrics`);
        if (!res.ok) throw new Error("Failed to read monitoring metrics");
        return res.json();
    },

    // --- Projects ---
    getProjects: async (includeArchived = false): Promise<Project[]> => {
        const params = includeArchived ? "?include_archived=true" : "";
        const res = await fetch(`${API_BASE}/projects/${params}`);
        if (!res.ok) throw new Error("Failed to fetch projects");
        return res.json();
    },

    createProject: async (data: ProjectCreate): Promise<Project> => {
        const res = await fetch(`${API_BASE}/projects/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to create project");
        }
        return res.json();
    },

    archiveProject: async (projectId: number): Promise<Project> => {
        const res = await fetch(`${API_BASE}/projects/${projectId}/archive`, {
            method: "POST",
        });
        if (!res.ok) throw new Error("Failed to archive project");
        return res.json();
    },

    unarchiveProject: async (projectId: number): Promise<Project> => {
        const res = await fetch(`${API_BASE}/projects/${projectId}/unarchive`, {
            method: "POST",
        });
        if (!res.ok) throw new Error("Failed to unarchive project");
        return res.json();
    },

    // --- Status ---
    getStatusSummary: async (): Promise<StatusSummary> => {
        const res = await fetch(`${API_BASE}/status/summary`);
        if (!res.ok) throw new Error("Failed to fetch status");
        return res.json();
    },
};

export interface Image {
    id: number;
    job_id: number;
    path: string;
    filename: string;
    created_at: string;
    caption?: string;
    tags?: string[];
    is_kept?: boolean;
    collection_id?: number;
}

export interface GalleryItem {
    image: Image;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    job_params: any;
    prompt?: string;
    negative_prompt?: string;
    prompt_history?: Record<string, unknown>[];
    workflow_template_id?: number;
    created_at: string;
    caption?: string;
    prompt_tags?: string[];
    prompt_name?: string;
    collection_id?: number;
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
    created_at?: string;
    updated_at?: string;
    related_images?: string[];
    tags?: string[];
}

export interface FileItem {
    name: string;
    path: string;
    type: "file" | "directory";
    is_root?: boolean;
}
