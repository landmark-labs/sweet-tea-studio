import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImageViewer } from "./ImageViewer";
import { api, Image as ApiImage } from "@/lib/api";

describe("ImageViewer prompt copy", () => {
    let metadataSpy: ReturnType<typeof vi.spyOn<typeof api, "getImageMetadata">>;
    const sampleImage: ApiImage = {
        id: 1,
        job_id: 1,
        path: "/tmp/example.png",
        filename: "example.png",
        created_at: "2024-01-01T00:00:00Z"
    };

    beforeEach(() => {
        metadataSpy = vi.spyOn(api, "getImageMetadata").mockResolvedValue({
            path: sampleImage.path,
            prompt: "positive from png",
            negative_prompt: "negative from png",
            parameters: {},
            source: "database"
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Object.defineProperty(navigator, "clipboard", { value: undefined, writable: true, configurable: true });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (document.execCommand as any) = undefined;
    });

    it("copies the positive prompt with the Clipboard API and shows confirmation", async () => {
        metadataSpy.mockResolvedValueOnce({
            path: sampleImage.path,
            prompt: "A scenic positive",
            negative_prompt: "A cautious negative",
            parameters: {},
            source: "database"
        });
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, writable: true, configurable: true });

        render(
            <ImageViewer
                images={[sampleImage]}
                metadata={{ prompt: "A scenic positive", negative_prompt: "A cautious negative", job_params: {} }}
            />
        );

        const copyButton = await screen.findByLabelText("Copy positive prompt");
        fireEvent.click(copyButton);

        await waitFor(() => expect(writeText).toHaveBeenCalledWith("A scenic positive"));
        await waitFor(() => expect(copyButton).toHaveAttribute("aria-label", "Copied positive prompt"));
    });

    it("falls back to execCommand when Clipboard API is unavailable", async () => {
        metadataSpy.mockResolvedValueOnce({
            path: sampleImage.path,
            prompt: "Another positive",
            negative_prompt: "Another negative",
            parameters: {},
            source: "database"
        });
        Object.defineProperty(navigator, "clipboard", { value: undefined, writable: true, configurable: true });
        const execSpy = vi.fn().mockReturnValue(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (document.execCommand as any) = execSpy;

        render(
            <ImageViewer
                images={[sampleImage]}
                metadata={{ prompt: "Another positive", negative_prompt: "Another negative", job_params: {} }}
            />
        );

        const copyButton = await screen.findByLabelText("Copy negative prompt");
        fireEvent.click(copyButton);

        await waitFor(() => expect(execSpy).toHaveBeenCalledWith("copy"));
    });
});
