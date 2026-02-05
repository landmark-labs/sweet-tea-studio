import { act, render, screen, waitFor } from "@testing-library/react";
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

describe("PromptConstructor snippet sync", () => {
    it("rewrites prompt values using previous snippet content on library edit", async () => {
        const onUpdate = vi.fn();
        const onUpdateMany = vi.fn();
        const onUpdateSnippets = vi.fn();

        const schema = {
            prompt: { type: "string", widget: "textarea", title: "Prompt" },
        };

        const currentValues = { prompt: "foo, something" };

        const oldSnippet: PromptItem = {
            id: "s1",
            type: "block",
            label: "Foo",
            content: "foo",
            color: COLORS[0],
        };

        const nextSnippet: PromptItem = {
            ...oldSnippet,
            content: "bar",
        };

        const { rerender } = render(
            <PromptConstructor
                schema={schema}
                onUpdate={onUpdate}
                onUpdateMany={onUpdateMany}
                currentValues={currentValues}
                targetField="prompt"
                onTargetChange={() => undefined}
                onFinish={() => undefined}
                snippets={[oldSnippet]}
                onUpdateSnippets={onUpdateSnippets as unknown as Dispatch<SetStateAction<PromptItem[]>>}
            />,
            { wrapper: Providers }
        );

        // PromptConstructor's internal sync guard clears on a 0ms tick.
        // Ensure it's settled before we simulate a snippet library edit.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        await act(async () => {
            rerender(
                <PromptConstructor
                    schema={schema}
                    onUpdate={onUpdate}
                    onUpdateMany={onUpdateMany}
                    currentValues={currentValues}
                    targetField="prompt"
                    onTargetChange={() => undefined}
                    onFinish={() => undefined}
                    snippets={[nextSnippet]}
                    onUpdateSnippets={onUpdateSnippets as unknown as Dispatch<SetStateAction<PromptItem[]>>}
                />
            );
        });

        await waitFor(() => expect(onUpdateMany).toHaveBeenCalled());
        expect(onUpdateMany).toHaveBeenLastCalledWith({ prompt: "bar, something" });
        expect(onUpdate).not.toHaveBeenCalled();
    });

    it("relinks text-only prompt segments into snippet blocks when an edited snippet now matches", async () => {
        const onUpdate = vi.fn();
        const onUpdateMany = vi.fn();
        const onUpdateSnippets = vi.fn();

        const schema = {
            prompt: { type: "string", widget: "textarea", title: "Prompt" },
        };

        const currentValues = { prompt: "bar, something" };

        const oldSnippet: PromptItem = {
            id: "s1",
            type: "block",
            label: "Foo",
            content: "foo",
            color: COLORS[0],
        };

        const nextSnippet: PromptItem = {
            ...oldSnippet,
            content: "bar",
        };

        const { rerender } = render(
            <PromptConstructor
                schema={schema}
                onUpdate={onUpdate}
                onUpdateMany={onUpdateMany}
                currentValues={currentValues}
                targetField="prompt"
                onTargetChange={() => undefined}
                onFinish={() => undefined}
                snippets={[oldSnippet]}
                onUpdateSnippets={onUpdateSnippets as unknown as Dispatch<SetStateAction<PromptItem[]>>}
            />,
            { wrapper: Providers }
        );

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        await act(async () => {
            rerender(
                <PromptConstructor
                    schema={schema}
                    onUpdate={onUpdate}
                    onUpdateMany={onUpdateMany}
                    currentValues={currentValues}
                    targetField="prompt"
                    onTargetChange={() => undefined}
                    onFinish={() => undefined}
                    snippets={[nextSnippet]}
                    onUpdateSnippets={onUpdateSnippets as unknown as Dispatch<SetStateAction<PromptItem[]>>}
                />
            );
        });

        await waitFor(() => {
            expect(screen.getAllByText("Foo").length).toBeGreaterThan(1);
        });
    });
});
