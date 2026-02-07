/**
 * Unified Prompt Extraction Utility
 * 
 * Extracts positive and negative prompts from job_params using priority-based matching:
 * 1. Explicit keys (positive, negative, prompt, text_positive, text_negative)
 * 2. Node-prefixed keys (CLIPTextEncode.text, CLIPTextEncode_2.text)
 * 3. Title-based heuristics (nodes with "Positive" or "Negative" in title)
 */

export interface PromptExtractionResult {
    positive: string | null;
    negative: string | null;
    /** The actual key in job_params where positive was found */
    positiveFieldKey: string | null;
    /** The actual key in job_params where negative was found */
    negativeFieldKey: string | null;
}

/**
 * Extract positive and negative prompts from job_params object.
 * Uses multiple heuristics to reliably identify prompt fields.
 */
export function extractPrompts(params: Record<string, unknown> | null | undefined): PromptExtractionResult {
    const result: PromptExtractionResult = {
        positive: null,
        negative: null,
        positiveFieldKey: null,
        negativeFieldKey: null,
    };

    if (!params || typeof params !== "object") {
        return result;
    }

    const entries = Object.entries(params).filter(([_, v]) => v !== undefined && v !== null);

    // Pass 1: Look for explicit positive/negative keys
    const positiveKeys = ["positive", "prompt", "text_positive", "text_g", "clip_l", "active_positive"];
    const negativeKeys = ["negative", "text_negative", "negative_prompt", "clip_l_negative", "active_negative"];
    for (const [key, value] of entries) {
        if (typeof value !== "string" || !value.trim()) continue;

        const lowerKey = key.toLowerCase();

        // Positive matches
        if (
            positiveKeys.includes(lowerKey) ||
            (lowerKey.includes("positive") && !lowerKey.includes("negative"))
        ) {
            if (!result.positive || value.length > result.positive.length) {
                result.positive = value;
                result.positiveFieldKey = key;
            }
        }

        // Negative matches
        if (
            negativeKeys.includes(lowerKey) ||
            (lowerKey.includes("negative") && !lowerKey.includes("positive"))
        ) {
            if (!result.negative || value.length > result.negative.length) {
                result.negative = value;
                result.negativeFieldKey = key;
            }
        }
    }

    // Pass 2: Look for CLIPTextEncode pattern if not found yet
    if (!result.positive || !result.negative) {
        const clipNodes: { key: string; value: string; nodeId: string }[] = [];

        for (const [key, value] of entries) {
            if (typeof value !== "string" || !value.trim()) continue;

            const lowerKey = key.toLowerCase();

            // Match patterns like "CLIPTextEncode.text" or "6.text" or "CLIPTextEncode_2.text"
            const isCLIPTextEncode =
                (lowerKey.includes("cliptextencode") && lowerKey.includes(".text")) ||
                /^\d+\.text$/i.test(key);

            // Match STRING_LITERAL patterns (common in Wan2.2 and other video workflows)
            const isStringLiteral =
                lowerKey.includes("string_literal") ||
                (lowerKey.includes(".string") && !lowerKey.includes("lora"));

            if (isCLIPTextEncode || isStringLiteral) {
                // Extract node ID from key
                const nodeIdMatch = key.match(/^(\d+)\.|^([^.]+)\./);
                const nodeId = nodeIdMatch ? (nodeIdMatch[1] || nodeIdMatch[2]) : key;
                clipNodes.push({ key, value, nodeId });
            }
        }

        // Sort by node ID to get consistent ordering
        clipNodes.sort((a, b) => {
            const aNum = parseInt(a.nodeId, 10);
            const bNum = parseInt(b.nodeId, 10);
            if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
            return a.nodeId.localeCompare(b.nodeId);
        });

        // First CLIP node is usually positive, second is usually negative
        if (clipNodes.length >= 1 && !result.positive) {
            result.positive = clipNodes[0].value;
            result.positiveFieldKey = clipNodes[0].key;
        }
        if (clipNodes.length >= 2 && !result.negative) {
            result.negative = clipNodes[1].value;
            result.negativeFieldKey = clipNodes[1].key;
        }
    }

    // Pass 3: Look for node title hints (e.g., keys containing "Positive Prompt" or "Negative Prompt")
    if (!result.positive || !result.negative) {
        for (const [key, value] of entries) {
            if (typeof value !== "string" || !value.trim()) continue;

            // Match keys that might have title annotations
            if (!result.positive && /positive.*(prompt|text)/i.test(key)) {
                result.positive = value;
                result.positiveFieldKey = key;
            }
            if (!result.negative && /negative.*(prompt|text)/i.test(key)) {
                result.negative = value;
                result.negativeFieldKey = key;
            }
        }
    }

    return result;
}

export interface ResolvedPrompts {
    positive: string;
    negative: string;
}

export function resolvePromptsForGalleryItem(item: {
    prompt?: string | null;
    negative_prompt?: string | null;
    job_params?: Record<string, unknown> | null | undefined;
}): ResolvedPrompts {
    const positiveFromItem = typeof item.prompt === "string" ? item.prompt.trim() : "";
    const negativeFromItem = typeof item.negative_prompt === "string" ? item.negative_prompt.trim() : "";

    const extracted = extractPrompts(item.job_params);
    const positiveFromParams = extracted.positive?.trim() ?? "";
    const negativeFromParams = extracted.negative?.trim() ?? "";

    return {
        positive: positiveFromItem || positiveFromParams,
        negative: negativeFromItem || negativeFromParams,
    };
}

const isTextSchemaField = (field: Record<string, unknown> | undefined): boolean => {
    if (!field) return false;
    const widget = String((field as any).widget || "").toLowerCase();
    const type = String((field as any).type || "").toLowerCase();
    const hasStringEnum = Array.isArray((field as any).enum) && (field as any).enum.length > 0;
    const hasDynamicOptions =
        Array.isArray((field as any).options) ||
        Array.isArray((field as any).x_options) ||
        Boolean((field as any).x_dynamic_options);
    const isDropdownWidget =
        widget === "select" ||
        widget === "dropdown" ||
        widget === "combo" ||
        widget === "multiselect";
    const isTextWidget = widget === "textarea" || widget === "text";
    const isStringType = type === "string" || type === "string_literal";

    return (
        (isTextWidget || (isStringType && !widget)) &&
        !hasStringEnum &&
        !hasDynamicOptions &&
        !isDropdownWidget
    );
};

/**
 * Find schema fields that match CLIPTextEncode text inputs.
 * Used to map extracted prompts to the correct form fields in a workflow.
 */
export function findPromptFieldsInSchema(
    schema: Record<string, { x_node_id?: string | number; title?: string;[k: string]: unknown }>
): { positiveField: string | null; negativeField: string | null } {
    let positiveField: string | null = null;
    let negativeField: string | null = null;

    const clipTextFields: Array<{ key: string; nodeId: string; title: string; x_title: string }> = [];

    for (const [key, field] of Object.entries(schema)) {
        if (key.startsWith("__")) continue;

        const lowerKey = key.toLowerCase();

        // Look for CLIPTextEncode and STRING_LITERAL text fields
        const isCLIPTextEncode = lowerKey.includes("cliptextencode") && lowerKey.includes(".text");
        const isStringLiteral =
            lowerKey.includes("string_literal") ||
            (lowerKey.includes(".string") && !lowerKey.includes("lora"));

        if (isCLIPTextEncode || isStringLiteral) {
            const nodeId = field.x_node_id !== undefined ? String(field.x_node_id) : key.split(".")[0];
            clipTextFields.push({
                key,
                nodeId,
                title: (field.title as string) || "",
                x_title: ((field as any).x_title as string) || ""
            });
        }
    }

    // Sort by node ID (for fallback ordering only)
    clipTextFields.sort((a, b) => {
        const aNum = parseInt(a.nodeId, 10);
        const bNum = parseInt(b.nodeId, 10);
        if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
        return a.nodeId.localeCompare(b.nodeId);
    });

    // PRIORITY 1: Use x_title attribute (most reliable - from ComfyUI node metadata)
    // x_title contains explicit labels like "Positive Prompt" or "Negative Prompt"
    for (const field of clipTextFields) {
        const lowerXTitle = field.x_title.toLowerCase();
        if (!positiveField && lowerXTitle.includes("positive")) {
            positiveField = field.key;
        }
        if (!negativeField && lowerXTitle.includes("negative")) {
            negativeField = field.key;
        }
    }

    // PRIORITY 2: Use title attribute with strict matching
    // Match "positive" explicitly, NOT generic "prompt" (which matches both)
    for (const field of clipTextFields) {
        const lowerTitle = field.title.toLowerCase();
        if (!positiveField && lowerTitle.includes("positive")) {
            positiveField = field.key;
        }
        if (!negativeField && lowerTitle.includes("negative")) {
            negativeField = field.key;
        }
    }

    // PRIORITY 3: Fallback to node order (first = positive, second = negative)
    if (!positiveField && clipTextFields.length >= 1) {
        positiveField = clipTextFields[0].key;
    }
    if (!negativeField && clipTextFields.length >= 2) {
        negativeField = clipTextFields[1].key;
    }

    // Fallback: scan all text/textarea fields for keyword matches
    if (!positiveField || !negativeField) {
        for (const [key, field] of Object.entries(schema)) {
            if (key.startsWith("__")) continue;
            const widget = (field as any)?.widget;
            const type = (field as any)?.type;
            const isText =
                widget === "textarea" ||
                widget === "text" ||
                type === "STRING" ||
                type === "string";
            if (!isText) continue;

            const label = `${(field as any)?.title || ""} ${key}`.toLowerCase();

            if (!positiveField && /(positive|pos)[ _-]?(prompt|text)?/.test(label)) {
                positiveField = key;
            }
            if (!negativeField && /(negative|neg)[ _-]?(prompt|text)?/.test(label)) {
                negativeField = key;
            }

            if (positiveField && negativeField) break;
        }
    }

    return { positiveField, negativeField };
}

export function findCaptionInputFieldInSchema(
    schema: Record<string, { title?: string; widget?: string; type?: string; x_node_id?: string | number; [k: string]: unknown }>,
    nodeOrder?: string[]
): string | null {
    const explicit = Object.entries(schema).find(([key, field]) => {
        if (key.startsWith("__")) return false;
        if (!isTextSchemaField(field)) return false;
        return (field as any).x_use_media_caption === true;
    });
    if (explicit) return explicit[0];

    const textCandidates = Object.entries(schema).filter(([key, field]) => {
        if (key.startsWith("__")) return false;
        return isTextSchemaField(field);
    });

    if (!textCandidates.length) return null;

    const sortByNodeOrder = <T extends { key: string; nodeId: string }>(items: T[]) => {
        if (!nodeOrder || nodeOrder.length === 0) return items;
        return [...items].sort((a, b) => {
            const aIndex = nodeOrder.indexOf(a.nodeId);
            const bIndex = nodeOrder.indexOf(b.nodeId);
            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return 0;
        });
    };

    const normalizedCandidates = sortByNodeOrder(
        textCandidates.map(([key, field]) => ({
            key,
            nodeId: String((field as any).x_node_id ?? key.split(".")[0] ?? ""),
            label: `${String((field as any).title || "")} ${key}`.toLowerCase(),
        }))
    );

    const captionNamed = normalizedCandidates.find((candidate) =>
        /\b(caption|description|image text)\b/.test(candidate.label)
    );
    if (captionNamed) return captionNamed.key;

    return null;
}

/**
 * Find schema fields that are image uploads (LoadImage nodes).
 * Used to map source images to the correct form fields in a workflow.
 */
export type MediaKind = "image" | "video";

const resolveMediaKind = (field: { x_media_kind?: unknown }): MediaKind | null => {
    if (typeof field.x_media_kind !== "string") {
        return null;
    }
    const normalized = field.x_media_kind.toLowerCase();
    if (normalized === "image" || normalized === "video") {
        return normalized;
    }
    return null;
};

export function findMediaFieldsInSchema(
    schema: Record<string, { widget?: string; title?: string; x_media_kind?: unknown; x_class_type?: unknown; x_node_id?: string | number;[k: string]: unknown }>,
    kind: MediaKind = "image",
    nodeOrder?: string[]
): string[] {
    const mediaFields: string[] = [];

    for (const [key, field] of Object.entries(schema)) {
        if (key.startsWith("__")) continue;

        const resolvedKind = resolveMediaKind(field);
        if (resolvedKind && resolvedKind !== kind) {
            continue;
        }

        const lowerKey = key.toLowerCase();
        const lowerTitle = String(field.title || "").toLowerCase();
        const lowerClass = String(field.x_class_type || "").toLowerCase();

        if (!resolvedKind && kind === "video" && !(lowerKey.endsWith(".video") && lowerClass.includes("loadvideo"))) {
            continue;
        }

        const isMediaUpload =
            field.widget === "upload" ||
            field.widget === "image_upload" ||
            field.widget === "media_upload" ||
            lowerKey.includes("loadimage") ||
            lowerTitle.includes("loadimage") ||
            lowerClass.includes("loadimage") ||
            (lowerKey.endsWith(".video") && lowerClass.includes("loadvideo"));

        if (isMediaUpload) {
            mediaFields.push(key);
        }
    }

    // Sort by nodeOrder if provided (respects user-defined order from pipe editor)
    if (nodeOrder && nodeOrder.length > 0) {
        mediaFields.sort((a, b) => {
            const aNodeId = String(schema[a]?.x_node_id ?? "");
            const bNodeId = String(schema[b]?.x_node_id ?? "");
            const aIndex = nodeOrder.indexOf(aNodeId);
            const bIndex = nodeOrder.indexOf(bNodeId);
            // If both found in nodeOrder, sort by position
            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
            // If only one found, prioritize the one in nodeOrder
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            // Neither in nodeOrder, keep original order
            return 0;
        });
    }

    return mediaFields;
}

export function findImageFieldsInSchema(
    schema: Record<string, { widget?: string; title?: string; x_media_kind?: unknown; x_node_id?: string | number;[k: string]: unknown }>,
    nodeOrder?: string[]
): string[] {
    return findMediaFieldsInSchema(schema, "image", nodeOrder);
}
