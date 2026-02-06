import { describe, expect, it } from "vitest";

import { findCaptionInputFieldInSchema, resolvePromptsForGalleryItem } from "./promptUtils";

describe("resolvePromptsForGalleryItem", () => {
    it("prefers GalleryItem prompt fields over job_params", () => {
        const resolved = resolvePromptsForGalleryItem({
            prompt: "video positive",
            negative_prompt: "video negative",
            job_params: { seed: 123, steps: 20 },
        });

        expect(resolved).toEqual({ positive: "video positive", negative: "video negative" });
    });

    it("falls back to job_params when GalleryItem prompts are missing/blank", () => {
        const resolved = resolvePromptsForGalleryItem({
            prompt: "   ",
            negative_prompt: null,
            job_params: { prompt: "from params", negative_prompt: "neg from params" },
        });

        expect(resolved).toEqual({ positive: "from params", negative: "neg from params" });
    });
});

describe("findCaptionInputFieldInSchema", () => {
    it("prefers explicit x_use_media_caption field", () => {
        const key = findCaptionInputFieldInSchema({
            "10.prompt_text": { type: "string", title: "Prompt" },
            "11.caption_text": { type: "string", title: "Caption", x_use_media_caption: true },
        });

        expect(key).toBe("11.caption_text");
    });

    it("falls back to caption-like text fields when explicit flag is missing", () => {
        const key = findCaptionInputFieldInSchema(
            {
                "30.free_text": { type: "string", title: "Description" },
                "20.notes": { type: "string", title: "Notes" },
            },
            ["20", "30"]
        );

        expect(key).toBe("30.free_text");
    });
});
