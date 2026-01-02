import { describe, expect, it } from "vitest";

import { resolvePromptsForGalleryItem } from "./promptUtils";

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

