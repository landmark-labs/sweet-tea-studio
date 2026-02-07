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

const schema = {
    prompt: { type: "string", widget: "textarea", title: "Prompt" },
};

function makeBlock(id: string, label: string, content: string, colorIndex = 0): PromptItem {
    return {
        id,
        type: "block",
        label,
        content,
        color: COLORS[colorIndex],
    };
}

async function settleSyncGuard() {
    // PromptConstructor's internal sync guard clears on a 0ms tick.
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

function renderSnippetSyncHarness(currentValues: Record<string, string>, snippets: PromptItem[]) {
    const onUpdate = vi.fn();
    const onUpdateMany = vi.fn();
    const onUpdateSnippets = vi.fn();

    const renderResult = render(
        <PromptConstructor
            schema={schema}
            onUpdate={onUpdate}
            onUpdateMany={onUpdateMany}
            currentValues={currentValues}
            targetField="prompt"
            onTargetChange={() => undefined}
            onFinish={() => undefined}
            snippets={snippets}
            onUpdateSnippets={onUpdateSnippets as unknown as Dispatch<SetStateAction<PromptItem[]>>}
        />,
        { wrapper: Providers }
    );

    const rerenderWithSnippets = async (nextSnippets: PromptItem[]) => {
        await act(async () => {
            renderResult.rerender(
                <PromptConstructor
                    schema={schema}
                    onUpdate={onUpdate}
                    onUpdateMany={onUpdateMany}
                    currentValues={currentValues}
                    targetField="prompt"
                    onTargetChange={() => undefined}
                    onFinish={() => undefined}
                    snippets={nextSnippets}
                    onUpdateSnippets={onUpdateSnippets as unknown as Dispatch<SetStateAction<PromptItem[]>>}
                />
            );
        });
    };

    return {
        onUpdate,
        onUpdateMany,
        rerenderWithSnippets,
    };
}

describe("PromptConstructor snippet sync", () => {
    it("rewrites prompt values using previous snippet content on library edit", async () => {
        const currentValues = { prompt: "foo, something" };
        const oldSnippet = makeBlock("s1", "Foo", "foo");
        const nextSnippet: PromptItem = {
            ...makeBlock("s1", "Foo", "foo"),
            content: "bar",
        };

        const { onUpdate, onUpdateMany, rerenderWithSnippets } =
            renderSnippetSyncHarness(currentValues, [oldSnippet]);

        await settleSyncGuard();
        await rerenderWithSnippets([nextSnippet]);

        await waitFor(() => expect(onUpdateMany).toHaveBeenCalled());
        expect(onUpdateMany).toHaveBeenLastCalledWith({ prompt: "bar, something" });
        expect(onUpdate).not.toHaveBeenCalled();
    });

    it("relinks text-only prompt segments into snippet blocks when an edited snippet now matches", async () => {
        const currentValues = { prompt: "bar, something" };
        const oldSnippet = makeBlock("s1", "Foo", "foo");
        const nextSnippet: PromptItem = {
            ...makeBlock("s1", "Foo", "foo"),
            content: "bar",
        };

        const { rerenderWithSnippets } = renderSnippetSyncHarness(currentValues, [oldSnippet]);

        await settleSyncGuard();
        await rerenderWithSnippets([nextSnippet]);

        await waitFor(() => {
            expect(screen.getAllByText("Foo").length).toBeGreaterThan(1);
        });
    });

    it("relinks matching text segments even when other linked blocks already exist", async () => {
        const currentValues = { prompt: "bar, baz" };
        const oldFoo = makeBlock("s1", "Foo", "foo");
        const baz = makeBlock("s2", "Baz", "baz", 1);
        const nextFoo: PromptItem = {
            ...makeBlock("s1", "Foo", "foo"),
            content: "bar",
        };

        const { rerenderWithSnippets } = renderSnippetSyncHarness(currentValues, [oldFoo, baz]);

        await settleSyncGuard();
        await rerenderWithSnippets([nextFoo, baz]);

        await waitFor(() => {
            expect(screen.getAllByText("Foo").length).toBeGreaterThan(1);
        });
    });
});
