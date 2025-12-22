import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { GenerationFeedItem } from "@/components/GenerationFeed";
import { PromptLibraryItem } from "@/lib/api";

export const PROMPT_LIBRARY_STALE_MS = 5 * 60 * 1000;
const PROGRESS_UPDATE_STEP = 2; // minimum percent change before persisting progress

interface GenerationFeedState {
  generationFeed: GenerationFeedItem[];
  setGenerationFeed: (items: GenerationFeedItem[]) => void;
  trackFeedStart: (jobId: number) => void;
  updateFeed: (jobId: number, updates: Partial<GenerationFeedItem>) => void;
  clearPreviewBlobs: () => void;
  clearFeed: () => void;
}

interface PromptLibraryState {
  prompts: PromptLibraryItem[];
  searchQuery: string;
  lastWorkflowId: string | null;
  lastQuery: string;
  lastFetchedAt: number | null;
  setSearchQuery: (value: string) => void;
  setPrompts: (items: PromptLibraryItem[], workflowId?: string | null, query?: string) => void;
  clearPrompts: () => void;
  shouldRefetch: (workflowId?: string | null, query?: string, staleMs?: number) => boolean;
}

const shallowEqual = (a: GenerationFeedItem, b: GenerationFeedItem) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    // @ts-expect-error index access
    if (a[key] !== b[key]) return false;
  }
  return true;
};

export const useGenerationFeedStore = create<GenerationFeedState>()(
  persist(
    (set, get) => ({
      generationFeed: [],
      setGenerationFeed: (items) => set({ generationFeed: items }),
      trackFeedStart: (jobId: number) => {
        const existing = get().generationFeed;
        const nextItem: GenerationFeedItem = {
          jobId,
          status: "queued",
          progress: 0,
          previewPath: null,
          previewPaths: [],
          startedAt: new Date().toISOString(),
        };
        const trimmedExisting = existing
          .filter((item) => item.jobId !== jobId)
          .map(({ previewBlob, ...rest }) => rest);
        set({
          generationFeed: [
            nextItem,
            ...trimmedExisting,
          ].slice(0, 8),
        });
      },
      updateFeed: (jobId, updates) => {
        set((state) => {
          let mutated = false;

          const nextFeed = state.generationFeed.map((item) => {
            if (item.jobId !== jobId) return item;

            const nextUpdates = { ...updates };
            if (
              typeof nextUpdates.progress === "number" &&
              typeof item.progress === "number" &&
              Math.abs(nextUpdates.progress - item.progress) < PROGRESS_UPDATE_STEP &&
              (!nextUpdates.status || nextUpdates.status === item.status)
            ) {
              delete nextUpdates.progress;
            }

            const merged = { ...item, ...nextUpdates };
            if (shallowEqual(item, merged)) {
              return item;
            }
            mutated = true;
            return merged;
          });

          if (!mutated) return state;
          return { generationFeed: nextFeed };
        });
      },
      clearPreviewBlobs: () =>
        set((state) => ({
          generationFeed: state.generationFeed.map(({ previewBlob, ...rest }) => rest),
        })),
      clearFeed: () => set({ generationFeed: [] }),
    }),
    {
      name: "ds_generation_feed",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        generationFeed: state.generationFeed.map(({ previewBlob, ...rest }) => rest),
      }),
    }
  )
);

export const usePromptLibraryStore = create<PromptLibraryState>()(
  persist(
    (set, get) => ({
      prompts: [],
      searchQuery: "",
      lastWorkflowId: null,
      lastQuery: "",
      lastFetchedAt: null,
      setSearchQuery: (value) => set({ searchQuery: value }),
      setPrompts: (items, workflowId = null, query = "") =>
        set({
          prompts: items,
          lastWorkflowId: workflowId,
          lastQuery: query,
          lastFetchedAt: Date.now(),
        }),
      clearPrompts: () =>
        set({ prompts: [], lastWorkflowId: null, lastQuery: "", lastFetchedAt: null }),
      shouldRefetch: (workflowId, query, staleMs = PROMPT_LIBRARY_STALE_MS) => {
        const state = get();
        if (!state.prompts.length) return true;
        if ((workflowId ?? null) !== state.lastWorkflowId) return true;
        if ((query ?? "") !== (state.lastQuery ?? "")) return true;
        if (!state.lastFetchedAt) return true;
        return Date.now() - state.lastFetchedAt > staleMs;
      },
    }),
    {
      name: "ds_prompt_library",
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
