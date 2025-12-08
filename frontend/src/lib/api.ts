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
        if (!res.ok) throw new Error("Failed to create job");
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

    getGallery: async (): Promise<GalleryItem[]> => {
        const res = await fetch(`${API_BASE}/gallery/`);
        if (!res.ok) throw new Error("Failed to fetch gallery");
        return res.json();
    },

    deleteImage: async (imageId: number): Promise<void> => {
        await fetch(`${API_BASE}/gallery/${imageId}`, { method: "DELETE" });
    },

    getPrompts: async (search?: string): Promise<Prompt[]> => {
        const query = search ? `?search=${encodeURIComponent(search)}` : "";
        const res = await fetch(`${API_BASE}/library/${query}`);
        if (!res.ok) throw new Error("Failed to fetch prompts");
        return res.json();
    },

    deletePrompt: async (promptId: number): Promise<void> => {
        await fetch(`${API_BASE}/library/${promptId}`, { method: "DELETE" });
    },

    savePrompt: async (prompt: Partial<Prompt>): Promise<Prompt> => {
        const res = await fetch(`${API_BASE}/library/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(prompt),
        });
        if (!res.ok) throw new Error("Failed to save prompt");
        return res.json();
    }
};

export interface Image {
    id: number;
    job_id: number;
    path: string;
    filename: string;
    created_at: string;
}

export interface GalleryItem {
    image: Image;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    job_params: any;
    prompt?: string;
    created_at: string;
}

export interface Prompt {
    id: number;
    workflow_id: number;
    name: string;
    description?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: any;
    preview_image_path?: string;
    related_images?: string[];
}

export interface FileItem {
    name: string;
    path: string;
    type: "file" | "directory";
    is_root?: boolean;
}
