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

    const entries = Object.entries(params);

    // Pass 1: Look for explicit positive/negative keys
    for (const [key, value] of entries) {
        if (typeof value !== "string" || !value.trim()) continue;

        const lowerKey = key.toLowerCase();

        // Positive matches
        if (
            lowerKey === "positive" ||
            lowerKey === "prompt" ||
            lowerKey === "text_positive" ||
            lowerKey === "text_g" ||
            lowerKey === "clip_l" ||
            (lowerKey.includes("positive") && !lowerKey.includes("negative"))
        ) {
            if (!result.positive || value.length > result.positive.length) {
                result.positive = value;
                result.positiveFieldKey = key;
            }
        }

        // Negative matches
        if (
            lowerKey === "negative" ||
            lowerKey === "text_negative" ||
            lowerKey === "negative_prompt" ||
            lowerKey === "clip_l_negative" ||
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
            if (
                lowerKey.includes("cliptextencode") && lowerKey.includes(".text") ||
                /^\d+\.text$/i.test(key)
            ) {
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

/**
 * Find schema fields that match CLIPTextEncode text inputs.
 * Used to map extracted prompts to the correct form fields in a workflow.
 */
export function findPromptFieldsInSchema(
    schema: Record<string, { x_node_id?: string | number; title?: string;[k: string]: unknown }>
): { positiveField: string | null; negativeField: string | null } {
    let positiveField: string | null = null;
    let negativeField: string | null = null;

    const clipTextFields: Array<{ key: string; nodeId: string; title: string }> = [];

    for (const [key, field] of Object.entries(schema)) {
        if (key.startsWith("__")) continue;

        const lowerKey = key.toLowerCase();

        // Look for CLIPTextEncode text fields
        if (lowerKey.includes("cliptextencode") && lowerKey.includes(".text")) {
            const nodeId = field.x_node_id !== undefined ? String(field.x_node_id) : key.split(".")[0];
            clipTextFields.push({ key, nodeId, title: field.title || "" });
        }
    }

    // Sort by node ID
    clipTextFields.sort((a, b) => {
        const aNum = parseInt(a.nodeId, 10);
        const bNum = parseInt(b.nodeId, 10);
        if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
        return a.nodeId.localeCompare(b.nodeId);
    });

    // Assign based on title hints first, then by order
    for (const field of clipTextFields) {
        const lowerTitle = field.title.toLowerCase();
        if (lowerTitle.includes("positive") || lowerTitle.includes("prompt")) {
            if (!positiveField) positiveField = field.key;
        } else if (lowerTitle.includes("negative")) {
            if (!negativeField) negativeField = field.key;
        }
    }

    // Fallback to order if titles didn't help
    if (!positiveField && clipTextFields.length >= 1) {
        positiveField = clipTextFields[0].key;
    }
    if (!negativeField && clipTextFields.length >= 2) {
        negativeField = clipTextFields[1].key;
    }

    return { positiveField, negativeField };
}

/**
 * Find schema fields that are image uploads (LoadImage nodes).
 * Used to map source images to the correct form fields in a workflow.
 */
export function findImageFieldsInSchema(
    schema: Record<string, { widget?: string; title?: string;[k: string]: unknown }>
): string[] {
    const imageFields: string[] = [];

    for (const [key, field] of Object.entries(schema)) {
        if (key.startsWith("__")) continue;

        const lowerKey = key.toLowerCase();
        const isImageUpload =
            field.widget === "upload" ||
            field.widget === "image_upload" ||
            lowerKey.includes("loadimage") ||
            (field.title && field.title.toLowerCase().includes("loadimage"));

        if (isImageUpload) {
            imageFields.push(key);
        }
    }

    return imageFields;
}
