import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isVideoFile } from "@/lib/media";
import { createDeferredStorage } from "@/lib/deferredStorage";

export type MediaTrayItem = {
  path: string;
  filename: string;
  kind: "image" | "video";
  addedAt: number;
};

type AddMediaTrayInput =
  | string
  | {
      path: string;
      filename?: string | null;
    };

interface MediaTrayStoreState {
  collapsed: boolean;
  items: MediaTrayItem[];

  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  addItems: (inputs: AddMediaTrayInput[] | AddMediaTrayInput) => void;
  removePath: (path: string) => void;
  clearAll: () => void;
  reorderByPath: (activePath: string, overPath: string) => void;
}

const MAX_MEDIA_TRAY_ITEMS = 200;

const normalizePath = (value: string) => {
  if (!value) return "";
  if (value.includes("/api/") && value.includes("path=")) {
    try {
      const url = new URL(value, typeof window !== "undefined" ? window.location.origin : "http://localhost");
      const param = url.searchParams.get("path");
      if (param) return param;
    } catch {
      // fall through
    }
  }
  return value;
};

const extractFilename = (path: string) => {
  const normalized = normalizePath(path);
  const last = normalized.split(/[\\/]/).pop();
  return last || normalized || "media";
};

const toItem = (input: AddMediaTrayInput): MediaTrayItem | null => {
  const path = normalizePath(typeof input === "string" ? input : input.path);
  if (!path) return null;
  const filename = (typeof input === "string" ? null : input.filename) || extractFilename(path);
  const kind: MediaTrayItem["kind"] = isVideoFile(path, filename) ? "video" : "image";
  return { path, filename, kind, addedAt: Date.now() };
};

const dedupePrepend = (existing: MediaTrayItem[], next: MediaTrayItem[]) => {
  const seen = new Set(existing.map((item) => item.path));
  const prepended: MediaTrayItem[] = [];
  for (const item of next) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    prepended.push(item);
  }
  return [...prepended, ...existing].slice(0, MAX_MEDIA_TRAY_ITEMS);
};

const moveItem = (items: MediaTrayItem[], fromIndex: number, toIndex: number) => {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return items;
  next.splice(toIndex, 0, moved);
  return next;
};

export const useMediaTrayStore = create<MediaTrayStoreState>()(
  persist(
    (set, get) => ({
      collapsed: true,
      items: [],

      setCollapsed: (collapsed) => set({ collapsed }),
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),

      addItems: (inputs) => {
        const list = Array.isArray(inputs) ? inputs : [inputs];
        const nextItems = list.map(toItem).filter(Boolean) as MediaTrayItem[];
        if (nextItems.length === 0) return;
        set((state) => ({ items: dedupePrepend(state.items, nextItems) }));
      },

      removePath: (path) => {
        const normalized = normalizePath(path);
        if (!normalized) return;
        set((state) => ({ items: state.items.filter((item) => item.path !== normalized) }));
      },

      clearAll: () => set({ items: [] }),

      reorderByPath: (activePath, overPath) => {
        const active = normalizePath(activePath);
        const over = normalizePath(overPath);
        if (!active || !over || active === over) return;

        const items = get().items;
        const fromIndex = items.findIndex((item) => item.path === active);
        const toIndex = items.findIndex((item) => item.path === over);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

        set({ items: moveItem(items, fromIndex, toIndex) });
      },
    }),
    {
      name: "ds_media_tray",
      storage: createJSONStorage(() => createDeferredStorage(localStorage, { flushIntervalMs: 1500, maxPending: 5 })),
      partialize: (state) => ({
        collapsed: state.collapsed,
        items: state.items,
      }),
    }
  )
);
