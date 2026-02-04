
import { render, waitFor, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Provider as JotaiProvider } from "jotai";
import type { Dispatch, PropsWithChildren, SetStateAction } from "react";
import { PromptConstructor, COLORS } from "./PromptConstructor";
import { UndoRedoProvider } from "@/lib/undoRedo";
import type { PromptItem, PromptRehydrationSnapshotV1 } from "@/lib/types";

const Providers = ({ children }: PropsWithChildren) => (
    <JotaiProvider>
        <UndoRedoProvider>{children}</UndoRedoProvider>
    </JotaiProvider>
);

describe("PromptConstructor stale snippet rehydration", () => {
    it("preserves stale snippets as blocks during rehydration", async () => {
        const onUpdate = vi.fn();
        const onUpdateMany = vi.fn();
        const onUpdateSnippets = vi.fn();
        const onRehydrationSnapshot = vi.fn();

        const schema = {
            prompt: { type: "string", widget: "textarea", title: "Prompt" },
        };

        // Case: We have a prompt "foo" that corresponds to a stale snippet (deleted or modified).
        const currentValues = { prompt: "foo" };

        // The snapshot remembers it was a snippet with content "foo"
        const snapshot: PromptRehydrationSnapshotV1 = {
            version: 1,
            fields: {
                prompt: [
                    {
                        type: "block",
                        sourceId: "stale-id",
                        content: "foo",
                        label: "Stale Snippet",
                        color: COLORS[0]
                    }
                ]
            }
        };

        // The library is empty (snippet deleted) OR has different content (snippet modified)
        // Here we test the "deleted" case as it's the most extreme "stale" case.
        const snippets: PromptItem[] = [];

        const { container } = render(
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
                rehydrationSnapshot={snapshot}
                rehydrationKey={1} // Trigger rehydration
                externalValueSyncKey={1}
                onRehydrationSnapshot={onRehydrationSnapshot}
            />,
            { wrapper: Providers }
        );

        // Wait for rehydration effect
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Expectation: The component should render a BLOCK, not just text.
        // We look for the label "Stale Snippet" which only exists in the block definition.

        // NOTE: In the broken state, the reconciliation logic will see "foo" in text, 
        // see empty library, and overwrite the rehydrated block with a Text item "foo".
        // So we expect this to FAIL until fixed.
        const block = screen.queryByText("Stale Snippet");
        expect(block).toBeInTheDocument();
    });
});
