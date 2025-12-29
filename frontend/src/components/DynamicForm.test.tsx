import type { PropsWithChildren, ReactElement } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Provider as JotaiProvider } from "jotai";
import { DynamicForm } from "./DynamicForm";
import { UndoRedoProvider } from "@/lib/undoRedo";

const noop = () => undefined;

const Providers = ({ children }: PropsWithChildren) => (
    <JotaiProvider>
        <UndoRedoProvider>{children}</UndoRedoProvider>
    </JotaiProvider>
);

const renderForm = (ui: ReactElement) => render(ui, { wrapper: Providers });

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

        const { getByText } = renderForm(
            <DynamicForm schema={annotatedSchema} onSubmit={noop} submitLabel="Submit" />
        );

        expect(getByText("input images")).toBeTruthy();
        expect(getByText("Story Node")).toBeTruthy();
        expect(getByText("Custom Node")).toBeTruthy();
    });

    it("falls back to heuristic grouping", () => {
        const heuristicSchema = {
            mystery_value: { title: "Mystery (NodeX)", type: "integer" },
            unexplained_text: { widget: "textarea", title: "Unknown Text" }
        };

        const { getByText } = renderForm(
            <DynamicForm schema={heuristicSchema} onSubmit={noop} submitLabel="Submit" />
        );

        expect(getByText("NodeX")).toBeTruthy();
        expect(getByText("Unknown Text")).toBeTruthy();
    });

    it("orders core and expanded nodes by provided node order", () => {
        const orderedSchema = {
            node_a_core: {
                title: "Node A Core",
                x_node_id: "node-a",
                x_core: true,
                x_form: { section: "nodes", groupId: "node-a", groupTitle: "Node A" }
            },
            node_a_extra: {
                title: "Node A Extra",
                x_node_id: "node-a",
                x_form: { section: "nodes", groupId: "node-a", groupTitle: "Node A" }
            },
            node_b_core: {
                title: "Node B Core",
                x_node_id: "node-b",
                x_core: true,
                x_form: { section: "nodes", groupId: "node-b", groupTitle: "Node B" }
            },
            node_b_extra: {
                title: "Node B Extra",
                x_node_id: "node-b",
                x_form: { section: "nodes", groupId: "node-b", groupTitle: "Node B" }
            }
        };

        const nodeOrder = ["node-b", "node-a"]; // B should render before A everywhere

        const { container } = renderForm(
            <DynamicForm
                schema={orderedSchema}
                nodeOrder={nodeOrder}
                onSubmit={noop}
                submitLabel="Submit"
            />
        );

        const coreStack = container.querySelector("[data-core-stack]");
        const coreTitles = Array.from(coreStack?.querySelectorAll("[data-node-stack-item]") || [])
            .map(el => el.getAttribute("data-node-title"))
            .filter(Boolean);
        expect(coreTitles).toEqual(["Node B", "Node A"]);

        const expandedStack = container.querySelector("[data-expanded-stack]");
        const expandedTitles = Array.from(expandedStack?.querySelectorAll("[data-node-stack-item]") || [])
            .map(el => el.getAttribute("data-node-title"))
            .filter(Boolean);
        expect(expandedTitles).toEqual(["Node B", "Node A"]);
    });

    it("applies bypass toggle defaults from schema", () => {
        const bypassSchema = {
            "controlnet_strength": {
                title: "Strength",
                type: "number",
                default: 1.0,
                x_node_id: "10",
                x_core: true,
                x_form: { section: "nodes", groupId: "10", groupTitle: "ControlNet" }
            },
            "__bypass_10": {
                widget: "toggle",
                type: "boolean",
                title: "Bypass ControlNet",
                default: true,  // This should be respected - node bypassed by default
                x_node_id: "10"
            }
        };

        const { getByText } = renderForm(
            <DynamicForm
                schema={bypassSchema}
                onSubmit={noop}
            />
        );

        // The bypass toggle should render and show "Bypassed" state
        // Look for the bypassed indicator in the UI
        expect(getByText("Bypassed")).toBeTruthy();
    });
});
