import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// --- Projects Page Store ---
interface ProjectsPageState {
    showArchived: boolean;
    setShowArchived: (show: boolean) => void;
}

export const useProjectsPageStore = create<ProjectsPageState>()(
    persist(
        (set) => ({
            showArchived: false,
            setShowArchived: (show) => set({ showArchived: show }),
        }),
        {
            name: "ds_page_projects",
            storage: createJSONStorage(() => localStorage),
        }
    )
);

// --- Pipes (Workflow Library) Page Store ---
interface PipesPageState {
    showArchived: boolean;
    editingWorkflowId: number | null;
    setShowArchived: (show: boolean) => void;
    setEditingWorkflowId: (id: number | null) => void;
}

export const usePipesPageStore = create<PipesPageState>()(
    persist(
        (set) => ({
            showArchived: false,
            editingWorkflowId: null,
            setShowArchived: (show) => set({ showArchived: show }),
            setEditingWorkflowId: (id) => set({ editingWorkflowId: id }),
        }),
        {
            name: "ds_page_pipes",
            storage: createJSONStorage(() => localStorage),
        }
    )
);

// --- Gallery Page Store ---
interface GalleryPageState {
    search: string;
    selectedProjectId: number | null;
    selectedFolder: string | null;
    setSearch: (search: string) => void;
    setSelectedProjectId: (id: number | null) => void;
    setSelectedFolder: (folder: string | null) => void;
}

export const useGalleryPageStore = create<GalleryPageState>()(
    persist(
        (set) => ({
            search: "",
            selectedProjectId: null,
            selectedFolder: null,
            setSearch: (search) => set({ search }),
            setSelectedProjectId: (id) => set({ selectedProjectId: id }),
            setSelectedFolder: (folder) => set({ selectedFolder: folder }),
        }),
        {
            name: "ds_page_gallery",
            storage: createJSONStorage(() => localStorage),
        }
    )
);

// --- Prompt Library Page Store ---
interface LibraryPageState {
    searchInput: string;
    setSearchInput: (search: string) => void;
}

export const useLibraryPageStore = create<LibraryPageState>()(
    persist(
        (set) => ({
            searchInput: "",
            setSearchInput: (search) => set({ searchInput: search }),
        }),
        {
            name: "ds_page_library",
            storage: createJSONStorage(() => localStorage),
        }
    )
);

// --- Models Page Store ---
interface ModelsPageState {
    activeFolder: string;
    selectedCategory: string;
    search: string;
    setActiveFolder: (folder: string) => void;
    setSelectedCategory: (category: string) => void;
    setSearch: (search: string) => void;
}

export const useModelsPageStore = create<ModelsPageState>()(
    persist(
        (set) => ({
            activeFolder: "",
            selectedCategory: "all",
            search: "",
            setActiveFolder: (folder) => set({ activeFolder: folder }),
            setSelectedCategory: (category) => set({ selectedCategory: category }),
            setSearch: (search) => set({ search }),
        }),
        {
            name: "ds_page_models",
            storage: createJSONStorage(() => localStorage),
        }
    )
);
