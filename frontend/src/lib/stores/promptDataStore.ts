import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { GenerationFeedItem } from "@/components/GenerationFeed";
import { PromptLibraryItem } from "@/lib/api";

export const PROMPT_LIBRARY_STALE_MS = 5 * 60 * 1000;

interface GenerationFeedState {
  generationFeed: GenerationFeedItem[];
  setGenerationFeed: (items: GenerationFeedItem[]) => void;
  trackFeedStart: (jobId: number) => void;
  updateFeed: (jobId: number, updates: Partial<GenerationFeedItem>) => void;
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
        set({
          generationFeed: [
            nextItem,
            ...existing.filter((item) => item.jobId !== jobId),
          ].slice(0, 8),
        });
      },
      updateFeed: (jobId, updates) => {
        set(({ generationFeed }) => ({
          generationFeed: generationFeed.map((item) =>
            item.jobId === jobId ? { ...item, ...updates } : item
          ),
        }));
      },
      clearFeed: () => set({ generationFeed: [] }),
    }),
    {
      name: "ds_generation_feed",
      storage: createJSONStorage(() => localStorage),
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
