import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { api } from "@/lib/api";
import { Canvas, CanvasPayload } from "@/lib/types";

interface SaveOptions {
  createNew?: boolean;
  name?: string;
}

interface CanvasStoreState {
  canvases: Canvas[];
  selectedCanvasId: number | null;
  isLoading: boolean;
  isSaving: boolean;
  pendingCanvas: Canvas | null;
  snapshotProvider: (() => CanvasPayload) | null;
  snapshotApplier: ((payload: CanvasPayload) => void | Promise<void>) | null;

  registerSnapshotProvider: (provider: (() => CanvasPayload) | null) => void;
  registerSnapshotApplier: (applier: ((payload: CanvasPayload) => void | Promise<void>) | null) => void;

  refreshCanvases: () => Promise<void>;
  saveCanvas: (options?: SaveOptions) => Promise<Canvas | null>;
  loadCanvas: (canvasId: number) => Promise<void>;
  renameCanvas: (canvasId: number, name: string) => Promise<Canvas | null>;
  deleteCanvas: (canvasId: number) => Promise<boolean>;
  getSuggestedName: () => string | null;
  setSelectedCanvasId: (canvasId: number | null) => void;
  clearPendingCanvas: () => void;
}

const slugify = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\\s-]/g, "")
    .replace(/[\\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const formatTimestamp = (date: Date) => {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

const buildDefaultName = (payload: CanvasPayload) => {
  const projectLabel =
    payload.selected_project_slug ||
    payload.selected_project_name ||
    "drafts";
  const normalizedProject = slugify(projectLabel) || "drafts";
  const target =
    payload.generation_target ||
    "engine-default";
  const normalizedTarget = slugify(target) || "engine-default";
  const stamp = formatTimestamp(new Date());
  return `${stamp}-${normalizedProject}-${normalizedTarget}`;
};

const toNumberOrNull = (value?: string | number | null) => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const sortByUpdatedAt = (items: Canvas[]) => {
  return [...items].sort((a, b) => {
    const aTime = Date.parse(a.updated_at || a.created_at);
    const bTime = Date.parse(b.updated_at || b.created_at);
    return bTime - aTime;
  });
};

export const useCanvasStore = create<CanvasStoreState>()(
  persist(
    (set, get) => ({
      canvases: [],
      selectedCanvasId: null,
      isLoading: false,
      isSaving: false,
      pendingCanvas: null,
      snapshotProvider: null,
      snapshotApplier: null,

      registerSnapshotProvider: (provider) => set({ snapshotProvider: provider }),
      registerSnapshotApplier: (applier) => set({ snapshotApplier: applier }),

      refreshCanvases: async () => {
        set({ isLoading: true });
        try {
          const canvases = await api.getCanvases();
          set({ canvases: sortByUpdatedAt(canvases) });
        } catch (e) {
          console.error("Failed to load canvases", e);
        } finally {
          set({ isLoading: false });
        }
      },

      getSuggestedName: () => {
        const provider = get().snapshotProvider;
        if (!provider) return null;
        try {
          const payload = provider();
          return buildDefaultName(payload);
        } catch (e) {
          console.error("Failed to build canvas name", e);
          return null;
        }
      },

      saveCanvas: async (options = {}) => {
        const provider = get().snapshotProvider;
        if (!provider) return null;

        let payload: CanvasPayload;
        try {
          payload = provider();
        } catch (e) {
          console.error("Failed to capture canvas snapshot", e);
          return null;
        }

        const selectedId = get().selectedCanvasId;
        const createNew = Boolean(options.createNew || !selectedId);
        const projectId = toNumberOrNull(payload.selected_project_id);
        const workflowId = toNumberOrNull(payload.selected_workflow_id);
        const name = (options.name || "").trim() || (createNew ? buildDefaultName(payload) : undefined);

        set({ isSaving: true });
        try {
          let saved: Canvas;
          if (createNew) {
            saved = await api.createCanvas({
              name: name || buildDefaultName(payload),
              payload,
              project_id: projectId,
              workflow_template_id: workflowId,
            });
          } else {
            saved = await api.updateCanvas(selectedId!, {
              name,
              payload,
              project_id: projectId,
              workflow_template_id: workflowId,
            });
          }

          set((state) => {
            const existing = state.canvases.filter((canvas) => canvas.id !== saved.id);
            return {
              canvases: sortByUpdatedAt([saved, ...existing]),
              selectedCanvasId: saved.id,
            };
          });
          return saved;
        } catch (e) {
          console.error("Failed to save canvas", e);
          return null;
        } finally {
          set({ isSaving: false });
        }
      },

      loadCanvas: async (canvasId) => {
        const applier = get().snapshotApplier;
        let canvas = get().canvases.find((item) => item.id === canvasId) || null;

        try {
          if (!canvas) {
            canvas = await api.getCanvas(canvasId);
          }

          // Auto-save: if we are switching FROM a valid canvas, and have a way to snapshot it, save it first.
          const currentId = get().selectedCanvasId;
          const provider = get().snapshotProvider;
          if (currentId && provider && currentId !== canvasId) {
            console.log("Auto-saving canvas", currentId, "before switching to", canvasId);
            await get().saveCanvas();
          }

          if (!canvas) return;

          if (applier) {
            await applier(canvas.payload as CanvasPayload);
          } else {
            set({ pendingCanvas: canvas });
          }

          set({ selectedCanvasId: canvas.id });

          set((state) => {
            const existing = state.canvases.filter((item) => item.id !== canvas!.id);
            return { canvases: sortByUpdatedAt([canvas!, ...existing]) };
          });
        } catch (e) {
          console.error("Failed to load canvas", e);
        }
      },

      renameCanvas: async (canvasId, name) => {
        const trimmed = name.trim();
        if (!trimmed) return null;
        try {
          const updated = await api.updateCanvas(canvasId, { name: trimmed });
          set((state) => {
            const existing = state.canvases.filter((item) => item.id !== updated.id);
            return { canvases: sortByUpdatedAt([updated, ...existing]) };
          });
          return updated;
        } catch (e) {
          console.error("Failed to rename canvas", e);
          return null;
        }
      },

      deleteCanvas: async (canvasId) => {
        try {
          await api.deleteCanvas(canvasId);
          set((state) => {
            const remaining = state.canvases.filter((canvas) => canvas.id !== canvasId);
            return {
              canvases: remaining,
              selectedCanvasId: state.selectedCanvasId === canvasId ? null : state.selectedCanvasId,
            };
          });
          return true;
        } catch (e) {
          console.error("Failed to delete canvas", e);
          return false;
        }
      },

      setSelectedCanvasId: (canvasId) => set({ selectedCanvasId: canvasId }),
      clearPendingCanvas: () => set({ pendingCanvas: null }),
    }),
    {
      name: "ds_canvas_state",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ selectedCanvasId: state.selectedCanvasId }),
    }
  )
);
