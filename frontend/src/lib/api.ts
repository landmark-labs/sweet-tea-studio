/**
 * API Client for Sweet Tea Studio
 * 
 * This module provides the HTTP client for all backend API calls.
 * 
 * NOTE: Types are also available in ./types.ts which provides a consolidated
 * reference organized by domain. For new imports, prefer '@/lib/types'.
 */

// Detect if running behind nginx at /studio/ path - use /sts-api prefix
// Otherwise (local dev), use /api directly. Allow runtime overrides via a
// global injected by the hosting environment (e.g., window.__STS_API_BASE__)
// so deployments can point the frontend at a different backend host.
export const isStudioPath = typeof window !== 'undefined' && window.location.pathname.startsWith('/studio');
const DEFAULT_API_BASE = "/api/v1";
const STUDIO_API_BASE = "/sts-api/api/v1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RUNTIME_API_BASE = (typeof window !== 'undefined' && (window as any).__STS_API_BASE__) || null;
const API_BASE = RUNTIME_API_BASE || (isStudioPath ? STUDIO_API_BASE : DEFAULT_API_BASE);

// Export the API base for use in image URLs throughout the app
// Components that use hardcoded "/api/v1" for image URLs should use this instead
export const IMAGE_API_BASE = API_BASE;

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
    display_order?: number;
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
    project_id?: number | null;
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

export interface GalleryQuery {
    search?: string;
    skip?: number;
    limit?: number;
    projectId?: number | null;
    folder?: string | null;
    unassignedOnly?: boolean;
    includeThumbnails?: boolean;
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

// --- Canvases ---
export interface Canvas {
    id: number;
    name: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: Record<string, any>;
    project_id?: number | null;
    workflow_template_id?: number | null;
    created_at: string;
    updated_at: string;
}

export interface CanvasCreate {
    name: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: Record<string, any>;
    project_id?: number | null;
    workflow_template_id?: number | null;
}

export interface CanvasUpdate {
    name?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload?: Record<string, any>;
    project_id?: number | null;
    workflow_template_id?: number | null;
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
    image_id?: number;
    job_id?: number;
    prompt?: string | null;
    negative_prompt?: string | null;
    workflow?: unknown;
    parameters: Record<string, unknown>;
    source: "sweet_tea" | "comfyui" | "comfyui_workflow" | "database" | "none";
}

// --- API Keys Settings ---
export interface ApiKeyInfo {
    value: string;  // Masked value like "abc1...xyz9"
    is_set: boolean;
    source: "database" | "environment" | "none";
}

export interface ApiKeysSettings {
    civitai_api_key: ApiKeyInfo;
    rule34_api_key: ApiKeyInfo;
    rule34_user_id: ApiKeyInfo;
}

export interface ApiKeysUpdate {
    civitai_api_key?: string;
    rule34_api_key?: string;
    rule34_user_id?: string;
}

// --- Database Health & Backup ---
export interface DatabaseFileInfo {
    name: string;
    path: string;
    size_bytes: number;
    size_mb: number;
    exists: boolean;
    health_status: string;
    wal_size_bytes?: number | null;
    shm_size_bytes?: number | null;
}

export interface BackupInfo {
    filename: string;
    path: string;
    size_bytes: number;
    size_mb: number;
    created_at: string;
}

export interface DatabaseStatusResponse {
    databases: DatabaseFileInfo[];
    backups_dir: string;
    backups_count: number;
    latest_backup?: BackupInfo | null;
    total_size_mb: number;
}

export interface BackupCreateResponse {
    success: boolean;
    message: string;
    backup?: BackupInfo | null;
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

    createCollection: async (payload: { name: string }): Promise<Collection> => {
        const res = await fetch(`${API_BASE}/collections/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.detail || "Failed to create collection");
        }

        return res.json();
    },

    deleteCollection: async (collectionId: number, keepImages = false): Promise<void> => {
        const res = await fetch(`${API_BASE}/collections/${collectionId}?keep_images=${keepImages}`, {
            method: "DELETE",
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.detail || "Failed to delete collection");
        }
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

    syncWorkflowSchema: async (workflowId: number): Promise<WorkflowTemplate> => {
        const res = await fetch(`${API_BASE}/workflows/${workflowId}/sync_schema`, {
            method: "POST",
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.detail || "Failed to sync workflow schema");
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

    reorderWorkflows: async (order: { id: number; display_order: number }[]): Promise<{ ok: boolean; updated: number }> => {
        const res = await fetch(`${API_BASE}/workflows/reorder`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(order),
        });
        if (!res.ok) throw new Error("Failed to reorder workflows");
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

    uploadFile: async (file: File, engineId?: number, projectSlug?: string, subfolder?: string): Promise<{ filename: string; path: string; mime_type?: string; size_bytes?: number }> => {
        const formData = new FormData();
        formData.append("file", file);
        if (engineId) formData.append("engine_id", String(engineId));
        if (projectSlug) formData.append("project_slug", projectSlug);
        if (subfolder) formData.append("subfolder", subfolder);

        const res = await fetch(`${API_BASE}/files/upload`, {
            method: "POST",
            body: formData,
        });
        if (!res.ok) throw new Error("Failed to upload file");
        return res.json();
    },

    saveMask: async (
        maskFile: File,
        sourcePath: string,
        engineId?: number,
    ): Promise<{
        filename: string;
        path: string;
        comfy_filename?: string | null;
        saved_to: "project_masks" | "same_folder";
        project_slug?: string | null;
        project_id?: number | null;
    }> => {
        const formData = new FormData();
        formData.append("file", maskFile);
        formData.append("source_path", sourcePath);
        if (engineId) formData.append("engine_id", String(engineId));

        const res = await fetch(`${API_BASE}/files/save-mask`, {
            method: "POST",
            body: formData,
        });
        if (!res.ok) throw new Error("Failed to save mask");
        return res.json();
    },

    copyToInput: async (sourcePath: string, engineId?: number, projectSlug?: string, subfolder?: string): Promise<{ filename: string; path: string; already_exists: boolean }> => {
        const formData = new FormData();
        formData.append("source_path", sourcePath);
        if (engineId) formData.append("engine_id", String(engineId));
        if (projectSlug) formData.append("project_slug", projectSlug);
        if (subfolder) formData.append("subfolder", subfolder);

        const res = await fetch(`${API_BASE}/files/copy-to-input`, {
            method: "POST",
            body: formData,
        });
        if (!res.ok) throw new Error("Failed to copy file to input");
        return res.json();
    },

    // --- Gallery ---
    getGallery: async (
        searchOrSkip?: GalleryQuery | string | number,
        limit?: number,
        projectId?: number | null,
        unassignedOnly = false
    ): Promise<GalleryItem[]> => {
        const params = new URLSearchParams();
        let usedNewParams = false;

        if (searchOrSkip && typeof searchOrSkip === "object") {
            usedNewParams = true;
            const query = searchOrSkip as GalleryQuery;
            if (query.search) params.append("search", query.search);
            if (query.skip !== undefined) params.append("skip", String(query.skip));
            if (query.limit !== undefined) params.append("limit", String(query.limit));
            if (query.projectId !== undefined && query.projectId !== null) {
                params.append("project_id", String(query.projectId));
            }
            if (query.folder) params.append("folder", query.folder);
            if (query.unassignedOnly) params.append("unassigned_only", "true");
            if (query.includeThumbnails !== undefined) {
                params.append("include_thumbnails", query.includeThumbnails ? "true" : "false");
            }
        } else {
            // Handle both old (skip, limit) and new (search, limit) signatures
            if (typeof searchOrSkip === "string") {
                if (searchOrSkip) params.append("search", searchOrSkip);
                params.append("skip", "0");
            } else {
                params.append("skip", String(searchOrSkip ?? 0));
            }
            // Only send limit if explicitly provided - otherwise backend returns all
            if (limit !== undefined) {
                params.append("limit", String(limit));
            }

            if (projectId !== undefined && projectId !== null) {
                params.append("project_id", String(projectId));
            }
            if (unassignedOnly) {
                params.append("unassigned_only", "true");
            }
        }

        const baseUrl = `${API_BASE}/gallery/?${params.toString()}`;
        let res = await fetch(baseUrl);
        if (!res.ok && usedNewParams && params.has("include_thumbnails")) {
            params.delete("include_thumbnails");
            res = await fetch(`${API_BASE}/gallery/?${params.toString()}`);
        }
        if (!res.ok) throw new Error("Failed to fetch gallery");
        return res.json();
    },

    deleteImage: async (imageId: number): Promise<void> => {
        // Route through bulk delete for consistent behavior and to avoid DB lock storms
        await api.bulkDeleteImages([imageId]);
    },

    deleteImageByPath: async (path: string): Promise<{ deleted: boolean; error?: string }> => {
        const res = await fetch(`${API_BASE}/gallery/image/path/delete`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path }),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to delete image");
        }
        return res.json();
    },
    bulkDeleteImages: async (imageIds: number[]): Promise<{ deleted: number; not_found: number[]; file_errors: number[] }> => {
        const res = await fetch(`${API_BASE}/gallery/bulk_delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_ids: imageIds }),
        });
        if (!res.ok) throw new Error("Failed to delete images");
        return res.json();
    },

    moveImages: async (
        imageIds: number[],
        projectId: number,
        subfolder?: string
    ): Promise<{ moved: number; failed: number[]; new_paths: Record<number, string> }> => {
        const res = await fetch(`${API_BASE}/gallery/move`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                image_ids: imageIds,
                project_id: projectId,
                subfolder: subfolder || null,
            }),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to move images");
        }
        return res.json();
    },

    updateImage: async (imageId: number, data: { caption?: string; tags?: string[] }): Promise<void> => {
        const res = await fetch(`${API_BASE}/gallery/${imageId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to update image");
    },

    getImageMetadata: async (path: string, init?: RequestInit): Promise<ImageMetadata> => {
        const res = await fetch(`${API_BASE}/gallery/image/path/metadata?path=${encodeURIComponent(path)}`, init);
        if (!res.ok) throw new Error("Failed to fetch image metadata");
        return res.json();
    },

    keepImages: async (imageIds: number[], keep: boolean): Promise<{ status: string; count: number }> => {
        const res = await fetch(`${API_BASE}/gallery/keep`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_ids: imageIds, keep }),
        });
        if (!res.ok) throw new Error("Failed to update kept status");
        return res.json();
    },

    cleanupGallery: async (
        options?: { jobId?: number; projectId?: number | null; folder?: string | null }
    ): Promise<{ status: string; count: number; files_deleted: number }> => {
        const res = await fetch(`${API_BASE}/gallery/cleanup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                job_id: options?.jobId,
                project_id: options?.projectId,
                folder: options?.folder,
            }),
        });
        if (!res.ok) throw new Error("Failed to cleanup gallery");
        return res.json();
    },

    downloadImages: async (imageIds: number[]): Promise<Blob> => {
        const res = await fetch(`${API_BASE}/gallery/download`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_ids: imageIds }),
        });
        if (!res.ok) throw new Error("Failed to download images");
        return res.blob();
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

    deleteProjectFolder: async (projectId: number, folderName: string): Promise<Project> => {
        const res = await fetch(`${API_BASE}/projects/${projectId}/folders/${encodeURIComponent(folderName)}`, {
            method: "DELETE",
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to delete folder");
        }
        return res.json();
    },

    emptyFolderTrash: async (projectId: number, folderName: string): Promise<{ deleted: number; errors?: string[] }> => {
        const res = await fetch(`${API_BASE}/projects/${projectId}/folders/${encodeURIComponent(folderName)}/trash`, {
            method: "DELETE",
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to empty trash");
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

    // --- Canvases ---
    getCanvases: async (filters?: { projectId?: number | null; workflowId?: number | null }): Promise<Canvas[]> => {
        const params = new URLSearchParams();
        if (filters?.projectId !== undefined && filters?.projectId !== null) {
            params.append("project_id", String(filters.projectId));
        }
        if (filters?.workflowId !== undefined && filters?.workflowId !== null) {
            params.append("workflow_template_id", String(filters.workflowId));
        }
        const qs = params.toString();
        const res = await fetch(`${API_BASE}/canvases${qs ? `?${qs}` : ""}`);
        if (!res.ok) throw new Error("Failed to fetch canvases");
        return res.json();
    },

    getCanvas: async (canvasId: number): Promise<Canvas> => {
        const res = await fetch(`${API_BASE}/canvases/${canvasId}`);
        if (!res.ok) throw new Error("Failed to fetch canvas");
        return res.json();
    },

    createCanvas: async (data: CanvasCreate): Promise<Canvas> => {
        const res = await fetch(`${API_BASE}/canvases`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to create canvas");
        }
        return res.json();
    },

    updateCanvas: async (canvasId: number, data: CanvasUpdate): Promise<Canvas> => {
        const res = await fetch(`${API_BASE}/canvases/${canvasId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to update canvas");
        }
        return res.json();
    },

    deleteCanvas: async (canvasId: number): Promise<void> => {
        const res = await fetch(`${API_BASE}/canvases/${canvasId}`, {
            method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete canvas");
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

    deleteFolderImages: async (projectId: number, folderName: string, paths: string[]): Promise<{ deleted: number; errors: string[] }> => {
        const res = await fetch(`${API_BASE}/projects/${projectId}/folders/${encodeURIComponent(folderName)}/delete-images`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths }),
        });
        if (!res.ok) throw new Error("Failed to delete folder images");
        return res.json();
    },

    // --- System Control ---
    restartBackend: async (): Promise<{ message: string; status: string }> => {
        const res = await fetch(`${API_BASE}/status/restart`, { method: "POST" });
        if (!res.ok) throw new Error("Failed to restart backend");
        return res.json();
    },

    freeMemory: async (options: { unloadModels?: boolean; freeMemory?: boolean }): Promise<{ success: boolean }> => {
        const res = await fetch(`${API_BASE}/monitoring/free-memory`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                unload_models: options.unloadModels ?? false,
                free_memory: options.freeMemory ?? false,
            }),
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to free memory");
        }
        return res.json();
    },

    // --- API Keys Settings ---
    getApiKeys: async (): Promise<ApiKeysSettings> => {
        const res = await fetch(`${API_BASE}/settings/api-keys`);
        if (!res.ok) throw new Error("Failed to fetch API keys");
        return res.json();
    },

    updateApiKeys: async (keys: ApiKeysUpdate): Promise<ApiKeysSettings> => {
        const res = await fetch(`${API_BASE}/settings/api-keys`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(keys),
        });
        if (!res.ok) throw new Error("Failed to update API keys");
        return res.json();
    },

    // --- Database Health & Backup ---
    getDatabaseStatus: async (): Promise<DatabaseStatusResponse> => {
        const res = await fetch(`${API_BASE}/database/status`);
        if (!res.ok) throw new Error("Failed to fetch database status");
        return res.json();
    },

    createDatabaseBackup: async (database: string = "profile.db"): Promise<BackupCreateResponse> => {
        const res = await fetch(`${API_BASE}/database/backup?database=${encodeURIComponent(database)}`, {
            method: "POST",
        });
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.detail || "Failed to create backup");
        }
        return res.json();
    },

    getDatabaseBackups: async (): Promise<BackupInfo[]> => {
        const res = await fetch(`${API_BASE}/database/backups`);
        if (!res.ok) throw new Error("Failed to fetch backups");
        return res.json();
    },

    checkpointDatabases: async (): Promise<{ checkpoints: Record<string, string> }> => {
        const res = await fetch(`${API_BASE}/database/checkpoint`, {
            method: "POST",
        });
        if (!res.ok) throw new Error("Failed to checkpoint databases");
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
    workflow_name?: string;
    width?: number;
    height?: number;
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
    width?: number;
    height?: number;
}

// --- Snippets (Backend-persisted prompt blocks) ---
export interface Snippet {
    id: number;
    label: string;
    content: string;
    color?: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
}

export interface SnippetCreate {
    label: string;
    content: string;
    color?: string;
    sort_order?: number;
}

// Snippet API uses the same base as other APIs
// No special probing needed - API_BASE already handles /studio vs /api routing

const fetchSnippet = async (path: string, init?: RequestInit) => {
    return fetch(`${API_BASE}${path}`, init);
};

const parseSnippetJson = async <T>(res: Response): Promise<T> => {
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        const body = await res.text();
        throw new Error(`Unexpected response from snippets API (${res.status}): ${body.slice(0, 200)}`);
    }
    return res.json();
};

export const snippetApi = {
    getSnippets: async (): Promise<Snippet[]> => {
        const res = await fetchSnippet(`/snippets`);
        if (!res.ok) throw new Error("Failed to fetch snippets");
        return parseSnippetJson<Snippet[]>(res);
    },

    createSnippet: async (data: SnippetCreate): Promise<Snippet> => {
        const res = await fetchSnippet(`/snippets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to create snippet");
        return parseSnippetJson<Snippet>(res);
    },

    updateSnippet: async (id: number, data: Partial<SnippetCreate>): Promise<Snippet> => {
        const res = await fetchSnippet(`/snippets/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error("Failed to update snippet");
        return parseSnippetJson<Snippet>(res);
    },

    deleteSnippet: async (id: number): Promise<void> => {
        const res = await fetchSnippet(`/snippets/${id}`, {
            method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete snippet");
    },

    reorderSnippets: async (snippetIds: number[]): Promise<Snippet[]> => {
        const res = await fetchSnippet(`/snippets/reorder`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(snippetIds),
        });
        if (!res.ok) throw new Error("Failed to reorder snippets");
        return parseSnippetJson<Snippet[]>(res);
    },

    bulkUpsert: async (snippets: SnippetCreate[]): Promise<Snippet[]> => {
        const res = await fetchSnippet(`/snippets/bulk`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(snippets),
        });
        if (!res.ok) throw new Error("Failed to bulk update snippets");
        return parseSnippetJson<Snippet[]>(res);
    },
};
