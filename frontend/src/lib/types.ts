/**
 * Shared TypeScript types for Sweet Tea Studio
 * 
 * This file consolidates all API response types and shared interfaces.
 * Organized by domain:
 * 
 * 1. ENGINES - ComfyUI engine configuration
 * 2. WORKFLOWS - Workflow templates and export bundles
 * 3. JOBS - Generation job lifecycle
 * 4. GALLERY - Image and gallery items
 * 5. LIBRARY - Prompts, tags, suggestions
 * 6. PROJECTS - Project management
 * 7. SYSTEM - Metrics and status
 * 
 * Future considerations (VIDEO):
 * - VideoJob extending Job with frame_count, duration_ms
 * - VideoGalleryItem with video-specific metadata
 * - VLMVideoAnalysis for video understanding
 */

export type PromptItemType = 'block' | 'text';

export interface PromptItem {
    id: string;
    sourceId?: string; // ID of the library snippet this was created from
    type: PromptItemType;
    content: string; // The actual prompt text
    label?: string; // For blocks, a short name
    color?: string; // For blocks
}

// ====================
// ENGINES
// ====================

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

// ====================
// WORKFLOWS
// ====================

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

// ====================
// JOBS
// ====================

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

export interface InstallStatus {
    job_id?: string;
    status: "pending" | "running" | "completed" | "failed";
    progress_text?: string;
    installed?: string[];
    failed?: string[];
    unknown?: string[];
    error?: string;
}

// ====================
// GALLERY & IMAGES
// ====================

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

// ====================
// LIBRARY (Prompts, Tags)
// ====================

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

export interface TagSuggestion {
    name: string;
    source: string;
    frequency: number;
    description?: string;
}

export interface PromptSuggestion {
    value: string;
    type: "tag" | "prompt";
    frequency: number;
    source?: string;
    snippet?: string;
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

// ====================
// PROJECTS
// ====================

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

// ====================
// CANVASES
// ====================

export interface CanvasPayload {
    selected_engine_id?: string | null;
    selected_workflow_id?: string | null;
    selected_project_id?: string | null;
    selected_project_slug?: string | null;
    selected_project_name?: string | null;
    generation_target?: string | null;
    form_data?: Record<string, unknown>;
    snippets?: PromptItem[];
    project_gallery?: {
        project_id?: string | null;
        folder?: string | null;
        collapsed?: boolean;
    };
}

export interface Canvas {
    id: number;
    name: string;
    payload: CanvasPayload;
    project_id?: number | null;
    workflow_template_id?: number | null;
    created_at: string;
    updated_at: string;
}

export interface CanvasCreate {
    name: string;
    payload: CanvasPayload;
    project_id?: number | null;
    workflow_template_id?: number | null;
}

export interface CanvasUpdate {
    name?: string;
    payload?: CanvasPayload;
    project_id?: number | null;
    workflow_template_id?: number | null;
}

// ====================
// COLLECTIONS (Legacy)
// ====================

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

// ====================
// SYSTEM & MONITORING
// ====================

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
