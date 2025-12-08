import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DynamicForm } from "./DynamicForm";
import { sendTelemetryEvent } from "@/lib/telemetry";

vi.mock("@/lib/telemetry", () => ({
    sendTelemetryEvent: vi.fn()
}));

const noop = () => undefined;

describe("DynamicForm grouping", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it("respects explicit x_form annotations for custom nodes", () => {
        const annotatedSchema = {
            image_input: { widget: "upload", title: "Load Image", x_form: { section: "inputs" } },
            story_prompt: {
                widget: "textarea",
                title: "Story Prompt",
                x_form: { section: "prompts", groupTitle: "Story Node", order: 1 }
            },
            custom_toggle: {
                widget: "toggle",
                title: "Enable Feature",
                x_form: { section: "nodes", groupId: "custom-node", groupTitle: "Custom Node", order: 2 }
            },
            custom_choice: {
                enum: ["one", "two"],
                title: "Branch",
                x_form: { section: "nodes", groupId: "custom-node", groupTitle: "Custom Node", order: 2 }
            }
        };

        const { container } = render(
            <DynamicForm schema={annotatedSchema} onSubmit={noop} engineId="test-engine" submitLabel="Submit" />
        );

        expect(container).toMatchSnapshot();
    });

    it("falls back to heuristic grouping and emits telemetry for ambiguous fields", async () => {
        const heuristicSchema = {
            mystery_value: { title: "Mystery (NodeX)", type: "integer" },
            unexplained_text: { widget: "textarea", title: "Unknown Text" }
        };

        const { container } = render(
            <DynamicForm schema={heuristicSchema} onSubmit={noop} engineId="test-engine" submitLabel="Submit" />
        );

        expect(container).toMatchSnapshot();

        await waitFor(() => {
            expect(sendTelemetryEvent).toHaveBeenCalledWith(
                "dynamic_form.grouping_signal",
                expect.objectContaining({
                    engineId: "test-engine",
                    fields: expect.arrayContaining([
                        expect.objectContaining({ key: "unexplained_text", groupId: "default" })
                    ])
                })
            );
        });
    });
});

