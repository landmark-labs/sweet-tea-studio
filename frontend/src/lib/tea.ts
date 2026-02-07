/**
 * Canonical `.tea` format runtime contracts (frontend side).
 *
 * This file intentionally includes both:
 * - TypeScript interfaces
 * - JSON-schema-like objects for v1 validation/documentation
 */

export type TeaDependencyModelKind =
    | "checkpoint"
    | "lora"
    | "vae"
    | "embedding"
    | "controlnet"
    | "clip"
    | "upscaler";

export interface TeaManifestV1 {
    tea_version: "1.0";
    schema_version: 1;
    pipe: {
        id: string;
        name: string;
        version: string;
        description?: string;
        authors: Array<{ name: string; handle?: string }>;
        tags: string[];
        created_at: string;
        updated_at: string;
        license: string;
        homepage?: string;
        source?: {
            type: "local" | "civitai" | "github" | "sweettea-hub";
            url?: string;
            external_id?: string;
        };
    };
    compat: {
        sweet_tea_min_version: string;
        sweet_tea_max_version: string | null;
        comfyui_min_version: string | null;
        comfyui_max_version: string | null;
        platforms: string[];
    };
    entrypoints: {
        workflow: "workflow.json";
        interface: "interface.json";
        preview: "preview.png";
    };
    dependencies: {
        models: Array<{
            kind: TeaDependencyModelKind;
            name: string;
            air?: string;
            preferred_filename?: string;
            required: boolean;
            notes?: string;
        }>;
        custom_nodes: Array<{
            repo: string;
            source: "manager-registry" | "github";
            reference_url: string;
            channel: "stable" | "nightly" | "recent";
            required: boolean;
            pin: { type: "none" | "tag" | "commit"; value: string | null };
            why: string;
            declares_nodes?: string[];
        }>;
        pip: Array<{ specifier: string; required: boolean; why?: string }>;
        system: Array<{
            kind: "apt" | "dnf" | "pacman" | "brew" | "choco";
            package: string;
            required: boolean;
            why?: string;
        }>;
    };
    ui: {
        form_layout: string;
        advanced_sections: boolean;
        defaults_profile?: string;
    };
    integrity?: {
        sha256: Record<string, string>;
    };
    extensions: Record<string, unknown>;
    [key: string]: unknown;
}

export type TeaInterfaceFieldType =
    | "string"
    | "int"
    | "float"
    | "bool"
    | "enum"
    | "multi-select"
    | "file"
    | "image"
    | "lora-list"
    | "controlnet-list";

export interface TeaInterfaceV1 {
    tea_version: "1.0";
    schema_version: 1;
    fields: Array<{
        id: string;
        label: string;
        type: TeaInterfaceFieldType;
        description?: string;
        section?: string;
        group?: string;
        advanced?: boolean;
        required?: boolean;
        default?: unknown;
        options?: string[];
        constraints?: Record<string, unknown>;
        targets: Array<{ path: string }>;
        extensions?: Record<string, unknown>;
    }>;
    sections?: Array<{
        id: string;
        title: string;
        description?: string;
        advanced?: boolean;
        fields?: string[];
    }>;
    layout?: Record<string, unknown>;
    extensions?: Record<string, unknown>;
    [key: string]: unknown;
}

export const TEA_MANIFEST_V1_SCHEMA = {
    $id: "https://sweettea.studio/schemas/manifest.v1.json",
    type: "object",
    required: ["tea_version", "schema_version", "pipe", "compat", "entrypoints", "dependencies", "ui", "extensions"],
    additionalProperties: true,
    properties: {
        tea_version: { const: "1.0" },
        schema_version: { const: 1 },
        pipe: { type: "object" },
        compat: { type: "object" },
        entrypoints: { type: "object" },
        dependencies: { type: "object" },
        ui: { type: "object" },
        integrity: { type: "object" },
        extensions: { type: "object" },
    },
} as const;

export const TEA_INTERFACE_V1_SCHEMA = {
    $id: "https://sweettea.studio/schemas/interface.v1.json",
    type: "object",
    required: ["tea_version", "schema_version", "fields"],
    additionalProperties: true,
    properties: {
        tea_version: { const: "1.0" },
        schema_version: { const: 1 },
        fields: { type: "array" },
        sections: { type: "array" },
        layout: { type: "object" },
        extensions: { type: "object" },
    },
} as const;

export const validateTeaManifestV1 = (value: unknown): value is TeaManifestV1 => {
    if (!value || typeof value !== "object") return false;
    const raw = value as Record<string, unknown>;
    if (raw.tea_version !== "1.0" || raw.schema_version !== 1) return false;
    if (!raw.pipe || typeof raw.pipe !== "object") return false;
    if (!raw.compat || typeof raw.compat !== "object") return false;
    if (!raw.entrypoints || typeof raw.entrypoints !== "object") return false;
    if (!raw.dependencies || typeof raw.dependencies !== "object") return false;
    if (!raw.ui || typeof raw.ui !== "object") return false;
    const entrypoints = raw.entrypoints as Record<string, unknown>;
    return (
        entrypoints.workflow === "workflow.json" &&
        entrypoints.interface === "interface.json" &&
        entrypoints.preview === "preview.png"
    );
};

export const validateTeaInterfaceV1 = (value: unknown): value is TeaInterfaceV1 => {
    if (!value || typeof value !== "object") return false;
    const raw = value as Record<string, unknown>;
    if (raw.tea_version !== "1.0" || raw.schema_version !== 1) return false;
    if (!Array.isArray(raw.fields)) return false;
    const ids = new Set<string>();
    for (const field of raw.fields) {
        if (!field || typeof field !== "object") return false;
        const candidate = field as Record<string, unknown>;
        if (typeof candidate.id !== "string" || candidate.id.length === 0) return false;
        if (ids.has(candidate.id)) return false;
        ids.add(candidate.id);
        if (typeof candidate.label !== "string") return false;
        if (!Array.isArray(candidate.targets) || candidate.targets.length === 0) return false;
        for (const target of candidate.targets) {
            if (!target || typeof target !== "object") return false;
            const path = (target as Record<string, unknown>).path;
            if (typeof path !== "string" || !path.startsWith("/")) return false;
        }
    }
    return true;
};
