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
    /**
     * Prompt rehydration:
     * - "frozen": keep the exact text used at generation time (default when loading old generations)
     * - "live": substitute the current snippet content and continue syncing on snippet edits
     */
    rehydrationMode?: "frozen" | "live";
    /** Snapshot of the original snippet content when a block is in frozen mode (lets the user toggle back). */
    frozenContent?: string;
}

export interface PromptRehydrationItemV1 {
    type: PromptItemType;
    content: string;
    sourceId?: string;
    label?: string;
    color?: string;
}

export interface PromptRehydrationSnapshotV1 {
    version: 1;
    fields: Record<string, PromptRehydrationItemV1[]>;
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
    archived_at?: string | null;
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
    project_id?: number | null;
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

export interface CaptionVersion {
    id: number;
    caption: string;
    source: string;
    is_active: boolean;
    created_at: string;
    deactivated_at?: string | null;
}

export interface ImageMetadataUpdate {
    image_id?: number | null;
    path: string;
    caption?: string | null;
    caption_storage: "embedded" | "sidecar" | "none";
    caption_versions: CaptionVersion[];
}

export interface ImageMetadata {
    path: string;
    image_id?: number;
    job_id?: number;
    prompt?: string | null;
    negative_prompt?: string | null;
    caption?: string | null;
    caption_history?: CaptionVersion[];
    workflow?: unknown;
    parameters: Record<string, unknown>;
    source: "sweet_tea" | "comfyui" | "comfyui_workflow" | "database" | "sidecar_json" | "comment" | "none";
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

export interface GalleryQuery {
    search?: string;
    skip?: number;
    limit?: number;
    projectId?: number | null;
    folder?: string | null;
    unassignedOnly?: boolean;
    includeThumbnails?: boolean;
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

export interface PromptLibrarySearchResponse {
    items: PromptLibraryItem[];
    offset: number;
    limit: number;
    has_more: boolean;
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
// SNIPPETS
// ====================

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
    media_tray?: Array<{
        path: string;
        filename: string;
        kind: "image" | "video";
    }>;
    prompt_rehydration_snapshot?: PromptRehydrationSnapshotV1 | null;
    pipe_palettes?: Record<string, string[]>;
    /** Theme mode to preserve dark/light mode setting */
    theme?: "light" | "dark" | "system" | "custom" | null;
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

// ====================
// SETTINGS
// ====================

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

export interface AppSettingInfo {
    key: string;
    value: string;
    effective_value: string;
    source: "database" | "environment" | "default" | "none";
    env_var: string;
    default: string;
    type: "string" | "int" | "float" | "bool";
    label: string;
    description: string;
    category: string;
}

export interface AppSettingsUpdate {
    values: Record<string, string>;
}

// ====================
// DATABASE & BACKUPS
// ====================

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
