import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type DownloadRow = {
    target: string;
    url: string;
    id: number;
};

type DownloadRowsUpdater = DownloadRow[] | ((rows: DownloadRow[]) => DownloadRow[]);

// --- Projects Page Store ---
interface ProjectsPageState {
    showArchived: boolean;
    isCreateOpen: boolean;
    newProjectName: string;
    managingProjectId: number | null;
    newFolderName: string;
    setShowArchived: (show: boolean) => void;
    setIsCreateOpen: (open: boolean) => void;
    setNewProjectName: (name: string) => void;
    setManagingProjectId: (id: number | null) => void;
    setNewFolderName: (name: string) => void;
    clearDialogs: () => void;
}

export const useProjectsPageStore = create<ProjectsPageState>()(
    persist(
        (set) => ({
            showArchived: false,
            isCreateOpen: false,
            newProjectName: "",
            managingProjectId: null,
            newFolderName: "",
            setShowArchived: (show) => set({ showArchived: show }),
            setIsCreateOpen: (open) => set({ isCreateOpen: open }),
            setNewProjectName: (name) => set({ newProjectName: name }),
            setManagingProjectId: (id) => set({ managingProjectId: id }),
            setNewFolderName: (name) => set({ newFolderName: name }),
            clearDialogs: () => set({
                isCreateOpen: false,
                newProjectName: "",
                managingProjectId: null,
                newFolderName: "",
            }),
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
    editName: string;
    editDescription: string;
    hiddenNodes: Record<string, boolean>;
    schemaEdits: any | null;
    expandedNodes: string[];
    setShowArchived: (show: boolean) => void;
    setEditingWorkflowId: (id: number | null) => void;
    setEditName: (name: string) => void;
    setEditDescription: (description: string) => void;
    setHiddenNodes: (hiddenNodes: Record<string, boolean>) => void;
    setSchemaEdits: (schema: any | null) => void;
    setExpandedNodes: (nodes: string[]) => void;
    clearEditingState: () => void;
}

export const usePipesPageStore = create<PipesPageState>()(
    persist(
        (set) => ({
            showArchived: false,
            editingWorkflowId: null,
            editName: "",
            editDescription: "",
            hiddenNodes: {},
            schemaEdits: null,
            expandedNodes: [],
            setShowArchived: (show) => set({ showArchived: show }),
            setEditingWorkflowId: (id) => set({ editingWorkflowId: id }),
            setEditName: (name) => set({ editName: name }),
            setEditDescription: (description) => set({ editDescription: description }),
            setHiddenNodes: (hiddenNodes) => set({ hiddenNodes }),
            setSchemaEdits: (schema) => set({ schemaEdits: schema }),
            setExpandedNodes: (nodes) => set({ expandedNodes: nodes }),
            clearEditingState: () => set({
                editingWorkflowId: null,
                editName: "",
                editDescription: "",
                hiddenNodes: {},
                schemaEdits: null,
                expandedNodes: []
            }),
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
    selectedIds: number[];
    cleanupMode: boolean;
    selectionMode: boolean;
    selectionModeManual: boolean;
    setSearch: (search: string) => void;
    setSelectedProjectId: (id: number | null) => void;
    setSelectedFolder: (folder: string | null) => void;
    setSelectedIds: (ids: number[]) => void;
    setCleanupMode: (value: boolean) => void;
    setSelectionMode: (value: boolean) => void;
    setSelectionModeManual: (value: boolean) => void;
}

export const useGalleryPageStore = create<GalleryPageState>()(
    persist(
        (set) => ({
            search: "",
            selectedProjectId: null,
            selectedFolder: null,
            selectedIds: [],
            cleanupMode: false,
            selectionMode: false,
            selectionModeManual: false,
            setSearch: (search) => set({ search }),
            setSelectedProjectId: (id) => set({ selectedProjectId: id }),
            setSelectedFolder: (folder) => set({ selectedFolder: folder }),
            setSelectedIds: (ids) => set({ selectedIds: ids }),
            setCleanupMode: (value) => set({ cleanupMode: value }),
            setSelectionMode: (value) => set({ selectionMode: value }),
            setSelectionModeManual: (value) => set({ selectionModeManual: value }),
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
    query: string;
    setSearchInput: (search: string) => void;
    setQuery: (query: string) => void;
}

export const useLibraryPageStore = create<LibraryPageState>()(
    persist(
        (set) => ({
            searchInput: "",
            query: "",
            setSearchInput: (search) => set({ searchInput: search }),
            setQuery: (query) => set({ query }),
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
    downloadRows: DownloadRow[];
    setActiveFolder: (folder: string) => void;
    setSelectedCategory: (category: string) => void;
    setSearch: (search: string) => void;
    setDownloadRows: (rows: DownloadRowsUpdater) => void;
}

export const useModelsPageStore = create<ModelsPageState>()(
    persist(
        (set) => ({
            activeFolder: "",
            selectedCategory: "all",
            search: "",
            downloadRows: [{ target: "", url: "", id: Date.now() }],
            setActiveFolder: (folder) => set({ activeFolder: folder }),
            setSelectedCategory: (category) => set({ selectedCategory: category }),
            setSearch: (search) => set({ search }),
            setDownloadRows: (rows) => set((state) => ({
                downloadRows: typeof rows === "function" ? rows(state.downloadRows) : rows
            })),
        }),
        {
            name: "ds_page_models",
            storage: createJSONStorage(() => localStorage),
        }
    )
);
