/**
 * API Client for Sweet Tea Studio
 * 
 * This module provides the HTTP client for all backend API calls.
 * 
 * NOTE: Types are also available in ./types.ts which provides a consolidated
 * reference organized by domain. For new imports, prefer '@/lib/types'.
 */

// Detect if running behind nginx at /studio/ path - use /sts-api prefix
// Otherwise (local dev), use /api directly
export const isStudioPath = typeof window !== 'undefined' && window.location.pathname.startsWith('/studio');
const API_BASE = isStudioPath ? "/sts-api/api/v1" : "/api/v1";

// Utility function to get the API base path - use this in components
export const getApiBase = () => API_BASE;

export interface Engine {
    id: number;
    name: string;
    base_url: string;
    output_dir: string;
    input_dir: string;
    auth_token?: string | null;
    max_concurrent_jobs?: number;
    allow_filesystem_delete?: boolean;
    is_active: boolean;
}

export interface EngineUpdate {
    name?: string;
    base_url?: string;
    output_dir?: string;
    input_dir?: string;
    auth_token?: string | null;
    max_concurrent_jobs?: number;
    allow_filesystem_delete?: boolean;
    is_active?: boolean;
}

export interface EngineHealth {
    engine_id: number;
    engine_name?: string;
    healthy: boolean;
    last_error?: string;
    last_checked_at?: string;
    next_check_in: number;
}

export interface ComfyLaunchConfig {
    path?: string | null;
    python_path?: string | null;
    args: string[];
    port: number;
    is_available: boolean;
    detection_method: string;
}

export interface WorkflowTemplate {
    id: number;
    name: string;
    description?: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    graph_json: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input_schema: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    node_mapping?: any;
}

export interface WorkflowExportBundle {
    workflow: Record<string, any>;
    _sweet_tea: {
        version: number;
        name: string;
        description?: string | null;
        exported_at: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input_schema: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        node_mapping?: any;
        integrity: {
            graph_sha256: string;
            input_schema_sha256: string;
            bundle_sha256: string;
        };
        settings: {
            node_count: number;
            input_schema_count: number;
            node_mapping_count: number;
        };
        source: string;
        comfy_format: string;
        notes?: string;
    };
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
    output_dir?: string | null;
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

export interface StatusSummary {
    engines_total: number;
    engines_healthy: number;
    jobs_queued: number;
    jobs_running: number;
    jobs_completed_24h: number;
    system: SystemMetrics;
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
    project_id?: number;
    project_name?: string;
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

// --- Collections (legacy grouping, still supported for compatibility) ---
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
    config_json: { folders?: string[] } | null;
    image_count: number;
    last_activity: string | null;
}

export interface ProjectCreate {
    name: string;
    slug?: string;
}

export interface InstallStatus {
    job_id?: string;
    status: "pending" | "running" | "completed" | "failed";
    progress_text?: string;
    installed?: string[];
    failed?: string[];
    unknown?: string[];
    error?: string;
}

export interface ImageMetadata {
    path: string;
    prompt?: string | null;
    negative_prompt?: string | null;
    workflow?: unknown;
    parameters: Record<string, unknown>;
    source: "sweet_tea" | "comfyui" | "comfyui_workflow" | "database" | "none";
}

export const api = {
    // --- Engines ---
    getEngines: async (): Promise<Engine[]> => {
        const res = await fetch(`${API_BASE}/engines/`);
        if (!res.ok) throw new Error("Failed to fetch engines");
        return res.json();
    },

    getEngineHealth: async (): Promise<EngineHealth[]> => {
        const res = await fetch(`${API_BASE}/monitoring/health`);
        if (!res.ok) throw new Error("Failed to fetch engine health");
        return res.json();
    },

    getEngineObjectInfo: async (engineId: number): Promise<Record<string, any>> => {
        const res = await fetch(`${API_BASE}/engines/${engineId}/object_info`);
        if (!res.ok) throw new Error("Failed to fetch engine object info");
        return res.json();
    },

    updateEngine: async (engineId: number, data: EngineUpdate): Promise<Engine> => {
        const res = await fetch(`${API_BASE}/engines/${engineId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to update engine");
        }
        return res.json();
    },

    // --- Tag Suggestions ---
    getTagSuggestions: async (query: string, limit: number = 20, signal?: AbortSignal): Promise<TagSuggestion[]> => {
        const params = new URLSearchParams({ query, limit: String(limit) });
        const res = await fetch(`${API_BASE}/library/tags/suggest?${params}`, { signal });
        if (!res.ok) throw new Error("Failed to fetch tag suggestions");
        return res.json();
    },

    rebootComfyUI: async (): Promise<void> => {
        await fetch(`${API_BASE}/monitoring/reboot`, { method: "POST" });
    },

    // --- ComfyUI Process Control ---
    getComfyUIStatus: async (): Promise<{ running: boolean; pid?: number; can_launch: boolean; error?: string }> => {
        const res = await fetch(`${API_BASE}/monitoring/comfyui/status`);
        if (!res.ok) return { running: false, can_launch: false, error: "Failed to fetch status" };
        const data = await res.json();
        // Backend returns "available" but we use "can_launch" in the frontend
        return {
            running: data.running,
            pid: data.pid,
            can_launch: data.available ?? false,
            error: data.last_error,
        };
    },

    getComfyUILaunchConfig: async (): Promise<ComfyLaunchConfig> => {
        const res = await fetch(`${API_BASE}/engines/comfyui/config`);
        if (!res.ok) throw new Error("Failed to fetch ComfyUI config");
        return res.json();
    },

    saveComfyUILaunchConfig: async (
        payload: { path?: string | null; args?: string | null },
    ): Promise<ComfyLaunchConfig> => {
        const res = await fetch(`${API_BASE}/engines/comfyui/config`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.detail || data.error || "Unable to save ComfyUI config");
        }

        return res.json();
    },

    startComfyUI: async (): Promise<{ success: boolean; message?: string; error?: string }> => {
        const res = await fetch(`${API_BASE}/monitoring/comfyui/start`, { method: "POST" });
        return res.json();
    },

    stopComfyUI: async (): Promise<{ success: boolean; message?: string; error?: string }> => {
        const res = await fetch(`${API_BASE}/monitoring/comfyui/stop`, { method: "POST" });
        return res.json();
    },

    getComfyLogs: async (lines = 200): Promise<{ logs: string }> => {
        const res = await fetch(`${API_BASE}/monitoring/comfyui/logs?lines=${lines}`);
        if (!res.ok) throw new Error("Failed to fetch logs");
        return res.json();
    },

    exportDatabaseToComfy: async (): Promise<{ path: string; filename: string; sweet_tea_dir: string }> => {
        const res = await fetch(`${API_BASE}/portfolio/export`, { method: "POST" });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to export database");
        }
        return res.json();
    },


    // --- Collections ---
    getCollections: async (): Promise<Collection[]> => {
        const res = await fetch(`${API_BASE}/collections/`);
        if (!res.ok) throw new Error("Failed to fetch collections");
        return res.json();
    },

    // --- Workflows ---
    getWorkflows: async (): Promise<WorkflowTemplate[]> => {
        const res = await fetch(`${API_BASE}/workflows/`);
        if (!res.ok) throw new Error("Failed to fetch workflows");
        return res.json();
    },

    updateWorkflow: async (workflowId: number, workflow: WorkflowTemplate): Promise<WorkflowTemplate> => {
        const res = await fetch(`${API_BASE}/workflows/${workflowId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: workflow.name,
                description: workflow.description,
                graph_json: workflow.graph_json,
                input_schema: workflow.input_schema,
                // node_mapping is optional, but include it if present to avoid dropping data
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                node_mapping: (workflow as any).node_mapping ?? null,
            }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.detail || "Failed to update workflow");
        }
        return res.json();
    },
    exportWorkflow: async (workflowId: number): Promise<WorkflowExportBundle> => {
        const res = await fetch(`${API_BASE}/workflows/${workflowId}/export`);
        if (!res.ok) throw new Error("Failed to export workflow");
        return res.json();
    },

    importWorkflow: async (payload: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: any;
        name?: string;
        description?: string;
    }): Promise<WorkflowTemplate> => {
        const res = await fetch(`${API_BASE}/workflows/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to import workflow");
        }

        return res.json();
    },

    // --- Jobs ---
    createJob: async (
        engineId: number,
        workflowId: number,
        projectId: number | null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        params: any,
        targetOutputDir?: string | null,
    ): Promise<Job> => {
        const res = await fetch(`${API_BASE}/jobs/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                engine_id: engineId,
                workflow_template_id: workflowId,
                project_id: projectId,
                input_params: params,
                output_dir: targetOutputDir,
            }),
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to create job");
        }
        return res.json();
    },

    cancelJob: async (jobId: number): Promise<Job> => {
        const res = await fetch(`${API_BASE}/jobs/${jobId}/cancel`, {
            method: "POST",
        });
        if (!res.ok) throw new Error("Failed to cancel job");
        return res.json();
    },

    getJob: async (jobId: number): Promise<Job> => {
        const res = await fetch(`${API_BASE}/jobs/${jobId}`);
        if (!res.ok) throw new Error("Failed to fetch job");
        return res.json();
    },

    // --- Extensions (Install) ---
    installMissingNodes: async (missingNodes: string[], allowManualClone = false): Promise<{ job_id: string }> => {
        const res = await fetch(`${API_BASE}/extensions/install`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ missing_nodes: missingNodes, allow_manual_clone: allowManualClone }),
        });
        if (!res.ok) {
            const body = await res.json();
            throw new Error(body.detail || "Failed to start install");
        }
        return res.json();
    },

    getInstallStatus: async (jobId: string): Promise<InstallStatus> => {
        const res = await fetch(`${API_BASE}/extensions/install/${jobId}`);
        if (!res.ok) throw new Error("Failed to get status");
        return res.json();
    },

    // --- Files ---
    getFileTree: async (engineId?: number, path: string = "", projectId?: number): Promise<FileItem[]> => {
        let url = `${API_BASE}/files/tree?path=${encodeURIComponent(path)}`;
        if (engineId) url += `&engine_id=${engineId}`;
        if (projectId) url += `&project_id=${projectId}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch file tree");
        return res.json();
    },

    uploadFile: async (file: File, engineId?: number): Promise<{ filename: string; path: string }> => {
        const formData = new FormData();
        formData.append("file", file);
        if (engineId) formData.append("engine_id", String(engineId));

        const res = await fetch(`${API_BASE}/files/upload`, {
            method: "POST",
            body: formData,
        });
        if (!res.ok) throw new Error("Failed to upload file");
        return res.json();
    },

    // --- Gallery ---
    getGallery: async (
        searchOrSkip?: string | number,
        limit = 50,
        projectId?: number | null,
        unassignedOnly = false
    ): Promise<GalleryItem[]> => {
        const params = new URLSearchParams();

        // Handle both old (skip, limit) and new (search, limit) signatures
        if (typeof searchOrSkip === 'string') {
            if (searchOrSkip) params.append("search", searchOrSkip);
            params.append("skip", "0");
        } else {
            params.append("skip", String(searchOrSkip ?? 0));
        }
        params.append("limit", String(limit));

        if (projectId !== undefined && projectId !== null) {
            params.append("project_id", String(projectId));
        }
        if (unassignedOnly) {
            params.append("unassigned_only", "true");
        }

        const res = await fetch(`${API_BASE}/gallery/?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch gallery");
        return res.json();
    },

    deleteImage: async (imageId: number): Promise<void> => {
        const res = await fetch(`${API_BASE}/gallery/${imageId}`, {
            method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete image");
    },

    updateImage: async (imageId: number, data: { caption?: string; tags?: string[] }): Promise<void> => {
        const res = await fetch(`${API_BASE}/gallery/${imageId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to update image");
    },

    getImageMetadata: async (path: string): Promise<ImageMetadata> => {
        const res = await fetch(`${API_BASE}/gallery/image/path/metadata?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error("Failed to fetch image metadata");
        return res.json();
    },

    // --- Captioning ---
    captionImage: async (file: File, imageId?: number): Promise<CaptionResponse> => {
        const formData = new FormData();
        formData.append("file", file);
        if (imageId) formData.append("image_id", String(imageId));

        const res = await fetch(`${API_BASE}/vlm/caption`, {
            method: "POST",
            body: formData,
        });
        if (!res.ok) throw new Error("Failed to caption image");
        return res.json();
    },

    // --- Library (Prompts) ---
    getPrompts: async (search?: string, workflowId?: number): Promise<PromptLibraryItem[]> => {
        const params = new URLSearchParams();
        if (search) params.append("search", search);
        if (workflowId) params.append("workflow_id", String(workflowId));

        const res = await fetch(`${API_BASE}/library/?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch prompts");
        return res.json();
    },

    savePrompt: async (data: {
        workflow_id: number;
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        preview_image_path?: string;
        positive_text?: string;
        negative_text?: string;
        tags?: string[];
    }): Promise<Prompt> => {
        const res = await fetch(`${API_BASE}/library/prompts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to save prompt");
        return res.json();
    },

    // --- Projects ---
    getProjects: async (includeArchived = false): Promise<Project[]> => {
        const params = includeArchived ? "?include_archived=true" : "";
        const res = await fetch(`${API_BASE}/projects${params}`);
        if (!res.ok) throw new Error("Failed to fetch projects");
        return res.json();
    },

    createProject: async (data: ProjectCreate): Promise<Project> => {
        const res = await fetch(`${API_BASE}/projects`, {
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

    addProjectFolder: async (projectId: number, folderName: string): Promise<Project> => {
        const res = await fetch(`${API_BASE}/projects/${projectId}/folders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder_name: folderName }),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to add folder");
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

    adoptJobsIntoProject: async (projectId: number, jobIds: number[]): Promise<{ updated: number }> => {
        const res = await fetch(`${API_BASE}/projects/${projectId}/adopt-jobs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(jobIds),
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to attach jobs to project");
        }

        return res.json();
    },

    // --- Status ---
    getStatusSummary: async (): Promise<StatusSummary> => {
        const res = await fetch(`${API_BASE}/monitoring/status/summary`);
        if (!res.ok) throw new Error("Failed to fetch status");
        return res.json();
    },

    getSystemMetrics: async (): Promise<SystemMetrics> => {
        const res = await fetch(`${API_BASE}/monitoring/system`);
        if (!res.ok) throw new Error("Failed to fetch system metrics");
        return res.json();
    },

    getVersions: async (): Promise<{
        comfyui_version: string | null;
        pytorch_version: string | null;
        cuda_version: string | null;
        python_version: string | null;
        connected: boolean;
        error: string | null;
    }> => {
        const res = await fetch(`${API_BASE}/monitoring/versions`);
        if (!res.ok) {
            return {
                comfyui_version: null,
                pytorch_version: null,
                cuda_version: null,
                python_version: null,
                connected: false,
                error: "Failed to fetch versions"
            };
        }
        return res.json();
    },

    // --- VLM/Captioning ---
    vlmHealth: async (): Promise<{ available: boolean; backend?: string; model?: string }> => {
        const res = await fetch(`${API_BASE}/vlm/health`);
        if (!res.ok) return { available: false };
        return res.json();
    },

    generateCaption: async (imageId: number): Promise<CaptionResponse> => {
        const res = await fetch(`${API_BASE}/vlm/caption/${imageId}`, { method: "POST" });
        if (!res.ok) throw new Error("Failed to generate caption");
        return res.json();
    },

    generateTagPrompt: async (imageId: number): Promise<TagPromptResponse> => {
        const res = await fetch(`${API_BASE}/vlm/tag-prompt/${imageId}`, { method: "POST" });
        if (!res.ok) throw new Error("Failed to generate tag prompt");
        return res.json();
    },


    // Note: getTagSuggestions is defined earlier in this file (around line 197)

    getPromptSuggestions: async (prefix: string): Promise<PromptSuggestion[]> => {
        const res = await fetch(`${API_BASE}/prompts/suggest?prefix=${encodeURIComponent(prefix)}`);
        if (!res.ok) throw new Error("Failed to fetch prompt suggestions");
        return res.json();
    },

    // --- Project Folder Images ---
    getProjectFolderImages: async (projectId: number, folderName: string): Promise<FolderImage[]> => {
        const res = await fetch(`${API_BASE}/projects/${projectId}/folders/${encodeURIComponent(folderName)}/images`);
        if (!res.ok) throw new Error("Failed to fetch folder images");
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
    // Add extra_metadata if needed, or rely on any
    extra_metadata?: string | Record<string, unknown>;
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
    project_id?: number | null;
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

export interface FolderImage {
    path: string;
    filename: string;
    mtime: string;
}

