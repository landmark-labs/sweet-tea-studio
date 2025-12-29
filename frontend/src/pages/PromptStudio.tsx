import { useEffect, useState, useRef, useMemo, useCallback, memo, startTransition, type ComponentProps } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { addProgressEntry, calculateProgressStats, mapStatusToGenerationState, type GenerationState, type ProgressHistoryEntry } from "@/lib/generationState";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { api, Engine, WorkflowTemplate, GalleryItem, EngineHealth, Project, Image as ApiImage, FolderImage } from "@/lib/api";
import { extractPrompts, findPromptFieldsInSchema, findImageFieldsInSchema } from "@/lib/promptUtils";
import { DynamicForm } from "@/components/DynamicForm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";

import { ImageViewer } from "@/components/ImageViewer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { InstallStatusDialog, InstallStatus } from "@/components/InstallStatusDialog";
import { PromptConstructor, COLORS } from "@/components/PromptConstructor";
import { CanvasPayload, PromptItem } from "@/lib/types";

import { useUndoRedo } from "@/lib/undoRedo";
import { ProjectGallery } from "@/components/ProjectGallery";
import { useGenerationFeedStore, usePromptLibraryStore } from "@/lib/stores/promptDataStore";
import { useGeneration } from "@/lib/GenerationContext";
import { logClientEventThrottled } from "@/lib/clientDiagnostics";
import { formDataAtom, setFormDataAtom } from "@/lib/atoms/formAtoms";
import { useCanvasStore } from "@/lib/stores/canvasStore";

type PromptConstructorPanelProps = Omit<ComponentProps<typeof PromptConstructor>, "currentValues">;

const PromptConstructorPanel = memo(function PromptConstructorPanel(props: PromptConstructorPanelProps) {
  const currentValues = useAtomValue(formDataAtom) as Record<string, string>;
  return <PromptConstructor {...props} currentValues={currentValues} />;
});

const isPersistableSchemaKey = (key: string) =>
  !key.startsWith("__") || key.startsWith("__bypass_");

const buildSchemaDefaults = (schema: Record<string, any>) => {
  const defaults: Record<string, unknown> = {};
  Object.entries(schema || {}).forEach(([key, field]) => {
    if (isPersistableSchemaKey(key) && field?.default !== undefined) {
      defaults[key] = field.default;
    }
  });
  return defaults;
};

const filterParamsForSchema = (
  schema: Record<string, any>,
  params: Record<string, unknown> | null | undefined
) => {
  const filtered: Record<string, unknown> = {};
  if (!params || typeof params !== "object") return filtered;
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) return;
    // Always preserve __bypass_ keys from job_params for regeneration
    // These keys may not exist in the schema at runtime but are still valid
    if (key.startsWith("__bypass_")) {
      filtered[key] = value;
      return;
    }
    if (isPersistableSchemaKey(key) && key in schema) {
      filtered[key] = value;
    }
  });
  return filtered;
};

const normalizeParamsWithDefaults = (
  schema: Record<string, any>,
  params: Record<string, unknown>
) => {
  const normalized: Record<string, unknown> = { ...params };
  Object.entries(schema || {}).forEach(([key, field]) => {
    if (!isPersistableSchemaKey(key)) return;
    if (field?.default === undefined) return;

    const value = normalized[key];
    if (value === undefined || value === null) {
      normalized[key] = field.default;
      return;
    }

    if (Array.isArray(field.enum)) {
      const defaultValue = field.default;
      const valueStr = typeof value === "string" ? value : String(value);
      const trimmed = valueStr.trim();
      const enumHasEmpty = field.enum.includes("");
      const isEmpty = trimmed.length === 0;

      // Only reset if value is truly empty - preserve values that exist even if not
      // in static enum list. This allows regeneration with samplers/schedulers/models
      // that were valid at generation time but may not be in the hardcoded enum.
      // DynamicForm handles showing "stale" values, ComfyUI validates at execution.
      if (isEmpty && !enumHasEmpty) {
        normalized[key] = defaultValue;
      }
    }
  });
  return normalized;
};

export default function PromptStudio() {
  const [engines, setEngines] = useState<Engine[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [engineHealth, setEngineHealth] = useState<EngineHealth[]>([]);

  const [selectedEngineId, setSelectedEngineId] = useState<string>(
    localStorage.getItem("ds_selected_engine") || ""
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    localStorage.getItem("ds_selected_workflow") || ""
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    localStorage.getItem("ds_selected_project") || null
  );
  const [galleryScopeAll] = useState(
    localStorage.getItem("ds_gallery_scope") === "all"
  );
  const [promptConstructorCollapsed, setPromptConstructorCollapsed] = useState(
    localStorage.getItem("ds_prompt_constructor_collapsed") === "true"
  );

  const location = useLocation();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [generationState, setGenerationState] = useState<GenerationState>("idle");
  const [statusLabel, setStatusLabel] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [lastJobId, setLastJobId] = useState<number | null>(null);
  const lastSubmittedParamsRef = useRef<any>(null); // Track params for preview
  const [progress, setProgress] = useState<number>(0);
  const [jobStartTime, setJobStartTime] = useState<number | null>(null);
  const progressHistoryRef = useRef<ProgressHistoryEntry[]>([]);
  const isQueuing = generationState === "queued";
  const isRunning = generationState === "running";
  const isBusy = isQueuing || isRunning;

  // Batch Queue State
  const [batchSize, setBatchSize] = useState<number>(() => {
    const saved = localStorage.getItem("ds_batch_size");
    return saved ? Math.max(1, Math.min(100, parseInt(saved) || 1)) : 1;
  });
  const batchCancelledRef = useRef(false);

  // Persist batch size to localStorage
  useEffect(() => {
    localStorage.setItem("ds_batch_size", String(batchSize));
  }, [batchSize]);

  // Selection State
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewMetadata, setPreviewMetadata] = useState<any>(null);
  // Pending loadParams - holds the gallery item to inject until workflows are loaded
  const [pendingLoadParams, setPendingLoadParams] = useState<(GalleryItem & { __isRegenerate?: boolean; __randomizeSeed?: boolean }) | null>(null);
  const handlePreviewSelect = useCallback((path: string, metadata?: any) => {
    setPreviewPath(path);
    setPreviewMetadata(metadata ?? null);
  }, []);

  // Form Data State (Jotai)
  const store = useStore();
  const setFormData = useSetAtom(setFormDataAtom);
  const [focusedField, setFocusedField] = useState<string>("");
  const [externalValueSyncKey, setExternalValueSyncKey] = useState(0);
  const selectedWorkflowIdRef = useRef<string | null>(selectedWorkflowId);
  useEffect(() => {
    selectedWorkflowIdRef.current = selectedWorkflowId || null;
  }, [selectedWorkflowId]);
  const initializedWorkflowsRef = useRef<Set<string>>(new Set());

  // Use selectors to minimize re-renders on store updates
  const generationFeed = useGenerationFeedStore(useCallback(state => state.generationFeed, []));
  const trackFeedStart = useGenerationFeedStore(useCallback(state => state.trackFeedStart, []));
  const updateFeed = useGenerationFeedStore(useCallback(state => state.updateFeed, []));
  const updatePreviewBlob = useGenerationFeedStore(useCallback(state => state.updatePreviewBlob, []));

  const registerCanvasSnapshotProvider = useCanvasStore(useCallback(state => state.registerSnapshotProvider, []));
  const registerCanvasSnapshotApplier = useCanvasStore(useCallback(state => state.registerSnapshotApplier, []));
  const saveCanvas = useCanvasStore(useCallback(state => state.saveCanvas, []));
  const pendingCanvas = useCanvasStore(useCallback(state => state.pendingCanvas, []));
  const clearPendingCanvas = useCanvasStore(useCallback(state => state.clearPendingCanvas, []));

  // Prompt Library State - also using selectors
  const setPrompts = usePromptLibraryStore(useCallback(state => state.setPrompts, []));
  const clearPrompts = usePromptLibraryStore(useCallback(state => state.clearPrompts, []));
  const shouldRefetchPrompts = usePromptLibraryStore(useCallback(state => state.shouldRefetch, []));
  const [, setPromptLoading] = useState(false);
  const [, setPromptError] = useState<string | null>(null);
  const [promptSearch, setPromptSearch] = useState("");

  // Add a refresh key for gallery
  const [galleryRefresh, setGalleryRefresh] = useState(0);
  const [galleryImages, setGalleryImages] = useState<GalleryItem[]>([]);
  // Images from ProjectGallery - used for navigation when clicking from there
  const [projectGalleryImages, setProjectGalleryImages] = useState<FolderImage[]>([]);
  const [, setSelectedGalleryIds] = useState<Set<number>>(new Set());
  const [unsavedJobIds, setUnsavedJobIds] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem("ds_unsaved_job_ids");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Failed to parse unsaved job ids", e);
    }
    return [];
  });

  // Snippet Library (Backend-persisted)
  const [library, setLibrary] = useState<PromptItem[]>([]);
  const [snippetsLoaded, setSnippetsLoaded] = useState(false);
  const pendingSaveRef = useRef<NodeJS.Timeout | null>(null);
  const allowEmptySnippetSyncRef = useRef(false);
  const persistHandleRef = useRef<{ id: number | NodeJS.Timeout; type: "idle" | "timeout" } | null>(null);
  const pendingPersistRef = useRef<{ workflowId: string; data: any } | null>(null);
  const workflowParamsCacheRef = useRef<Record<string, Record<string, unknown>>>({});
  const pendingCanvasPayloadRef = useRef<CanvasPayload | null>(null);
  const [canvasGallerySelection, setCanvasGallerySelection] = useState<{
    projectId?: string | null;
    folder?: string | null;
    collapsed?: boolean;
  } | null>(null);
  const [canvasGallerySyncKey, setCanvasGallerySyncKey] = useState(0);

  // Load snippets from backend on mount
  useEffect(() => {
    const loadSnippets = async () => {
      try {
        const { snippetApi } = await import("@/lib/api");
        const snippets = await snippetApi.getSnippets();
        // Map backend Snippet to PromptItem format
        const items: PromptItem[] = snippets.map(s => ({
          id: String(s.id),
          type: "block" as const,
          label: s.label,
          content: s.content,
          color: s.color || COLORS[0],
        }));
        setLibrary(items);
        setSnippetsLoaded(true);
      } catch (e) {
        console.error("Failed to load snippets from backend", e);
        // Fallback to localStorage migration
        try {
          const saved = localStorage.getItem("ds_prompt_snippets");
          if (saved) {
            const parsed = JSON.parse(saved);
            setLibrary(parsed);
          }
        } catch (e2) { console.error("Failed to parse local snippets", e2); }
        setSnippetsLoaded(true);
      }
    };
    loadSnippets();
  }, []);

  // Save snippets to backend when library changes (debounced)
  useEffect(() => {
    if (!snippetsLoaded) return; // Don't save until initial load complete

    // Debounce saves to avoid hammering the API
    if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
    pendingSaveRef.current = setTimeout(async () => {
      const allowEmptySync = allowEmptySnippetSyncRef.current;
      // SAFETY: Don't sync empty library to avoid nuking backend data
      if (library.length === 0 && !allowEmptySync) {
        console.warn("[Snippets] Skipping sync - library is empty (would delete all backend snippets)");
        return;
      }
      try {
        const { snippetApi } = await import("@/lib/api");
        await snippetApi.bulkUpsert(library.map(item => ({
          label: item.label || "Untitled",
          content: item.content,
          color: item.color,
        })));
        // Clear localStorage after successful save to backend
        localStorage.removeItem("ds_prompt_snippets");
      } catch (e) {
        console.error("Failed to save snippets to backend", e);
        // Fallback: save to localStorage
        localStorage.setItem("ds_prompt_snippets", JSON.stringify(library));
      } finally {
        if (allowEmptySnippetSyncRef.current) {
          allowEmptySnippetSyncRef.current = false;
        }
      }
    }, 1000);

    return () => {
      if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
    };
  }, [library, snippetsLoaded]);

  const loadGallery = useCallback(async () => {
    try {
      const projectFilter = galleryScopeAll || !selectedProjectId ? null : parseInt(selectedProjectId);
      const unassignedOnly = galleryScopeAll ? false : !selectedProjectId;
      const images = await api.getGallery({
        projectId: projectFilter,
        unassignedOnly,
        limit: 50,
        includeThumbnails: false,
      });
      setGalleryImages(images);
    } catch (e) {
      console.error("Failed to load gallery", e);
    }
  }, [galleryScopeAll, selectedProjectId]);

  // Initial load and refresh
  useEffect(() => {
    loadGallery();
  }, [galleryRefresh, loadGallery]);

  // Handle Deletion from Gallery or Auto-Discard
  const handleGalleryDelete = useCallback(async (ids: Set<number> | number) => {
    const idsToDelete = typeof ids === 'number' ? new Set([ids]) : ids;
    if (idsToDelete.size === 0) return;

    try {
      // Optimistic update
      setGalleryImages(prev => prev.filter(item => !idsToDelete.has(item.image.id)));
      setSelectedGalleryIds(prev => {
        const next = new Set(prev);
        idsToDelete.forEach(id => next.delete(id));
        return next;
      });

      // Prefer bulk API to avoid hammering the backend (especially with many deletes)
      const idsArr = Array.from(idsToDelete);
      try {
        await api.bulkDeleteImages(idsArr);
      } catch (e) {
        console.error("Bulk delete failed, falling back to sequential", e);
        for (const id of idsArr) {
          try {
            await api.deleteImage(id);
          } catch (err) {
            console.error("Failed to delete image", id, err);
          }
        }
      }
    } catch (e) {
      console.error("Failed to delete images", e);
      loadGallery(); // Revert on error
    }
  }, [loadGallery]);


  // useOutletContext to get panel states from Layout
  const { feedOpen, libraryOpen } = useOutletContext<{ feedOpen: boolean, libraryOpen: boolean }>();

  // Install State
  const [installOpen, setInstallOpen] = useState(false);
  const [installStatus, setInstallStatus] = useState<InstallStatus | null>(null);
  const [allowManualClone, setAllowManualClone] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const healthIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const selectedWorkflow = workflows.find((w) => String(w.id) === selectedWorkflowId);
  const selectedWorkflowSchema = useMemo(
    () => selectedWorkflow?.input_schema || {},
    [selectedWorkflow]
  );
  const nodeOrder = useMemo(
    () => Array.isArray(selectedWorkflowSchema?.__node_order)
      ? selectedWorkflowSchema.__node_order.map(String)
      : [],
    [selectedWorkflowSchema]
  );
  const visibleSchema = useMemo<Record<string, any>>(() => {
    if (!selectedWorkflow) return {};

    const hiddenNodes = new Set(
      Object.entries(selectedWorkflow.graph_json || {})
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter(([_, node]: [string, any]) => node?._meta?.hiddenInControls)
        .map(([id]) => String(id))
    );

    return Object.fromEntries(
      Object.entries(selectedWorkflow.input_schema || {}).filter(([key, val]: [string, any]) => {
        // Hide internal keys like __node_order, but keep __bypass_ toggles
        if (key.startsWith("__") && !key.startsWith("__bypass_")) return false;
        if (val.__hidden) return false;
        if (!val.x_node_id && val.x_node_id !== 0) return true;
        return !hiddenNodes.has(String(val.x_node_id));
      })
    );
  }, [selectedWorkflow]);
  const selectedProject = selectedProjectId ? projects.find((p) => String(p.id) === selectedProjectId) || null : null;
  const draftsProject = projects.find((p) => p.slug === "drafts");
  const selectedEngineHealth = engineHealth.find((h) => String(h.engine_id) === selectedEngineId);
  const engineOffline = Boolean(selectedEngineHealth && !selectedEngineHealth.healthy);

  const projectFolders = (selectedProject?.config_json as { folders?: string[] })?.folders || ["inputs", "output", "masks"];
  const [generationTarget, setGenerationTarget] = useState<string>(
    localStorage.getItem("ds_generation_target") || ""
  );

  // Persist selections
  useEffect(() => {
    if (selectedEngineId) localStorage.setItem("ds_selected_engine", selectedEngineId);
  }, [selectedEngineId]);

  useEffect(() => {
    if (selectedWorkflowId) localStorage.setItem("ds_selected_workflow", selectedWorkflowId);
  }, [selectedWorkflowId]);

  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem("ds_selected_project", selectedProjectId);
    } else {
      localStorage.removeItem("ds_selected_project");
    }
  }, [selectedProjectId]);

  useEffect(() => {
    localStorage.setItem("ds_gallery_scope", galleryScopeAll ? "all" : "project");
  }, [galleryScopeAll]);

  useEffect(() => {
    localStorage.setItem("ds_unsaved_job_ids", JSON.stringify(unsavedJobIds));
  }, [unsavedJobIds]);

  useEffect(() => {
    localStorage.setItem("ds_generation_target", generationTarget);
  }, [generationTarget]);

  useEffect(() => {
    // Only force default if we don't have a valid target for this project
    // This allows the persisted value to apply, or preserves selection when switching projects
    // if the folder exists in both.
    if (selectedProject) {
      const validFolders = (selectedProject.config_json as { folders?: string[] })?.folders || ["inputs", "output", "masks"];

      // If current target is empty or not in the new project's folder list (and isn't engine default "")
      // then we reset to output.
      // Note: we treat "" as engine-default which is always valid? Actually the UI treats "" as Default.
      // If custom folders are defined, we might want to ensure we match them.

      // If we have a target but it's not in the new list, switch to output
      if (generationTarget && generationTarget !== "output" && !validFolders.includes(generationTarget)) {
        setGenerationTarget("output");
      } else if (!generationTarget) {
        // If nothing selected (and no persistent value loaded), default to output
        setGenerationTarget("output");
      }
    } else {
      // Draft mode - no restrictions, but maybe default to "" (engine default) or keep as is?
      // existing logic was: setGenerationTarget("");
      // Let's reset to empty if dropping to draft mode to avoid writing to a random project folder
      if (!generationTarget) setGenerationTarget("");
    }
  }, [selectedProject, generationTarget]);

  const previousProjectRef = useRef<string | null>(selectedProjectId);
  useEffect(() => {
    if (previousProjectRef.current && !selectedProjectId) {
      // Starting a new draft session; clear any old unsaved records
      setUnsavedJobIds([]);
    }
    previousProjectRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const buildCanvasPayload = useCallback((): CanvasPayload => {
    const formData = store.get(formDataAtom) || {};
    const project = selectedProjectId
      ? projects.find((p) => String(p.id) === String(selectedProjectId)) || null
      : null;
    const galleryProjectId = localStorage.getItem("ds_project_gallery_project") || "";
    const galleryFolder = localStorage.getItem("ds_project_gallery_folder") || "";
    const galleryCollapsed = localStorage.getItem("ds_project_gallery_collapsed") === "true";

    return {
      selected_engine_id: selectedEngineId || null,
      selected_workflow_id: selectedWorkflowId || null,
      selected_project_id: selectedProjectId || null,
      selected_project_slug: project?.slug || null,
      selected_project_name: project?.name || null,
      generation_target: generationTarget || null,
      form_data: formData,
      snippets: library,
      project_gallery: {
        project_id: galleryProjectId || null,
        folder: galleryFolder || null,
        collapsed: galleryCollapsed,
      },
    };
  }, [store, selectedEngineId, selectedWorkflowId, selectedProjectId, projects, generationTarget, library]);

  const normalizeCanvasFormData = useCallback((workflowId: string, rawData: Record<string, unknown>) => {
    const workflow = workflows.find((w) => String(w.id) === String(workflowId));
    if (!workflow) return rawData;
    const schema = workflow.input_schema || {};
    const defaults = buildSchemaDefaults(schema);
    const filtered = filterParamsForSchema(schema, rawData);
    return normalizeParamsWithDefaults(schema, { ...defaults, ...filtered });
  }, [workflows]);

  const applyCanvasFormData = useCallback((workflowId: string, rawData: Record<string, unknown>) => {
    const normalized = normalizeCanvasFormData(workflowId, rawData);
    try {
      localStorage.setItem(`ds_pipe_params_${workflowId}`, JSON.stringify(normalized));
    } catch (e) {
      console.warn("Failed to persist canvas form data", e);
    }
    workflowParamsCacheRef.current[workflowId] = normalized;
    initializedWorkflowsRef.current.add(workflowId);
    setFormData(normalized);
    setExternalValueSyncKey((prev) => prev + 1);
  }, [normalizeCanvasFormData, setFormData, setExternalValueSyncKey]);

  const applyCanvasPayload = useCallback((payload: CanvasPayload) => {
    if (!payload) return;

    if (payload.selected_engine_id !== undefined) {
      setSelectedEngineId(payload.selected_engine_id || "");
    }
    if (payload.selected_project_id !== undefined) {
      setSelectedProjectId(payload.selected_project_id || null);
    }
    if (payload.generation_target !== undefined) {
      setGenerationTarget(payload.generation_target || "");
    }
    if (payload.snippets !== undefined) {
      if (payload.snippets.length === 0) {
        allowEmptySnippetSyncRef.current = true;
      } else {
        allowEmptySnippetSyncRef.current = false;
      }
      setLibrary(payload.snippets);
    }

    if (payload.project_gallery) {
      const nextSelection = {
        projectId: payload.project_gallery.project_id || "",
        folder: payload.project_gallery.folder || "",
        collapsed: payload.project_gallery.collapsed,
      };
      setCanvasGallerySelection(nextSelection);
      setCanvasGallerySyncKey((prev) => prev + 1);

      if (payload.project_gallery.project_id !== undefined) {
        localStorage.setItem("ds_project_gallery_project", nextSelection.projectId || "");
      }
      if (payload.project_gallery.folder !== undefined) {
        localStorage.setItem("ds_project_gallery_folder", nextSelection.folder || "");
      }
      if (payload.project_gallery.collapsed !== undefined) {
        localStorage.setItem("ds_project_gallery_collapsed", String(Boolean(payload.project_gallery.collapsed)));
      }
    }

    const workflowId = payload.selected_workflow_id || selectedWorkflowIdRef.current;
    if (workflowId) {
      const rawData = (payload.form_data || {}) as Record<string, unknown>;
      const workflowExists = workflows.some((w) => String(w.id) === String(workflowId));
      if (!workflowExists) {
        pendingCanvasPayloadRef.current = payload;
        try {
          localStorage.setItem(`ds_pipe_params_${workflowId}`, JSON.stringify(rawData));
        } catch (e) {
          console.warn("Failed to store canvas params for pending workflow", e);
        }
        workflowParamsCacheRef.current[String(workflowId)] = rawData;
      }
      setSelectedWorkflowId(String(workflowId));
      if (workflowExists) {
        applyCanvasFormData(String(workflowId), rawData);
      }
    }
  }, [applyCanvasFormData, setSelectedEngineId, setSelectedProjectId, setGenerationTarget, setLibrary, setSelectedWorkflowId, workflows]);

  useEffect(() => {
    registerCanvasSnapshotProvider(buildCanvasPayload);
    registerCanvasSnapshotApplier(applyCanvasPayload);
    return () => {
      registerCanvasSnapshotProvider(null);
      registerCanvasSnapshotApplier(null);
    };
  }, [registerCanvasSnapshotProvider, registerCanvasSnapshotApplier, buildCanvasPayload, applyCanvasPayload]);

  useEffect(() => {
    if (!pendingCanvas) return;
    applyCanvasPayload(pendingCanvas.payload as CanvasPayload);
    clearPendingCanvas();
  }, [pendingCanvas, applyCanvasPayload, clearPendingCanvas]);

  useEffect(() => {
    const pending = pendingCanvasPayloadRef.current;
    if (!pending) return;
    const workflowId = pending.selected_workflow_id;
    if (!workflowId) return;
    const workflowExists = workflows.some((w) => String(w.id) === String(workflowId));
    if (!workflowExists) return;
    pendingCanvasPayloadRef.current = null;
    applyCanvasFormData(String(workflowId), (pending.form_data || {}) as Record<string, unknown>);
  }, [workflows, applyCanvasFormData]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveCanvas();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveCanvas]);

  // Persist prompt constructor collapsed state
  useEffect(() => {
    localStorage.setItem("ds_prompt_constructor_collapsed", String(promptConstructorCollapsed));
  }, [promptConstructorCollapsed]);

  // Track the previous workflow ID to detect actual pipe switches
  const previousWorkflowIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedWorkflow) return;

    const schema = visibleSchema;
    const workflowKey = String(selectedWorkflow.id);
    const previousWorkflowId = previousWorkflowIdRef.current;
    const isWorkflowSwitch = previousWorkflowId !== null && previousWorkflowId !== workflowKey;

    // Update the previous workflow ID ref for next run
    previousWorkflowIdRef.current = workflowKey;

    // CRITICAL: Flush any pending persist for the OLD pipe BEFORE loading new pipe data.
    // Without this, the old form data could get saved to the new pipe's localStorage key
    // because persistForm uses selectedWorkflowId which has already changed.
    // NOTE: We inline this logic rather than calling flushPendingPersist() because
    // that function is declared later and creates a hoisting issue.
    if (isWorkflowSwitch && pendingPersistRef.current) {
      const pending = pendingPersistRef.current;
      try {
        localStorage.setItem(`ds_pipe_params_${pending.workflowId}`, JSON.stringify(pending.data));
        workflowParamsCacheRef.current[pending.workflowId] = pending.data;
      } catch (e) {
        console.warn("Failed to persist form data", e);
      }
      pendingPersistRef.current = null;
      if (persistHandleRef.current) {
        const handle = persistHandleRef.current;
        if (handle.type === "idle" && typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(handle.id as number);
        } else {
          clearTimeout(handle.id as NodeJS.Timeout);
        }
        persistHandleRef.current = null;
      }
    }

    // IMPORTANT: If we have pendingLoadParams, let that effect handle the form data
    // to avoid race conditions where this effect overwrites the merged params with
    // stale localStorage data. This fixes sampler/scheduler/upscale slippage.
    if (pendingLoadParams) {
      console.log("[WorkflowInit] Skipping - pendingLoadParams will handle form data");
      return;
    }

    const currentData = store.get(formDataAtom) || {};
    const hasExistingData = Object.keys(currentData).length > 0;
    const hasMissingDefaults = Object.entries(schema)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter(([key]: [string, any]) => isPersistableSchemaKey(key))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .some(([key, field]: [string, any]) => field?.default !== undefined && currentData[key] === undefined);

    // When switching workflows, ALWAYS reload the new workflow's persisted data
    // Previously, `hasExistingData` would be true from the OLD pipe's data,
    // blocking the new pipe's saved sampler/scheduler from being loaded.
    const shouldLoadData = isWorkflowSwitch ||
      !initializedWorkflowsRef.current.has(workflowKey) ||
      hasMissingDefaults ||
      !hasExistingData;

    if (!shouldLoadData) {
      return;
    }

    let initialData: Record<string, unknown> = buildSchemaDefaults(schema);
    try {
      const saved = localStorage.getItem(`ds_pipe_params_${workflowKey}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        initialData = { ...initialData, ...parsed };
      }
    } catch (e) { /* ignore */ }
    const normalized = normalizeParamsWithDefaults(schema, initialData);
    setFormData(normalized);
    workflowParamsCacheRef.current[workflowKey] = normalized;
    initializedWorkflowsRef.current.add(workflowKey);
  }, [selectedWorkflow, visibleSchema, setFormData, store, pendingLoadParams]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { registerStateChange } = useUndoRedo();

  const flushPendingPersist = useCallback(() => {
    const pending = pendingPersistRef.current;
    if (!pending) return;
    try {
      localStorage.setItem(`ds_pipe_params_${pending.workflowId}`, JSON.stringify(pending.data));
      workflowParamsCacheRef.current[pending.workflowId] = pending.data;
    } catch (e) {
      console.warn("Failed to persist form data", e);
    }
    pendingPersistRef.current = null;
    if (persistHandleRef.current) {
      const handle = persistHandleRef.current;
      if (handle.type === "idle" && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(handle.id as number);
      } else {
        clearTimeout(handle.id as NodeJS.Timeout);
      }
      persistHandleRef.current = null;
    }
  }, []);

  const persistForm = useCallback((data: any) => {
    const currentData = store.get(formDataAtom) || {};
    // Safety: Don't persist if checkpoint got wiped (common init race condition)
    Object.keys(data)
      .filter((key) => key.includes("CheckpointLoaderSimple") && key.endsWith(".ckpt_name"))
      .forEach((key) => {
        const previous = currentData[key];
        if (data[key] === "" && typeof previous === "string" && previous.length > 0) {
          console.warn("[SafeGuard] Prevented overwriting checkpoint with empty string");
          data[key] = previous;
        }
      });

    setFormData(data);
    if (selectedWorkflowId) {
      const workflowId = selectedWorkflowId;
      workflowParamsCacheRef.current[workflowId] = data;
      pendingPersistRef.current = { workflowId, data };
      if (persistHandleRef.current) {
        const handle = persistHandleRef.current;
        if (handle.type === "idle" && typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(handle.id as number);
        } else {
          clearTimeout(handle.id as NodeJS.Timeout);
        }
        persistHandleRef.current = null;
      }
      const persistNow = () => {
        const pending = pendingPersistRef.current;
        if (!pending) return;
        try {
          localStorage.setItem(`ds_pipe_params_${pending.workflowId}`, JSON.stringify(pending.data));
        } catch (e) {
          console.warn("Failed to persist form data", e);
        }
        pendingPersistRef.current = null;
        persistHandleRef.current = null;
      };
      if (typeof window.requestIdleCallback === "function") {
        const id = window.requestIdleCallback(persistNow, { timeout: 500 });
        persistHandleRef.current = { id, type: "idle" };
      } else {
        const id = setTimeout(persistNow, 150);
        persistHandleRef.current = { id, type: "timeout" };
      }
    }
  }, [selectedWorkflowId, setFormData, store]);

  useEffect(() => {
    return () => {
      flushPendingPersist();
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
      pendingHistoryRef.current = null;
    };
  }, [selectedWorkflowId, flushPendingPersist]);

  // Ensure in-flight form persistence is flushed on tab close/refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      flushPendingPersist();
      const workflowId = selectedWorkflowIdRef.current;
      if (workflowId) {
        try {
          const latest = store.get(formDataAtom);
          localStorage.setItem(`ds_pipe_params_${workflowId}`, JSON.stringify(latest));
          workflowParamsCacheRef.current[workflowId] = latest;
        } catch (e) {
          console.warn("Failed to persist form data on unload", e);
        }
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") handleBeforeUnload();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [store, flushPendingPersist]);

  const pendingHistoryRef = useRef<{ prev: any; next: any; category: "text" | "structure"; skip: boolean } | null>(null);
  const historyTimerRef = useRef<NodeJS.Timeout | null>(null);
  const MAX_TEXT_UNDO_LEN = 8000;

  // Ref pattern: access focusedField without adding it as a dependency
  const focusedFieldRef = useRef(focusedField);
  focusedFieldRef.current = focusedField;

  const isTextField = useCallback((fieldKey: string) => {
    const def = visibleSchema?.[fieldKey];
    if (!def) return false;
    if (def.widget === "textarea") return true;
    return def.type === "STRING" || def.type === "string";
  }, [visibleSchema]);

  // Helper to generate a descriptive label for form changes
  const getFormChangeLabel = useCallback((prev: Record<string, unknown>, next: Record<string, unknown>): string => {
    // Find which keys changed
    const allKeys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
    const changedKeys: string[] = [];

    for (const key of allKeys) {
      if (prev?.[key] !== next?.[key]) {
        changedKeys.push(key);
      }
    }

    if (changedKeys.length === 0) return "Form updated";
    if (changedKeys.length > 2) return `Updated ${changedKeys.length} fields`;

    // Extract a friendly field name from the key (e.g., "3.KSampler.seed" -> "seed")
    const friendlyName = (key: string): string => {
      // Handle keys like "3.KSampler.seed" or "CheckpointLoaderSimple.ckpt_name"
      const parts = key.split(".");
      const lastPart = parts[parts.length - 1] || key;
      // Convert snake_case to readable format
      return lastPart.replace(/_/g, " ").replace(/\b\w/g, c => c);
    };

    if (changedKeys.length === 1) {
      const key = changedKeys[0];
      const name = friendlyName(key);
      // Check if it's a text/prompt field
      const def = visibleSchema?.[key];
      const isPrompt = key.toLowerCase().includes("prompt") ||
        key.toLowerCase().includes("positive") ||
        key.toLowerCase().includes("negative") ||
        def?.widget === "textarea";
      if (isPrompt) return `Updated ${name}`;
      return `Changed ${name}`;
    }

    // Two fields changed
    return `Changed ${friendlyName(changedKeys[0])} & ${friendlyName(changedKeys[1])}`;
  }, [visibleSchema]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleFormChange = useCallback((newData: any, { immediateHistory }: { immediateHistory?: boolean } = {}) => {
    const previous = store.get(formDataAtom);
    persistForm(newData);
    // Use ref to get current focusedField without dependency (keeps callback stable)
    const focusedKey = focusedFieldRef.current || "";
    const textFocused = focusedKey ? isTextField(focusedKey) : false;
    const focusedValue = textFocused ? newData[focusedKey] : null;
    const skipUndo = textFocused && typeof focusedValue === "string" && focusedValue.length > MAX_TEXT_UNDO_LEN;
    const category = textFocused ? "text" : "structure";
    logClientEventThrottled(
      "form_change",
      "form_change",
      {
        field: focusedKey || null,
        len: typeof focusedValue === "string" ? focusedValue.length : null,
        fields: Object.keys(newData || {}).length,
        skip_undo: skipUndo,
      },
      2000
    );

    // Only register undo after edits settle to avoid per-keystroke snapshots
    if (immediateHistory) {
      if (!skipUndo) {
        const label = getFormChangeLabel(previous, newData);
        registerStateChange(label, previous, newData, persistForm, false, category);
      }
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
      pendingHistoryRef.current = null;
      return;
    }

    pendingHistoryRef.current = { prev: previous, next: newData, category, skip: skipUndo };
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      if (pendingHistoryRef.current) {
        if (!pendingHistoryRef.current.skip) {
          const label = getFormChangeLabel(pendingHistoryRef.current.prev, pendingHistoryRef.current.next);
          registerStateChange(
            label,
            pendingHistoryRef.current.prev,
            pendingHistoryRef.current.next,
            persistForm,
            false,
            pendingHistoryRef.current.category
          );
        }
        pendingHistoryRef.current = null;
      }
      historyTimerRef.current = null;
    }, 350);
  }, [getFormChangeLabel, isTextField, persistForm, registerStateChange, store]);

  const handleResetDefaults = useCallback(() => {
    if (!selectedWorkflow) return;
    const schema = visibleSchema;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaults: any = {};
    Object.keys(schema).forEach((k) => {
      if (schema[k].default !== undefined) defaults[k] = schema[k].default;
    });

    // Clear persistence
    localStorage.removeItem(`ds_pipe_params_${selectedWorkflow.id}`);

    // Update state 
    persistForm(defaults);
    // Register a single history entry for reset
    handleFormChange(defaults, { immediateHistory: true });
    setFocusedField("");
  }, [handleFormChange, persistForm, selectedWorkflow, visibleSchema]);

  const handlePromptUpdate = useCallback((field: string, value: string) => {
    const currentData = store.get(formDataAtom) || {};
    handleFormChange({ ...currentData, [field]: value });
  }, [handleFormChange, store]);

  const handlePromptUpdateMany = useCallback((updates: Record<string, string>) => {
    if (!updates || Object.keys(updates).length === 0) return;
    const currentData = store.get(formDataAtom) || {};
    handleFormChange({ ...currentData, ...updates });
  }, [handleFormChange, store]);

  const handleUseInPipe = useCallback(({ workflowId, imagePath, galleryItem }: { workflowId: string; imagePath: string; galleryItem: GalleryItem }) => {
    flushPendingPersist();
    // Choose the workflow
    setSelectedWorkflowId(workflowId);

    // Prefer raw filesystem path, not API URL
    const rawPath = (() => {
      if (imagePath.includes("/api/") && imagePath.includes("path=")) {
        try {
          const url = new URL(imagePath, window.location.origin);
          const p = url.searchParams.get("path");
          if (p) return p;
        } catch { /* ignore */ }
      }
      return imagePath;
    })();

    const safeImage: ApiImage = {
      id: galleryItem?.image?.id ?? -1,
      job_id: galleryItem?.image?.job_id ?? null,
      path: rawPath,
      filename: galleryItem?.image?.filename || rawPath.split(/[\\/]/).pop() || "image.png",
      created_at: galleryItem?.image?.created_at || new Date().toISOString(),
    };

    const loadParams: GalleryItem = {
      ...(galleryItem || {} as GalleryItem),
      image: safeImage,
      prompt: galleryItem?.prompt
        || (galleryItem?.job_params as any)?.prompt
        || (galleryItem?.job_params as any)?.positive
        || (galleryItem?.job_params as any)?.text_positive,
      negative_prompt: galleryItem?.negative_prompt
        || (galleryItem?.job_params as any)?.negative_prompt
        || (galleryItem?.job_params as any)?.negative
        || (galleryItem?.job_params as any)?.text_negative,
      workflow_template_id: parseInt(workflowId, 10),
      job_params: {
        ...(galleryItem?.job_params || {}),
        prompt: galleryItem?.prompt
          || (galleryItem?.job_params as any)?.prompt
          || (galleryItem?.job_params as any)?.positive,
        positive: galleryItem?.prompt
          || (galleryItem?.job_params as any)?.positive
          || (galleryItem?.job_params as any)?.text_positive,
        negative: galleryItem?.negative_prompt
          || (galleryItem?.job_params as any)?.negative
          || (galleryItem?.job_params as any)?.text_negative,
        negative_prompt: galleryItem?.negative_prompt
          || (galleryItem?.job_params as any)?.negative_prompt
          || (galleryItem?.job_params as any)?.negative,
      }
    };

    // Preview immediately
    setPreviewPath(`/api/v1/gallery/image/path?path=${encodeURIComponent(rawPath)}`);
    setPreviewMetadata({
      prompt: loadParams.prompt || loadParams.job_params?.prompt,
      negative_prompt: loadParams.negative_prompt || loadParams.job_params?.negative_prompt,
      caption: loadParams.caption,
      created_at: loadParams.created_at,
    });

    if (loadParams.project_id !== undefined) {
      setSelectedProjectId(loadParams.project_id ? String(loadParams.project_id) : null);
    }

    setPendingLoadParams({ ...loadParams, __isRegenerate: false });
  }, [flushPendingPersist, setPendingLoadParams, setPreviewMetadata, setPreviewPath, setSelectedProjectId, setSelectedWorkflowId]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleRegenerate = useCallback((item: any, seedOption: 'same' | 'random') => {
    flushPendingPersist();
    // Extract image path from the item
    const imagePath = item?.image?.path || item?.job_params?.image || '';

    // Extract workflow_template_id from job_params
    const workflowId = item?.workflow_template_id
      || item?.job_params?.workflow_template_id
      || item?.job_params?.workflow_id;

    // Prefer raw filesystem path, not API URL
    const rawPath = (() => {
      if (imagePath.includes("/api/") && imagePath.includes("path=")) {
        try {
          const url = new URL(imagePath, window.location.origin);
          const p = url.searchParams.get("path");
          if (p) return p;
        } catch { /* ignore */ }
      }
      return imagePath;
    })();

    // Extract prompts from job_params - check multiple possible field names
    const jobParams = item?.job_params || {};

    // For positive prompt, check various field naming conventions
    const positivePrompt = item?.prompt
      || jobParams.prompt
      || jobParams.positive
      || jobParams.text_positive
      || jobParams.positive_prompt
      || null;

    // For negative prompt, check various field naming conventions  
    const negativePrompt = item?.negative_prompt
      || jobParams.negative_prompt
      || jobParams.negative
      || jobParams.text_negative
      || null;

    const loadParams: GalleryItem = {
      ...(item || {} as GalleryItem),
      image: item?.image || { id: -1, job_id: -1, path: rawPath, filename: rawPath.split(/[\\/]/).pop() || 'image.png', created_at: '' },
      prompt: positivePrompt,
      negative_prompt: negativePrompt,
      workflow_template_id: workflowId,
      job_params: {
        ...jobParams,
        // Ensure prompt fields are correctly set in job_params too
        prompt: positivePrompt,
        positive: positivePrompt,
        negative_prompt: negativePrompt,
        negative: negativePrompt,
      }
    };

    // Set the workflow to match the original
    if (workflowId) {
      setSelectedWorkflowId(String(workflowId));
    }

    // Set preview if we have an image path
    if (rawPath) {
      setPreviewPath(`/api/v1/gallery/image/path?path=${encodeURIComponent(rawPath)}`);
      setPreviewMetadata({
        prompt: positivePrompt,
        negative_prompt: negativePrompt,
        caption: loadParams.caption,
        created_at: loadParams.created_at,
      });
    }

    // Set pending load params with regenerate and seed flags
    setPendingLoadParams({
      ...loadParams,
      __isRegenerate: true,
      __randomizeSeed: seedOption === 'random'
    });
  }, [flushPendingPersist, setPendingLoadParams, setPreviewMetadata, setPreviewPath, setSelectedWorkflowId]);


  // Effect 1: CAPTURE loadParams immediately when navigation happens
  // This grabs the data before it can be lost and stores it in state
  useEffect(() => {
    const state = location.state as { loadParams?: GalleryItem; isRegenerate?: boolean } | null;
    if (!state?.loadParams) return;

    const { loadParams, isRegenerate } = state;

    console.log("[LoadParams] Captured loadParams, storing for processing");

    // Store for later processing (when workflows are loaded)
    // Include isRegenerate flag to differentiate from use-in-pipe
    setPendingLoadParams({ ...loadParams, __isRegenerate: isRegenerate });

    // Set preview immediately (doesn't need workflows)
    setPreviewPath(`/api/v1/gallery/image/path?path=${encodeURIComponent(loadParams.image.path)}`);
    setPreviewMetadata({
      prompt: loadParams.prompt || loadParams.job_params?.prompt,
      negative_prompt: loadParams.negative_prompt || loadParams.job_params?.negative_prompt,
      caption: loadParams.caption,
      created_at: loadParams.created_at,
    });

    // Set workflow and project IDs
    if (loadParams.workflow_template_id) {
      setSelectedWorkflowId(String(loadParams.workflow_template_id));
    }
    if (loadParams.project_id !== undefined) {
      setSelectedProjectId(loadParams.project_id ? String(loadParams.project_id) : null);
    }

    // Clear location.state to prevent re-processing on subsequent renders
    navigate(location.pathname, { replace: true });
  }, [location.state, navigate, location.pathname]);

  // Effect 2: PROCESS pendingLoadParams once workflows are available
  useEffect(() => {
    if (!pendingLoadParams) return;
    let cancelled = false;

    const processLoadParams = async () => {
      if (workflows.length === 0) {
        console.log("[LoadParams] Waiting for workflows to load...");
        return;
      }

      const loadParams = pendingLoadParams;
      const targetWorkflowId = loadParams.workflow_template_id
        ? String(loadParams.workflow_template_id)
        : selectedWorkflowId;

      const targetWorkflow = workflows.find(w => String(w.id) === targetWorkflowId);
      if (!targetWorkflow?.input_schema) {
        console.log("[LoadParams] Target workflow not found or has no schema:", targetWorkflowId);
        return;
      }

      console.log("[LoadParams] Processing with workflow:", targetWorkflow.name);

      const schema = targetWorkflow.input_schema;

      // STEP 1: Build defaults from target workflow schema
      const targetDefaults = buildSchemaDefaults(schema);

      const jobParams = (loadParams.job_params || {}) as Record<string, unknown>;
      const jobParamsFiltered = filterParamsForSchema(schema, jobParams);

      const readStoredParams = () => {
        // For use-in-pipe (not regenerate), we want the TARGET workflow's stored params.
        // DON'T use formDataAtom even if targetWorkflowId === selectedWorkflowId because:
        // - handleUseInPipe sets selectedWorkflowId BEFORE pendingLoadParams
        // - So by now formDataAtom still contains the OLD pipe's values
        // - We need to read from localStorage to get the TARGET pipe's saved values
        const cached = workflowParamsCacheRef.current[targetWorkflowId];
        if (cached) return cached;
        try {
          const saved = localStorage.getItem(`ds_pipe_params_${targetWorkflowId}`);
          if (saved) {
            const parsed = JSON.parse(saved);
            workflowParamsCacheRef.current[targetWorkflowId] = parsed;
            return parsed;
          }
        } catch (e) {
          console.warn("Failed to parse stored params", e);
        }
        return {};
      };

      // STEP 2: Merge defaults with stored params (use-in-pipe) or job params (regenerate)
      const storedParams = loadParams.__isRegenerate
        ? {}
        : filterParamsForSchema(schema, readStoredParams());
      const baseParams: Record<string, unknown> = loadParams.__isRegenerate
        ? { ...targetDefaults, ...jobParamsFiltered }
        : { ...targetDefaults, ...storedParams };

      // STEP 2.5: Handle seed for regeneration
      // If regenerating with same seed, copy seed from job_params
      // If regenerating with random seed, set seed to -1
      if (loadParams.__isRegenerate) {
        // Find seed field in schema
        const seedField = Object.keys(schema).find(k =>
          k.toLowerCase().includes('seed') &&
          !k.toLowerCase().includes('control_after')
        );

        if (seedField) {
          if (loadParams.__randomizeSeed) {
            // Random seed mode - set to -1
            baseParams[seedField] = -1;
            console.log("[LoadParams] Regenerate with random seed: -1");
          } else {
            // Same seed mode - copy from job_params
            const sourceSeed = jobParams[seedField] ?? jobParams['seed'] ?? jobParams['noise_seed'];
            if (sourceSeed !== undefined) {
              baseParams[seedField] = sourceSeed;
              console.log("[LoadParams] Regenerate with same seed:", sourceSeed);
            }
          }
        }
      }

      // STEP 3: Extract prompts from source image with multiple fallbacks
      let positivePrompt =
        loadParams.prompt ||
        (jobParams as any)?.prompt ||
        (jobParams as any)?.positive ||
        null;
      let negativePrompt =
        loadParams.negative_prompt ||
        (jobParams as any)?.negative_prompt ||
        (jobParams as any)?.negative ||
        null;

      const extracted = extractPrompts(jobParams);
      if (!positivePrompt && extracted.positive) positivePrompt = extracted.positive;
      if (!negativePrompt && extracted.negative) negativePrompt = extracted.negative;

      if (!positivePrompt || !negativePrompt) {
        try {
          const meta = await api.getImageMetadata(loadParams.image.path);
          positivePrompt = positivePrompt || (meta as any)?.prompt || null;
          negativePrompt = negativePrompt || (meta as any)?.negative_prompt || null;
        } catch (err) {
          console.warn("Failed to fetch metadata for prompt fallback", err);
        }
      }

      console.log("[LoadParams] Extracted prompts:", {
        positive: positivePrompt ? String(positivePrompt).substring(0, 50) + "..." : "undefined",
        negative: negativePrompt ? String(negativePrompt).substring(0, 50) + "..." : "undefined"
      });

      // STEP 4: Find prompt fields in target schema and inject
      // Prefer mapping to the same node/field we extracted from (prevents swap)
      const { positiveField, negativeField } = findPromptFieldsInSchema(schema);
      console.log("[LoadParams] Found prompt fields:", { positiveField, negativeField });

      const resolveTarget = (extractedKey: string | null, fallback: string | null) => {
        if (extractedKey && schema[extractedKey]) return extractedKey;
        // Try matching by node id prefix before '.' if present
        if (extractedKey && extractedKey.includes(".")) {
          const nodeId = extractedKey.split(".")[0];
          const match = Object.keys(schema).find(k => k.split(".")[0] === nodeId);
          if (match) return match;
        }
        return fallback;
      };

      const positiveTarget = resolveTarget(extracted.positiveFieldKey, positiveField);
      const negativeTarget = resolveTarget(extracted.negativeFieldKey, negativeField);

      const choosePromptValue = (primary: unknown, secondary: unknown) => {
        if (typeof primary === "string" && primary.trim()) return primary;
        if (typeof secondary === "string" && secondary.trim()) return secondary;
        return null;
      };

      if (positiveTarget) {
        const directPositive = jobParams[positiveTarget];
        const nextPositive = choosePromptValue(positivePrompt, directPositive);
        if (nextPositive) baseParams[positiveTarget] = nextPositive;
      }
      if (negativeTarget) {
        const directNegative = jobParams[negativeTarget];
        const nextNegative = choosePromptValue(negativePrompt, directNegative);
        if (nextNegative) baseParams[negativeTarget] = nextNegative;
      }

      // STEP 4.5: Show error only if we couldn't find ANY prompt from any source
      // Check both the positivePrompt variable AND the actual injected value
      const hasPromptInForm = positiveTarget && baseParams[positiveTarget];
      if (!positivePrompt && !hasPromptInForm && !cancelled) {
        setError("Could not extract prompts from the selected image. Please paste prompts manually.");
      }

      // STEP 5: Handle image injection - do it directly here instead of delegating to Effect 3
      // Regenerate prefers original input image; use-in-pipe prefers the selected output image.
      const imageFields = findImageFieldsInSchema(schema);
      console.log("[LoadParams] Found image fields:", imageFields);

      if (imageFields.length > 0) {
        const imageField = imageFields[0];
        const preferJobImage = Boolean(loadParams.__isRegenerate);

        // PRIORITY 1: Use original input image from job params if this is a regenerate flow.
        const jobImage = preferJobImage && typeof jobParams[imageField] === "string" ? jobParams[imageField] as string : null;
        if (jobImage && jobImage.trim()) {
          console.log("[LoadParams] Using image from job params:", jobImage);
          baseParams[imageField] = jobImage;
        } else if (loadParams.image?.path) {
          // FALLBACK: Use the output image path (for non-i2i workflows or if original not found)
          const imagePath = loadParams.image.path;

          // Check if image is already in ComfyUI input directory
          const inputMatch = imagePath.match(/[/\\]input[/\\](.+)$/);
          if (inputMatch) {
            // Image already in input dir - use relative path directly
            const relativePath = inputMatch[1].replace(/\\/g, "/");
            console.log("[LoadParams] Reusing existing input path:", relativePath);
            baseParams[imageField] = relativePath;
          } else {
            // Image is in output/other directory - need to upload it
            console.log("[LoadParams] Uploading image to input dir:", imagePath);
            try {
              const url = `/api/v1/gallery/image/path?path=${encodeURIComponent(imagePath)}`;
              const res = await fetch(url);
              if (res.ok) {
                const blob = await res.blob();
                const filename = imagePath.split(/[\\/]/).pop() || "injected_image.png";
                const file = new File([blob], filename, { type: blob.type });

                const engineId = selectedEngineId ? parseInt(selectedEngineId) : undefined;
                const result = await api.uploadFile(file, engineId, selectedProject?.slug, undefined);

                console.log("[LoadParams] Image upload complete:", result.filename);
                baseParams[imageField] = result.filename;
              } else {
                console.warn("[LoadParams] Failed to fetch image for upload, clearing field");
                // Clear the image field so ComfyUI doesn't use a default/old value
                baseParams[imageField] = "";
              }
            } catch (err) {
              console.warn("[LoadParams] Image upload failed:", err);
              // Clear the image field so ComfyUI doesn't use a default/old value
              baseParams[imageField] = "";
            }
          }
        }
      }

      if (cancelled) return;

      const normalizedParams = normalizeParamsWithDefaults(schema, baseParams);

      // STEP 6: Persist to localStorage so workflow init effect picks it up
      try {
        localStorage.setItem(`ds_pipe_params_${targetWorkflowId}`, JSON.stringify(normalizedParams));
        workflowParamsCacheRef.current[targetWorkflowId] = normalizedParams;
      } catch (e) {
        console.warn("Failed to persist loadParams", e);
      }

      // STEP 7: Update form state directly  
      setFormData(normalizedParams);
      setExternalValueSyncKey((prev) => prev + 1);

      // Clear pending - we've processed it
      setPendingLoadParams(null);
      console.log("[LoadParams] Processing complete");
    };

    processLoadParams();
    return () => { cancelled = true; };

  }, [pendingLoadParams, workflows, selectedWorkflowId]);

  // Effect 3: Process pending image injection after workflow loads
  useEffect(() => {
    const processPendingImage = async () => {
      const pending = sessionStorage.getItem("ds_pending_image_inject");
      if (!pending) return;

      try {
        const { imagePath, imageField, workflowId } = JSON.parse(pending);

        // Only process if we're on the correct workflow
        if (workflowId !== selectedWorkflowId) return;

        // Clear the pending item first to prevent re-processing
        sessionStorage.removeItem("ds_pending_image_inject");

        // If the image already lives in ComfyUI/input, reuse its relative path
        const inputMatch = imagePath.match(/[/\\]input[/\\](.+)$/);
        if (inputMatch) {
          const relativePath = inputMatch[1].replace(/\\/g, "/");
          console.log("[ImageInject] Reusing existing input path:", relativePath);
          const currentFormData = store.get(formDataAtom) || {};
          const newFormData = { ...currentFormData, [imageField]: relativePath };
          setFormData(newFormData);
          try {
            localStorage.setItem(`ds_pipe_params_${selectedWorkflowId}`, JSON.stringify(newFormData));
            if (selectedWorkflowId) {
              workflowParamsCacheRef.current[selectedWorkflowId] = newFormData;
            }
          } catch (e) { /* ignore */ }
          return;
        }

        console.log("[ImageInject] Uploading image:", imagePath, "to field:", imageField);

        // Fetch the image and upload it
        const url = `/api/v1/gallery/image/path?path=${encodeURIComponent(imagePath)}`;
        const res = await fetch(url);
        const blob = await res.blob();
        const filename = imagePath.split(/[\\/]/).pop() || "injected_image.png";
        const file = new File([blob], filename, { type: blob.type });

        const id = selectedEngineId ? parseInt(selectedEngineId) : undefined;
        const result = await api.uploadFile(file, id, selectedProject?.slug, undefined);

        console.log("[ImageInject] Upload complete:", result.filename);

        // Update the form with the uploaded image filename - use latest store state
        const currentFormData = store.get(formDataAtom) || {};
        const newFormData = { ...currentFormData, [imageField]: result.filename };
        setFormData(newFormData);

        // Also persist to localStorage
        try {
          localStorage.setItem(`ds_pipe_params_${selectedWorkflowId}`, JSON.stringify(newFormData));
          if (selectedWorkflowId) {
            workflowParamsCacheRef.current[selectedWorkflowId] = newFormData;
          }
        } catch (e) { /* ignore */ }

      } catch (err) {
        console.error("Failed to process pending image inject:", err);
        sessionStorage.removeItem("ds_pending_image_inject");
      }
    };

    if (selectedWorkflowId && selectedEngineId) {
      processPendingImage();
    }
  }, [selectedWorkflowId, selectedEngineId, selectedProject]);

  const loadPromptLibrary = async (query?: string) => {
    if (!selectedWorkflowId) {
      clearPrompts();
      return;
    }
    setPromptLoading(true);
    setPromptError(null);
    try {
      const search = query ?? promptSearch;
      if (!shouldRefetchPrompts(selectedWorkflowId, search)) {
        setPromptLoading(false);
        return;
      }
      const data = await api.getPrompts(search, parseInt(selectedWorkflowId));
      setPrompts(data, selectedWorkflowId, search);
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : "Failed to load prompts");
    } finally {
      setPromptLoading(false);
    }
  };

  useEffect(() => {
    if (selectedWorkflowId) {
      loadPromptLibrary();
    } else {
      clearPrompts();
    }
  }, [selectedWorkflowId]);

  const submitPromptSearch = () => loadPromptLibrary(promptSearch);



  const handlePromptSearchChange = (value: string) => {
    setPromptSearch(value);
  };






  // On mount, check if we have a running job in the feed and restore lastJobId to resume WS
  useEffect(() => {
    // We only want to do this ONCE on mount
    if (lastJobId) return;

    const active = generationFeed[0];
    if (active && (active.status === "queued" || active.status === "processing" || active.status === "initiating")) {
      console.log("Resuming WebSocket for job", active.jobId);
      setLastJobId(active.jobId);
      setGenerationState(mapStatusToGenerationState(active.status));
      setStatusLabel(active.status);
      setProgress(active.progress);
    }
  }, []); // Empty dependency array intentionally to run only on mount

  const wsRef = useRef<WebSocket | null>(null);
  const lastPreviewUpdateRef = useRef<number>(0);
  const lastProgressUpdateRef = useRef<number>(0);
  const PROGRESS_THROTTLE_MS = 100; // Minimum ms between progress updates
  const wsDebug = useMemo(
    () => import.meta.env.DEV && localStorage.getItem("ds_debug_ws") === "1",
    []
  );
  const logWs = (...args: unknown[]) => {
    if (wsDebug) console.log(...args);
  };

  useEffect(() => {
    if (!lastJobId) return;

    // Close previous WebSocket if exists
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      wsRef.current.close();
    }

    setGenerationState(prev => (prev === "running" ? prev : "queued"));
    setStatusLabel(prev => prev || "queued");
    setProgress(prev => prev > 0 ? prev : 0);
    if (!jobStartTime) setJobStartTime(Date.now());

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsApiPath = window.location.pathname.startsWith('/studio') ? '/sts-api/api/v1' : '/api/v1';
    const wsUrl = `${wsProtocol}//${window.location.host}${wsApiPath}/jobs/${lastJobId}/ws`;
    logWs(`[WS] Connecting to: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      logWs(`[WS] Connected to job ${lastJobId}`);

      // Check if job already failed (race condition: error broadcast before WS connected)
      try {
        const job = await api.getJob(lastJobId);
        if (job.status === "failed" && job.error) {
          logWs(`[WS] Job already failed before connection: ${job.error}`);
          setGenerationState("failed");
          setStatusLabel("failed");
          setError(job.error);
          updateFeed(lastJobId, { status: "failed", previewBlob: null });
        } else if (job.status === "completed") {
          logWs(`[WS] Job already completed before connection`);
          setGenerationState("completed");
          setStatusLabel("");
          setProgress(100);
          setGalleryRefresh(prev => prev + 1);
        }
      } catch (err) {
        console.error("Failed to check initial job status:", err);
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      logWs(`[WS] Message received:`, data.type);

      if (data.type === "status") {
        const nextState = mapStatusToGenerationState(data.status);
        setGenerationState(nextState);
        setStatusLabel(data.status || "");
        const statusUpdates: { status: string; previewBlob?: string | null } = { status: data.status };
        if (data.status === "failed" || data.status === "cancelled") {
          statusUpdates.previewBlob = null;
        }
        updateFeed(lastJobId, statusUpdates);
      } else if (data.type === "progress") {
        // Time-based throttle: MUST be first to skip ALL work when messages arrive too frequently
        const now = Date.now();
        if (now - lastProgressUpdateRef.current < PROGRESS_THROTTLE_MS) {
          return; // Skip this update entirely, another will come shortly
        }
        lastProgressUpdateRef.current = now;

        const { value, max } = data.data;
        const pct = (value / max) * 100;

        // Use functional updates to avoid re-renders when values haven't changed
        // Wrap in startTransition to mark as low-priority (keeps UI responsive)
        startTransition(() => {
          setProgress(prev => prev === pct ? prev : pct);
          setGenerationState(prev => prev === "running" ? prev : "running");
          setStatusLabel(prev => prev === "processing" ? prev : "processing");
        });

        // Track progress history for time estimation
        progressHistoryRef.current = addProgressEntry(progressHistoryRef.current, value);
        const stats = calculateProgressStats(
          progressHistoryRef.current,
          max,
          jobStartTime || Date.now()
        );

        // Use RAF to defer expensive state updates and avoid blocking the main thread
        requestAnimationFrame(() => {
          updateFeed(lastJobId, {
            progress: pct,
            status: "processing",
            currentStep: value,
            totalSteps: max,
            elapsedMs: stats?.elapsedMs,
            estimatedRemainingMs: stats?.estimatedRemainingMs,
            iterationsPerSecond: stats?.iterationsPerSecond,
          });
        });
      } else if (data.type === "execution_complete" || data.type === "generation_done") {
        // ComfyUI finished rendering - reset button immediately
        // Don't wait for image download/saving (5-7s)
        logWs(`[WS] Received ${data.type} - resetting button and clearing job state`);
        setGenerationState("completed");  // Clear status to show "generate" button
        setStatusLabel("");
        setProgress(0);    // Reset progress
        // Update feed to prevent sync effects from re-setting status
        updateFeed(lastJobId, { status: "completed", progress: 100, previewBlob: null });
        // Note: Keep lastJobId so the 'completed' message can still update gallery
        // but the button is already reset
      } else if (data.type === "executing") {
        // Check if this is the final "executing" message with node=null (ComfyUI finished)
        if (data.data?.node === null) {
          // ComfyUI finished rendering - reset button immediately!
          logWs(`[WS] Received executing with node=null - ComfyUI done, resetting button`);
          setGenerationState("completed");
          setStatusLabel("");
          setProgress(0);
          updateFeed(lastJobId, { status: "completed", progress: 100 });
        } else {
          // Still processing a node
          setGenerationState("running");
          setStatusLabel("processing");
          updateFeed(lastJobId, { status: "processing" });
        }
      } else if (data.type === "completed") {
        setGenerationState("completed");
        setStatusLabel("");
        setProgress(100);

        if (data.images && data.images.length > 0) {
          const imagePath = data.images[0].path;
          const allPaths = data.images.map((img: any) => img.path);

          // Use authoritative params from Backend (robust) instead of frontend state
          const params = data.job_params || {};
          const mainPrompt = data.prompt || "Generated Image";

          updateFeed(lastJobId, {
            status: "completed",
            progress: 100,
            previewPath: imagePath,
            previewPaths: allPaths,
            previewBlob: null,
          });

          // Store metadata for potential use but don't trigger navigation
          // The gallery refresh will show the new image naturally at index 0
          setPreviewMetadata({
            prompt: mainPrompt,
            negative_prompt: data.negative_prompt,
            created_at: new Date().toISOString(),
            job_params: params
          });
          // Clear previewPath so ImageViewer doesn't try to align to it
          setPreviewPath(null);
          // Clear ProjectGallery images so navigation uses the updated galleryImages
          setProjectGalleryImages([]);

          // Optimistically add new image to galleryImages immediately
          // This ensures index 0 has the new image when resetKey effect runs
          const newGalleryItem: GalleryItem = {
            image: data.images[0],
            job_params: params,
            prompt: mainPrompt,
            negative_prompt: data.negative_prompt,
            prompt_history: [],
            workflow_template_id: selectedWorkflow?.id,
            created_at: new Date().toISOString(),
          };
          setGalleryImages(prev => [newGalleryItem, ...prev]);
        } else {
          updateFeed(lastJobId, { status: "completed", progress: 100, previewBlob: null });
        }
        setGalleryRefresh(prev => prev + 1);
        // Cleanup - button was already reset by generation_done
        setLastJobId(null);
      } else if (data.type === "preview") {
        // Live Preview from KSampler - THROTTLED to prevent main thread blocking
        // Large base64 blobs cause React state updates that freeze the UI (Chrome "message handler took Xms" warnings)
        if (!feedOpen || (typeof document !== "undefined" && document.visibilityState === "hidden")) {
          return;
        }
        const now = Date.now();
        if (now - lastPreviewUpdateRef.current < 150) {
          return; // Skip this preview, update at most every 150ms
        }
        lastPreviewUpdateRef.current = now;

        const targetJobId = data.job_id ?? lastJobId;
        if (targetJobId && data.data?.blob) {
          // Use RAF-optimized method to avoid main thread blocking
          updatePreviewBlob(targetJobId, data.data.blob);
        }
      } else if (data.type === "save_failed") {
        // CRITICAL: Alert user that images failed to save
        const msg = data.message || `${data.failed_count} image(s) failed to save!`;
        console.error("[SAVE FAILED]", data);
        setError(`⚠️ SAVE FAILED: ${msg}`);
        // Keep the generation state as completed but show the error prominently
        // The completed event will still arrive with any images that DID save
      } else if (data.type === "error") {
        setGenerationState("failed");
        setStatusLabel("failed");
        setError(data.message);
        updateFeed(lastJobId, { status: "failed", previewBlob: null });
        // Reset button to idle on error
        setLastJobId(null);
      }
    };

    ws.onclose = (event) => {
      logWs(`[WS] Closed for job ${lastJobId}. Code: ${event.code}, Reason: ${event.reason}, Clean: ${event.wasClean}`);
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };

    ws.onerror = (errorEvent) => {
      console.error("Job WebSocket error - checking job status via API", errorEvent);
      // Don't immediately mark as failed - the job may have completed on the backend
      // Check job status via API before giving up
      setTimeout(async () => {
        try {
          const job = await api.getJob(lastJobId);
          if (job.status === "completed") {
            setGenerationState("completed");
            setStatusLabel("");
            setProgress(100);
            setGalleryRefresh(prev => prev + 1);
          } else if (job.status === "failed" || job.status === "cancelled") {
            setGenerationState(mapStatusToGenerationState(job.status));
            setStatusLabel(job.status);
            setError(job.error || "Job failed");
            updateFeed(lastJobId, { status: job.status, previewBlob: null });
          } else {
            // Job might still be running, poll again
            setError("Connection lost - checking status...");
          }
        } catch (e) {
          console.error("Failed to check job status:", e);
          setError("Connection lost during generation");
          setGenerationState("failed");
          setStatusLabel("failed");
          updateFeed(lastJobId, { status: "failed", previewBlob: null });
        }
      }, 1500);
    };

    return () => {
      // Only close if this is still the current WebSocket
      if (wsRef.current === ws) {
        logWs(`[WS] Cleanup: closing connection for job ${lastJobId}`);
        ws.close();
        wsRef.current = null;
      }
    };
  }, [lastJobId]);

  // Global Shortcut for Generation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        // Skip if focus is inside the snippet editor (Ctrl+Enter saves the snippet there)
        // UNLESS both the title and content inputs are empty - then trigger generation
        const activeEl = document.activeElement;
        const snippetEditor = activeEl?.closest('[data-snippet-editor="true"]');
        if (snippetEditor) {
          // Check if both inputs are empty - if so, allow generation
          const titleInput = snippetEditor.querySelector('input') as HTMLInputElement | null;
          const contentTextarea = snippetEditor.querySelector('textarea') as HTMLTextAreaElement | null;
          const titleEmpty = !titleInput?.value?.trim();
          const contentEmpty = !contentTextarea?.value?.trim();

          if (!titleEmpty || !contentEmpty) {
            // Editor has content, let the snippet editor handle it
            return;
          }
          // Both empty - fall through to trigger generation
        }

        if (!selectedWorkflowId || isBusy || engineOffline) return;
        handleBatchGenerate(store.get(formDataAtom));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedWorkflowId, isBusy, engineOffline, store]);

  // Use data from GenerationContext if available to avoid duplicate API calls
  const generation = useGeneration();
  const contextWorkflows = generation?.workflows;
  const contextProjects = generation?.projects;

  useEffect(() => {
    // If GenerationContext already has workflows, use them instead of fetching again
    if (contextWorkflows && contextWorkflows.length > 0) {
      setWorkflows(contextWorkflows);
      if (!selectedWorkflowId && contextWorkflows.length > 0) {
        setSelectedWorkflowId(String(contextWorkflows[0].id));
      }
    }
  }, [contextWorkflows, selectedWorkflowId]);

  useEffect(() => {
    // If GenerationContext already has projects, use them
    if (contextProjects && contextProjects.length > 0) {
      setProjects(contextProjects);
    }
  }, [contextProjects]);

  useEffect(() => {
    const loadData = async () => {
      try {
        // Only fetch data that GenerationContext doesn't provide or hasn't loaded yet
        const needsWorkflows = !contextWorkflows || contextWorkflows.length === 0;
        const needsProjects = !contextProjects || contextProjects.length === 0;

        const [enginesRes, workflowsRes, projectsRes] = await Promise.allSettled([
          api.getEngines(),
          needsWorkflows ? api.getWorkflows() : Promise.resolve([]),
          needsProjects ? api.getProjects() : Promise.resolve([]),
        ]);

        if (enginesRes.status === "fulfilled") {
          const enginesData = enginesRes.value;
          setEngines(enginesData);
          if (!selectedEngineId && enginesData.length > 0) setSelectedEngineId(String(enginesData[0].id));
        } else {
          console.error("Failed to load engines", enginesRes.reason);
        }

        if (needsWorkflows && workflowsRes.status === "fulfilled") {
          const workflowsData = workflowsRes.value;
          if (workflowsData.length > 0) {
            setWorkflows(workflowsData);
            if (!selectedWorkflowId && workflowsData.length > 0) setSelectedWorkflowId(String(workflowsData[0].id));
          }
        } else if (needsWorkflows && workflowsRes.status === "rejected") {
          console.error("Failed to load workflows", workflowsRes.reason);
        }

        if (needsProjects && projectsRes.status === "fulfilled") {
          const projectsData = projectsRes.value;
          if (projectsData.length > 0) {
            setProjects(projectsData);
          }
        } else if (needsProjects && projectsRes.status === "rejected") {
          console.warn("Failed to load projects", projectsRes.reason);
        }

      } catch (err) {
        console.error("Critical error loading data", err);
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setIsLoading(false);
      }
    };
    const pollHealth = async () => {
      try {
        const status = await api.getEngineHealth();
        setEngineHealth(status);
      } catch (err) {
        console.warn("Failed to poll ComfyUI health", err);
      }
    };

    loadData();
    pollHealth();
    healthIntervalRef.current = setInterval(pollHealth, 2500);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (healthIntervalRef.current) {
        clearInterval(healthIntervalRef.current);
        healthIntervalRef.current = null;
      }
    };
  }, [contextWorkflows, contextProjects]);


  const handleReboot = async () => {
    if (!confirm("Reboot ComfyUI now? This will disconnect the interface momentarily.")) return;
    await api.rebootComfyUI();
    alert("Reboot triggered. Please wait a few moments for ComfyUI to restart.");
    setInstallOpen(false);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleGenerate = async (data: any) => {
    if (!selectedEngineId || !selectedWorkflowId) return;

    if (engineOffline) {
      setError(selectedEngineHealth?.last_error || "ComfyUI is unreachable. Waiting for reconnection...");
      return;
    }

    setError(null);
    setGenerationState("queued");
    setStatusLabel("queued");
    setProgress(0);
    try {
      // Filter params to only include those in the current schema
      // This prevents "pollution" from previous workflows or uncleaned state
      // Filter params to only include those in the current schema AND not bypassed
      // This prevents "pollution" from previous workflows or bypassed nodes
      const schema = visibleSchema || {};

      // Identify bypassed nodes
      const bypassedNodeIds = new Set<string>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Object.entries(schema).forEach(([key, field]: [string, any]) => {
        if (field.widget === 'toggle' && (key.toLowerCase().includes('bypass') || field.title?.toLowerCase().includes('bypass'))) {
          if (data[key]) {
            if (field.x_node_id) bypassedNodeIds.add(field.x_node_id);
          }
        }
      });

      const cleanParams = Object.keys(data).reduce((acc, key) => {
        // Always preserve __bypass_ keys - they control which nodes are bypassed
        if (key.startsWith("__bypass_")) {
          acc[key] = data[key];
          return acc;
        }
        if (key in schema) {
          // Check if belonging to a bypassed node
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const field = schema[key] as any;
          if (field.x_node_id && bypassedNodeIds.has(field.x_node_id)) {
            // Keep the toggle itself, drop parameters
            const isBypassToggle = field.widget === 'toggle' && (key.toLowerCase().includes('bypass') || field.title?.toLowerCase().includes('bypass'));
            if (!isBypassToggle) return acc;
          }
          acc[key] = data[key];
        }
        return acc;
      }, {} as Record<string, any>);

      const job = await api.createJob(
        parseInt(selectedEngineId),
        parseInt(selectedWorkflowId),
        selectedProjectId ? parseInt(selectedProjectId) : null,
        cleanParams,
        generationTarget || null
      );
      if (!selectedProjectId) {
        setUnsavedJobIds((prev) => (prev.includes(job.id) ? prev : [...prev, job.id]));
      }
      // Reset progress history for new job
      progressHistoryRef.current = [];
      setJobStartTime(Date.now());
      lastSubmittedParamsRef.current = cleanParams; // Persist for preview
      setLastJobId(job.id);
      trackFeedStart(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job");
      setGenerationState("failed");
      setStatusLabel("failed");
    }
  };

  // Delegate to Context for Global Header button
  // Note: 'generation' is already defined earlier in the component
  const handleGenerateRef = useRef(handleGenerate);
  handleGenerateRef.current = handleGenerate;

  // Batch generation: submit multiple jobs to backend queue
  // Backend processes them sequentially - we track how many were submitted
  const handleBatchGenerate = useCallback(async (data: any) => {
    if (batchSize <= 1) {
      // Single generation - use original function
      return handleGenerate(data);
    }

    // Reset batch state
    batchCancelledRef.current = false;

    // Submit the first job via handleGenerate - this sets up UI state properly
    await handleGenerate(data);

    // Submit remaining jobs directly to the backend queue
    // They will be processed after the first completes
    for (let i = 1; i < batchSize; i++) {
      if (batchCancelledRef.current) {
        console.log(`[Batch] Cancelled before submitting job ${i + 1}/${batchSize}`);
        break;
      }

      try {
        // Build clean params (same logic as handleGenerate)
        const schema = visibleSchema || {};
        const bypassedNodeIds = new Set<string>();
        Object.entries(schema).forEach(([key, field]: [string, any]) => {
          if (field.widget === 'toggle' && (key.toLowerCase().includes('bypass') || field.title?.toLowerCase().includes('bypass'))) {
            if (data[key]) {
              if (field.x_node_id) bypassedNodeIds.add(field.x_node_id);
            }
          }
        });

        const cleanParams = Object.keys(data).reduce((acc, key) => {
          if (key.startsWith("__bypass_")) {
            acc[key] = data[key];
            return acc;
          }
          if (key in schema) {
            const field = schema[key] as any;
            if (field.x_node_id && bypassedNodeIds.has(field.x_node_id)) {
              const isBypassToggle = field.widget === 'toggle' && (key.toLowerCase().includes('bypass') || field.title?.toLowerCase().includes('bypass'));
              if (!isBypassToggle) return acc;
            }
            acc[key] = data[key];
          }
          return acc;
        }, {} as Record<string, any>);

        await api.createJob(
          parseInt(selectedEngineId!),
          parseInt(selectedWorkflowId!),
          selectedProjectId ? parseInt(selectedProjectId) : null,
          cleanParams,
          generationTarget || null
        );

        console.log(`[Batch] Submitted job ${i + 1}/${batchSize}`);
      } catch (err) {
        console.error(`[Batch] Failed to submit job ${i + 1}:`, err);
      }
    }

    console.log(`[Batch] All ${batchSize} jobs submitted to queue`);
  }, [batchSize, handleGenerate, visibleSchema, selectedEngineId, selectedWorkflowId, selectedProjectId, generationTarget]);

  const handleBatchGenerateRef = useRef(handleBatchGenerate);
  handleBatchGenerateRef.current = handleBatchGenerate;

  useEffect(() => {
    if (!generation) return;
    const handler = async () => {
      // Use latest refs to ensure we catch current state without re-binding
      const currentData = store.get(formDataAtom);
      if (currentData) {
        await handleBatchGenerateRef.current(currentData);
      }
    };
    generation.registerGenerateHandler(handler);
    return () => generation.unregisterGenerateHandler();
  }, [generation, store]);

  const handleCancel = async () => {
    // Cancel any running batch
    batchCancelledRef.current = true;

    if (!lastJobId) return;
    try {
      await api.cancelJob(lastJobId);
      setGenerationState("cancelled");
      setStatusLabel("cancelled");
      setLastJobId(null);
    } catch (err) {
      console.error("Failed to cancel", err);
    }
  };

  const handleGallerySelect = useCallback((item: GalleryItem) => {
    handlePreviewSelect(item.image.path, {
      prompt: item.prompt,
      created_at: item.created_at,
      job_params: item.job_params
    });
  }, [handlePreviewSelect]);

  const handleWorkflowSelect = useCallback(async (workflowId: string, fromImagePath?: string) => {
    if (fromImagePath) {
      setIsLoading(true);
      try {
        const url = `/api/v1/gallery/image/path?path=${encodeURIComponent(fromImagePath)}`;
        const res = await fetch(url);
        const blob = await res.blob();
        const filename = fromImagePath.split(/[\\/]/).pop() || "transfer.png";
        const file = new File([blob], filename, { type: blob.type });

        const uploaded = await api.uploadFile(file, selectedEngineId ? parseInt(selectedEngineId) : undefined);

        const targetSchema = workflows.find(w => String(w.id) === workflowId)?.input_schema;
        if (targetSchema) {
          const imageFields = findImageFieldsInSchema(targetSchema);
          const imageFieldKey = imageFields[0];

          if (imageFieldKey) {
            // Use the standardized persistence key to ensure this image selection survives reloads
            const key = `ds_pipe_params_${workflowId}`;
            const currentStored = JSON.parse(localStorage.getItem(key) || "{}");
            const newData = { ...currentStored, [imageFieldKey]: uploaded.filename };
            localStorage.setItem(key, JSON.stringify(newData));
            workflowParamsCacheRef.current[workflowId] = newData;
          }
        }
      } catch (e) {
        console.error("Failed to transfer image", e);
        setError("Failed to transfer image to workflow");
      } finally {
        setIsLoading(false);
      }
    }

    setSelectedWorkflowId(workflowId);
  }, [selectedEngineId, setSelectedWorkflowId, workflows]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-slate-100 flex overflow-hidden relative">

      {/* 1. Left Column - Prompt Constructor (Collapsible) */}
      <div
        className={`flex-none bg-white border-r hidden xl:flex flex-col overflow-hidden transition-all duration-200 ${promptConstructorCollapsed ? 'w-8 cursor-pointer hover:bg-slate-50' : 'w-[380px]'
          }`}
        onClick={promptConstructorCollapsed ? () => setPromptConstructorCollapsed(false) : undefined}
      >
        {promptConstructorCollapsed ? (
          // Collapsed state - narrow bar with icon
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400">
            <ChevronRight className="w-4 h-4" />
            <span className="text-[9px] font-medium tracking-wider uppercase [writing-mode:vertical-lr] rotate-180">
              prompts
            </span>
          </div>
        ) : (
          // Expanded state - full prompt constructor
          <>
            {/* Collapse toggle header */}
            <div className="flex-none flex items-center justify-between px-3 py-2 border-b bg-slate-50/50">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">prompt constructor</span>
              <button
                onClick={() => setPromptConstructorCollapsed(true)}
                className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                title="Collapse prompt constructor"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              {selectedWorkflow ? (
                <PromptConstructorPanel
                  // Filter out hidden parameters if the new editor logic flagged them
                  schema={
                    Object.fromEntries(
                      Object.entries(visibleSchema ?? {}).filter(
                        ([_, val]: [string, any]) => !val.__hidden
                      )
                    )
                  }
                  onUpdate={handlePromptUpdate}
                  onUpdateMany={handlePromptUpdateMany}
                  targetField={focusedField}
                  onTargetChange={setFocusedField}
                  onFinish={() => setFocusedField("")}
                  snippets={library}
                  onUpdateSnippets={setLibrary}
                  externalValueSyncKey={externalValueSyncKey}
                />
              ) : (
                <div className="p-4 text-xs text-slate-400">select a prompt pipe to use the constructor</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* 2. Configuration (Left) - NEW LAYOUT */}
      <div className="w-[420px] flex-none bg-blue-50 border-r border-blue-100 flex flex-col h-full overflow-hidden">

        {/* Sticky Header Section */}
        <div className="flex-none p-3 space-y-2 border-b bg-slate-50/50 backdrop-blur z-10">
          <div className="text-xs font-bold text-slate-800 tracking-wider">configurator</div>

          {/* Project + Destination Row */}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-[9px] font-bold text-slate-400 lowercase tracking-wider">project</label>
              <Select
                value={selectedProjectId || "none"}
                onValueChange={(value) => {
                  if (value === "none") {
                    setSelectedProjectId(null);
                  } else {
                    setSelectedProjectId(value);
                  }
                  setGalleryRefresh((prev) => prev + 1);
                }}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="select project">
                    {selectedProject?.name || draftsProject?.name || "drafts"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {draftsProject && (
                    <SelectItem value={String(draftsProject.id)}>
                      {draftsProject.name.toLowerCase()}
                    </SelectItem>
                  )}
                  {projects
                    .filter((p) => !draftsProject || p.id !== draftsProject.id)
                    .map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Destination Selector (Compact) - hidden for drafts project which has no subfolders */}
            {selectedProjectId && selectedProject?.slug !== "drafts" && (
              <div className="flex-1">
                <label className="text-[9px] font-bold text-slate-400 lowercase tracking-wider">destination</label>
                <Select
                  value={generationTarget || "engine-default"}
                  onValueChange={(value) => setGenerationTarget(value === "engine-default" ? "" : value)}
                >
                  <SelectTrigger className="h-7 text-[10px]">
                    <SelectValue placeholder="output" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="engine-default">default output</SelectItem>
                    {projectFolders.map((folder) => (
                      <SelectItem key={folder} value={folder}>
                        /{folder}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* GENERATE BUTTON + QUEUE INPUT */}
          <div className="pt-1 flex gap-2">
            <Button
              size="lg"
              className="flex-1 relative overflow-hidden transition-all active:scale-[0.98] shadow-sm hover:shadow-md"
              disabled={!selectedWorkflowId || engineOffline || isBusy}
              onClick={() => handleBatchGenerate(store.get(formDataAtom))}
              style={{
                background: isBusy
                  ? `linear-gradient(90deg, #3b82f6 ${progress}%, #1e40af ${progress}%)`
                  : undefined
              }}
            >
              <div className="relative z-10 flex items-center justify-center gap-2">
                {generationState === "queued" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>queuing...</span>
                  </>
                ) : generationState === "running" ? (
                  (() => {
                    const elapsed = jobStartTime ? (Date.now() - jobStartTime) / 1000 : 0;
                    const estimatedTotal = progress > 0 ? elapsed / (progress / 100) : 0;
                    const remaining = Math.max(0, estimatedTotal - elapsed);
                    return (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-white/80" />
                        <span>{Math.round(progress)}% · ~{Math.round(remaining)}s</span>
                      </>
                    );
                  })()
                ) : (
                  <>
                    <span className="font-bold tracking-wide">generate</span>
                    {selectedWorkflow && <span className="opacity-50 font-normal text-xs"> (ctl+enter)</span>}
                  </>
                )}
              </div>
            </Button>

            {/* Queue Count Input */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-slate-400">×</span>
              <input
                type="number"
                min={1}
                max={100}
                value={batchSize}
                onChange={(e) => {
                  const num = parseInt(e.target.value);
                  if (!isNaN(num) && num >= 1 && num <= 100) {
                    setBatchSize(num);
                  }
                }}
                disabled={isBusy}
                className="w-12 h-10 text-center text-sm font-semibold border rounded-md bg-white disabled:bg-slate-100 disabled:text-slate-400"
                title="Number of times to run (1-100)"
              />
            </div>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6" style={{ scrollbarGutter: 'stable' }} data-configurator-scroll>

          {/* Pipe Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-500 lowercase">pipe</label>
            <Select
              value={selectedWorkflowId ? String(selectedWorkflowId) : undefined}
              onValueChange={setSelectedWorkflowId}
            >
              <SelectTrigger>
                <SelectValue placeholder="select a pipe...">
                  {workflows.find(w => String(w.id) === String(selectedWorkflowId))?.name || "select a pipe..."}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-[300px] overflow-y-auto">
                {isLoading ? (
                  <SelectItem value="__loading" disabled>loading pipes...</SelectItem>
                ) : (workflows.length === 0 && error) ? (
                  <SelectItem value="__error" disabled>error loading: {error}</SelectItem>
                ) : workflows.length === 0 ? (
                  <SelectItem value="__empty" disabled>no pipes found</SelectItem>
                ) : (
                  workflows.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)} title={w.description || undefined}>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">{w.name}</span>
                        <span className="text-[11px] text-slate-500 line-clamp-2">{w.description || "No description"}</span>
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Connection Warning */}
          {engineOffline && (
            <Alert variant="destructive">
              <AlertTitle>comfyui not connected</AlertTitle>
              <AlertDescription>
                {selectedEngineHealth?.last_error || "we could not reach the configured comfyui host."}
              </AlertDescription>
            </Alert>
          )}



          {/* Global Error Alert */}
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>error</AlertTitle>
              <AlertDescription className="break-words text-xs font-mono">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {/* Dynamic Form ... */}
          {selectedWorkflow && (
            <DynamicForm
              schema={visibleSchema ?? {}}
              onSubmit={handleGenerate}
              nodeOrder={nodeOrder}
              isLoading={isBusy}
              submitLabel="generate"
              onChange={handleFormChange}
              onFieldFocus={setFocusedField}
              activeField={focusedField}
              submitDisabled={engineOffline}
              engineId={selectedEngineId}
              onReset={handleResetDefaults}
              snippets={library}
              projectSlug={selectedProject?.slug}
              destinationFolder={generationTarget || undefined}
              externalValueSyncKey={externalValueSyncKey}
            />
          )}
        </div>

        {/* Progress Status Footer */}
        {lastJobId && isBusy && (
          <div className="flex-none p-4 border-t bg-slate-50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-blue-600 capitalize">{statusLabel || (generationState === "queued" ? "queued" : "processing")}</span>
              <span className="text-xs text-slate-500">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-1 mb-2" />
            <Button variant="ghost" size="sm" onClick={handleCancel} className="w-full text-red-500 h-6 text-xs hover:text-red-600 hover:bg-red-50">
              cancel job
            </Button>
          </div>
        )}

      </div>

      {/* 3. Center Preview with Navigation and Auto-Discard */}
      <div className="flex-1 overflow-hidden relative bg-slate-50 flex flex-col">
        <ErrorBoundary>
          <ImageViewer
            images={projectGalleryImages.length > 0
              ? projectGalleryImages.map(fi => ({ id: -1, job_id: -1, path: fi.path, filename: fi.filename, created_at: '' } as ApiImage))
              : galleryImages.map(gi => gi.image)
            }
            galleryItems={galleryImages}
            metadata={previewMetadata}
            selectedImagePath={previewPath || undefined}
            workflows={workflows}
            onSelectWorkflow={handleWorkflowSelect}
            onUseInPipe={handleUseInPipe}
            onImageUpdate={(updatedCalc) => {
              setGalleryImages(prev => prev.map(item =>
                item.image.id === updatedCalc.id ? { ...item, image: updatedCalc } : item
              ));
            }}
            onDelete={(id) => handleGalleryDelete(id)}
            onRegenerate={handleRegenerate}
            resetKey={galleryRefresh}
          />
        </ErrorBoundary>
      </div>

      {/* 4. Project Gallery (Right Side) */}
      <ProjectGallery
        projects={projects}
        workflows={workflows}
        onRegenerate={handleRegenerate}
        onUseInPipe={handleUseInPipe}
        externalSelection={canvasGallerySelection || undefined}
        externalSelectionKey={canvasGallerySyncKey}
        onSelectImage={(imagePath, pgImages) => {
          // Show clicked image in the viewer and use ProjectGallery's images for navigation
          setPreviewPath(`/api/v1/gallery/image/path?path=${encodeURIComponent(imagePath)}`);
          setProjectGalleryImages(pgImages);
          setPreviewMetadata(null); // Clear old metadata, will be fetched by ImageViewer
        }}
      />

      {/* Floating panels are now rendered globally in Layout.tsx */}

      <InstallStatusDialog
        open={installOpen}
        onOpenChange={(open) => {
          setInstallOpen(open);
          if (!open && pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        }}
        status={installStatus}
        onReboot={handleReboot}
        allowManualClone={allowManualClone}
        onAllowManualCloneChange={setAllowManualClone}
      />

    </div >
  );
}
