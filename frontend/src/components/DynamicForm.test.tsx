import type { PropsWithChildren, ReactElement } from "react";
import { render, fireEvent } from "@testing-library/react";
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

        const { container } = renderForm(
            <DynamicForm schema={annotatedSchema} onSubmit={noop} submitLabel="Submit" />
        );

        expect(container).toMatchSnapshot();
    });

    it("falls back to heuristic grouping", async () => {
        const heuristicSchema = {
            mystery_value: { title: "Mystery (NodeX)", type: "integer" },
            unexplained_text: { widget: "textarea", title: "Unknown Text" }
        };

        const { container } = renderForm(
            <DynamicForm schema={heuristicSchema} onSubmit={noop} submitLabel="Submit" />
        );

        expect(container).toMatchSnapshot();
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

        const { container, getByText } = renderForm(
            <DynamicForm
                schema={orderedSchema}
                nodeOrder={nodeOrder}
                onSubmit={noop}
                submitLabel="Submit"
            />
        );

        const coreSection = getByText("core pipe controls").parentElement?.parentElement;
        const coreTitles = Array.from(coreSection?.querySelectorAll("h4") || [])
            .map(el => el.textContent?.trim())
            .filter(Boolean);
        expect(coreTitles).toEqual(["Node B", "Node A"]);

        fireEvent.click(getByText("EXPANDED CONTROLS"));
        const expandedTitles = Array.from(container.querySelectorAll("[data-radix-collection-item]"))
            .map(el => el.textContent?.replace(/\s+/g, " ").trim())
            .filter(text => /Node [AB]/.test(text));
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
