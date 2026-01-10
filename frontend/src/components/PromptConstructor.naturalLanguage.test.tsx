import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Provider as JotaiProvider } from "jotai";
import type { Dispatch, PropsWithChildren, SetStateAction } from "react";
import { PromptConstructor, COLORS } from "./PromptConstructor";
import { UndoRedoProvider } from "@/lib/undoRedo";
import type { PromptItem } from "@/lib/types";

const Providers = ({ children }: PropsWithChildren) => (
    <JotaiProvider>
        <UndoRedoProvider>{children}</UndoRedoProvider>
    </JotaiProvider>
);

describe("PromptConstructor natural language snippets", () => {
    it("compiles natural language snippets with spaces (no comma delimiter)", async () => {
        const onUpdate = vi.fn();
        const onUpdateSnippets = vi.fn();

        const schema = {
            prompt: { type: "string", widget: "textarea", title: "Prompt" },
        };

        const s1: PromptItem = {
            id: "s1",
            type: "block",
            label: "S1",
            content: "Hello world.",
            color: COLORS[0],
        };

        const s2: PromptItem = {
            id: "s2",
            type: "block",
            label: "S2",
            content: "How are you?",
            color: COLORS[1],
        };

        render(
            <PromptConstructor
                schema={schema}
                onUpdate={onUpdate}
                currentValues={{ prompt: "" }}
                targetField="prompt"
                onTargetChange={() => undefined}
                onFinish={() => undefined}
                snippets={[s1, s2]}
                onUpdateSnippets={onUpdateSnippets as unknown as Dispatch<SetStateAction<PromptItem[]>>}
            />,
            { wrapper: Providers }
        );

        fireEvent.doubleClick(screen.getByText("S1"));
        fireEvent.doubleClick(screen.getByText("S2"));

        await waitFor(() => expect(onUpdate).toHaveBeenCalled());
        expect(onUpdate).toHaveBeenLastCalledWith("prompt", "Hello world. How are you?");
    });

    it("treats whitespace-only gaps between NL snippets as delimiters (no blank Text items)", async () => {
        const onUpdate = vi.fn();
        const onUpdateMany = vi.fn();
        const onUpdateSnippets = vi.fn();

        const schema = {
            prompt: { type: "string", widget: "textarea", title: "Prompt" },
        };

        const s1: PromptItem = {
            id: "s1",
            type: "block",
            label: "S1",
            content: "Hello world.",
            color: COLORS[0],
        };

        const s2: PromptItem = {
            id: "s2",
            type: "block",
            label: "S2",
            content: "How are you?",
            color: COLORS[1],
        };

        render(
            <PromptConstructor
                schema={schema}
                onUpdate={onUpdate}
                onUpdateMany={onUpdateMany}
                currentValues={{ prompt: "Hello world. How are you?" }}
                targetField="prompt"
                onTargetChange={() => undefined}
                onFinish={() => undefined}
                snippets={[s1, s2]}
                onUpdateSnippets={onUpdateSnippets as unknown as Dispatch<SetStateAction<PromptItem[]>>}
            />,
            { wrapper: Providers }
        );

        await waitFor(() =>
            expect(screen.queryByText("Drag snippets here to build prompt")).not.toBeInTheDocument()
        );

        expect(screen.queryByText("Text 1")).not.toBeInTheDocument();
        expect(onUpdateMany).not.toHaveBeenCalled();
    });
});

