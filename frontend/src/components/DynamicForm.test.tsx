import { render, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DynamicForm } from "./DynamicForm";


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

    it("falls back to heuristic grouping", async () => {
        const heuristicSchema = {
            mystery_value: { title: "Mystery (NodeX)", type: "integer" },
            unexplained_text: { widget: "textarea", title: "Unknown Text" }
        };

        const { container } = render(
            <DynamicForm schema={heuristicSchema} onSubmit={noop} engineId="test-engine" submitLabel="Submit" />
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

        const { container, getByText } = render(
            <DynamicForm
                schema={orderedSchema}
                nodeOrder={nodeOrder}
                onSubmit={noop}
                engineId="test-engine"
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
});

