import { useEffect, useState, useRef, useMemo } from "react";
import { addProgressEntry, calculateProgressStats, mapStatusToGenerationState, type GenerationState, type ProgressHistoryEntry } from "@/lib/generationState";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { api, Engine, WorkflowTemplate, GalleryItem, EngineHealth, Project } from "@/lib/api";
import { extractPrompts, findPromptFieldsInSchema, findImageFieldsInSchema } from "@/lib/promptUtils";
import { DynamicForm } from "@/components/DynamicForm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

import { ImageViewer } from "@/components/ImageViewer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { InstallStatusDialog, InstallStatus } from "@/components/InstallStatusDialog";
import { PromptConstructor, COLORS } from "@/components/PromptConstructor";
import { PromptItem } from "@/lib/types";

import { useUndoRedo } from "@/lib/undoRedo";
import { ProjectGallery } from "@/components/ProjectGallery";
import { useGenerationFeedStore, usePromptLibraryStore } from "@/lib/stores/promptDataStore";
import { useGeneration } from "@/lib/GenerationContext";

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


  // Selection State
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewMetadata, setPreviewMetadata] = useState<any>(null);
  // Pending loadParams - holds the gallery item to inject until workflows are loaded
  const [pendingLoadParams, setPendingLoadParams] = useState<GalleryItem | null>(null);
  const handlePreviewSelect = (path: string, metadata?: any) => {
    setPreviewPath(path);
    setPreviewMetadata(metadata ?? null);
  };

  // Form Data State
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [formData, setFormData] = useState<any>({});
  const [focusedField, setFocusedField] = useState<string>("");
  const formDataRef = useRef<any>({});
  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);
  const initializedWorkflowsRef = useRef<Set<string>>(new Set());

  const { generationFeed, trackFeedStart, updateFeed } = useGenerationFeedStore();

  // Prompt Library State
  const { setPrompts, clearPrompts, shouldRefetch: shouldRefetchPrompts } = usePromptLibraryStore();
  const [, setPromptLoading] = useState(false);
  const [, setPromptError] = useState<string | null>(null);
  const [promptSearch, setPromptSearch] = useState("");

  // Add a refresh key for gallery
  const [galleryRefresh, setGalleryRefresh] = useState(0);
  const [galleryImages, setGalleryImages] = useState<GalleryItem[]>([]);
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
  const persistTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingPersistRef = useRef<{ workflowId: string; data: any } | null>(null);

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
      }
    }, 1000);

    return () => {
      if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
    };
  }, [library, snippetsLoaded]);

  const loadGallery = async () => {
    try {
      const projectFilter = galleryScopeAll || !selectedProjectId ? null : parseInt(selectedProjectId);
      const unassignedOnly = galleryScopeAll ? false : !selectedProjectId;
      const allImages = await api.getGallery(undefined, undefined, projectFilter, unassignedOnly);
      setGalleryImages(allImages.slice(0, 50));
    } catch (e) {
      console.error("Failed to load gallery", e);
    }
  };

  // Initial load and refresh
  useEffect(() => {
    loadGallery();
  }, [galleryRefresh, selectedProjectId, galleryScopeAll]);

  // Handle Deletion from Gallery or Auto-Discard
  const handleGalleryDelete = async (ids: Set<number> | number) => {
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

      // API Call
      await Promise.all(
        Array.from(idsToDelete).map(id => api.deleteImage(id))
      );
    } catch (e) {
      console.error("Failed to delete images", e);
      loadGallery(); // Revert on error
    }
  };


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

  useEffect(() => {
    if (!selectedWorkflow) return;

    const schema = visibleSchema;
    const workflowKey = String(selectedWorkflow.id);
    const currentData = formDataRef.current || {};
    const hasExistingData = Object.keys(currentData).length > 0;
    const hasMissingDefaults = Object.entries(schema)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter(([key]: [string, any]) => !key.startsWith("__"))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .some(([key, field]: [string, any]) => field?.default !== undefined && currentData[key] === undefined);

    // Avoid overwriting user edits unless we are switching workflows or have new defaults to apply
    if (initializedWorkflowsRef.current.has(workflowKey) && hasExistingData && !hasMissingDefaults) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let initialData: any = {};
    Object.entries(schema).forEach(([k, field]: [string, any]) => {
      if (!k.startsWith("__") && field?.default !== undefined) {
        initialData[k] = field.default;
      }
    });
    try {
      const saved = localStorage.getItem(`ds_pipe_params_${workflowKey}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        initialData = { ...initialData, ...parsed };
      }
    } catch (e) { /* ignore */ }
    setFormData(initialData);
    initializedWorkflowsRef.current.add(workflowKey);
  }, [selectedWorkflow, visibleSchema]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { registerStateChange } = useUndoRedo();

  const flushPendingPersist = () => {
    const pending = pendingPersistRef.current;
    if (!pending) return;
    try {
      localStorage.setItem(`ds_pipe_params_${pending.workflowId}`, JSON.stringify(pending.data));
    } catch (e) {
      console.warn("Failed to persist form data", e);
    }
    pendingPersistRef.current = null;
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
  };

  const persistForm = (data: any) => {
    // Safety: Don't persist if checkpoint got wiped (common init race condition)
    Object.keys(data)
      .filter((key) => key.includes("CheckpointLoaderSimple") && key.endsWith(".ckpt_name"))
      .forEach((key) => {
        const previous = formData[key];
        if (data[key] === "" && typeof previous === "string" && previous.length > 0) {
          console.warn("[SafeGuard] Prevented overwriting checkpoint with empty string");
          data[key] = previous;
        }
      });

    setFormData(data);
    if (selectedWorkflowId) {
      const workflowId = selectedWorkflowId;
      pendingPersistRef.current = { workflowId, data };
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        const pending = pendingPersistRef.current;
        if (!pending) return;
        try {
          localStorage.setItem(`ds_pipe_params_${pending.workflowId}`, JSON.stringify(pending.data));
        } catch (e) {
          console.warn("Failed to persist form data", e);
        }
        pendingPersistRef.current = null;
        persistTimerRef.current = null;
      }, 150);
    }
  };

  useEffect(() => {
    return () => {
      flushPendingPersist();
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
      pendingHistoryRef.current = null;
    };
  }, [selectedWorkflowId]);

  // Ensure in-flight form persistence is flushed on tab close/refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      flushPendingPersist();
      if (selectedWorkflowId) {
        try {
          localStorage.setItem(`ds_pipe_params_${selectedWorkflowId}`, JSON.stringify(formData));
        } catch (e) {
          console.warn("Failed to persist form data on unload", e);
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") handleBeforeUnload();
    });
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleBeforeUnload);
    };
  }, [formData, selectedWorkflowId]);

  const handleResetDefaults = () => {
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
  };

  const pendingHistoryRef = useRef<{ prev: any; next: any } | null>(null);
  const historyTimerRef = useRef<NodeJS.Timeout | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleFormChange = (newData: any, { immediateHistory }: { immediateHistory?: boolean } = {}) => {
    const previous = formData;
    persistForm(newData);

    // Only register undo after edits settle to avoid per-keystroke snapshots
    if (immediateHistory) {
      registerStateChange("Form updated", previous, newData, persistForm);
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
      pendingHistoryRef.current = null;
      return;
    }

    pendingHistoryRef.current = { prev: previous, next: newData };
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      if (pendingHistoryRef.current) {
        registerStateChange("Form updated", pendingHistoryRef.current.prev, pendingHistoryRef.current.next, persistForm);
        pendingHistoryRef.current = null;
      }
      historyTimerRef.current = null;
    }, 350);
  };

  const handlePromptUpdate = (field: string, value: string) => {
    handleFormChange({ ...formData, [field]: value });
  };

  const handlePromptUpdateMany = (updates: Record<string, string>) => {
    if (!updates || Object.keys(updates).length === 0) return;
    handleFormChange({ ...formData, ...updates });
  };



  // Effect 1: CAPTURE loadParams immediately when navigation happens
  // This grabs the data before it can be lost and stores it in state
  useEffect(() => {
    const state = location.state as { loadParams?: GalleryItem } | null;
    if (!state?.loadParams) return;

    const { loadParams } = state;

    console.log("[LoadParams] Captured loadParams, storing for processing");

    // Store for later processing (when workflows are loaded)
    setPendingLoadParams(loadParams);

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
    const targetDefaults: Record<string, unknown> = {};
    Object.entries(schema).forEach(([k, field]: [string, any]) => {
      if (!k.startsWith("__") && field?.default !== undefined) {
        targetDefaults[k] = field.default;
      }
    });

    // STEP 2: Start with defaults (DO NOT load from localStorage - we want fresh defaults)
    const baseParams = { ...targetDefaults };

    // STEP 3: Extract prompts from source image
    const extracted = extractPrompts(loadParams.job_params);
    console.log("[LoadParams] Extracted prompts:", {
      positive: extracted.positive?.substring(0, 50) + "...",
      negative: extracted.negative?.substring(0, 50) + "..."
    });

    // STEP 4: Find prompt fields in target schema and inject
    const { positiveField, negativeField } = findPromptFieldsInSchema(schema);
    console.log("[LoadParams] Found prompt fields:", { positiveField, negativeField });

    if (extracted.positive && positiveField) {
      baseParams[positiveField] = extracted.positive;
    }
    if (extracted.negative && negativeField) {
      baseParams[negativeField] = extracted.negative;
    }

    // STEP 5: Find first image field in target schema and set up image injection
    const imageFields = findImageFieldsInSchema(schema);
    console.log("[LoadParams] Found image fields:", imageFields);

    if (imageFields.length > 0) {
      const imagePath = loadParams.image.path;
      sessionStorage.setItem("ds_pending_image_inject", JSON.stringify({
        imagePath,
        imageField: imageFields[0],
        workflowId: targetWorkflowId
      }));
    }

    // STEP 6: Persist to localStorage so workflow init effect picks it up
    try {
      localStorage.setItem(`ds_pipe_params_${targetWorkflowId}`, JSON.stringify(baseParams));
    } catch (e) {
      console.warn("Failed to persist loadParams", e);
    }

    // STEP 7: Update form state directly  
    setFormData(baseParams);

    // Clear pending - we've processed it
    setPendingLoadParams(null);
    console.log("[LoadParams] Processing complete");

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

        // Update the form with the uploaded image filename - use ref for latest formData
        const currentFormData = formDataRef.current;
        const newFormData = { ...currentFormData, [imageField]: result.filename };
        setFormData(newFormData);

        // Also persist to localStorage
        try {
          localStorage.setItem(`ds_pipe_params_${selectedWorkflowId}`, JSON.stringify(newFormData));
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
    console.log(`[WS] Connecting to: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      console.log(`[WS] Connected to job ${lastJobId}`);

      // Check if job already failed (race condition: error broadcast before WS connected)
      try {
        const job = await api.getJob(lastJobId);
        if (job.status === "failed" && job.error) {
          console.log(`[WS] Job already failed before connection: ${job.error}`);
          setGenerationState("failed");
          setStatusLabel("failed");
          setError(job.error);
          updateFeed(lastJobId, { status: "failed" });
        } else if (job.status === "completed") {
          console.log(`[WS] Job already completed before connection`);
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
      console.log(`[WS] Message received:`, data.type);

      if (data.type === "status") {
        const nextState = mapStatusToGenerationState(data.status);
        setGenerationState(nextState);
        setStatusLabel(data.status || "");
        updateFeed(lastJobId, { status: data.status });
      } else if (data.type === "progress") {
        const { value, max } = data.data;
        const pct = (value / max) * 100;
        setProgress(pct);
        setGenerationState("running");
        setStatusLabel("processing");

        // Track progress history for time estimation
        progressHistoryRef.current = addProgressEntry(progressHistoryRef.current, value);
        const stats = calculateProgressStats(
          progressHistoryRef.current,
          max,
          jobStartTime || Date.now()
        );

        updateFeed(lastJobId, {
          progress: pct,
          status: "processing",
          currentStep: value,
          totalSteps: max,
          elapsedMs: stats?.elapsedMs,
          estimatedRemainingMs: stats?.estimatedRemainingMs,
          iterationsPerSecond: stats?.iterationsPerSecond,
        });
      } else if (data.type === "execution_complete" || data.type === "generation_done") {
        // ComfyUI finished rendering - reset button immediately
        // Don't wait for image download/saving (5-7s)
        console.log(`[WS] Received ${data.type} - resetting button and clearing job state`);
        setGenerationState("completed");  // Clear status to show "generate" button
        setStatusLabel("");
        setProgress(0);    // Reset progress
        // Update feed to prevent sync effects from re-setting status
        updateFeed(lastJobId, { status: "completed", progress: 100 });
        // Note: Keep lastJobId so the 'completed' message can still update gallery
        // but the button is already reset
      } else if (data.type === "executing") {
        // Check if this is the final "executing" message with node=null (ComfyUI finished)
        if (data.data?.node === null) {
          // ComfyUI finished rendering - reset button immediately!
          console.log(`[WS] Received executing with node=null - ComfyUI done, resetting button`);
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
          });

          handlePreviewSelect(imagePath, {
            prompt: mainPrompt,
            negative_prompt: data.negative_prompt,
            created_at: new Date().toISOString(),
            job_params: params
          });
        } else {
          updateFeed(lastJobId, { status: "completed", progress: 100 });
        }
        setGalleryRefresh(prev => prev + 1);
        // Cleanup - button was already reset by generation_done
        setLastJobId(null);
      } else if (data.type === "preview") {
        // Live Preview from KSampler - THROTTLED to prevent main thread blocking
        // Large base64 blobs cause React state updates that freeze the UI (Chrome "message handler took Xms" warnings)
        const now = Date.now();
        if (now - lastPreviewUpdateRef.current < 100) {
          return; // Skip this preview, update at most every 100ms
        }
        lastPreviewUpdateRef.current = now;

        const targetJobId = data.job_id ?? lastJobId;
        if (targetJobId && data.data?.blob) {
          updateFeed(targetJobId, { previewBlob: data.data.blob });
        }
      } else if (data.type === "error") {
        setGenerationState("failed");
        setStatusLabel("failed");
        setError(data.message);
        updateFeed(lastJobId, { status: "failed" });
        // Reset button to idle on error
        setLastJobId(null);
      }
    };

    ws.onclose = (event) => {
      console.log(`[WS] Closed for job ${lastJobId}. Code: ${event.code}, Reason: ${event.reason}, Clean: ${event.wasClean}`);
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
            updateFeed(lastJobId, { status: job.status });
          } else {
            // Job might still be running, poll again
            setError("Connection lost - checking status...");
          }
        } catch (e) {
          console.error("Failed to check job status:", e);
          setError("Connection lost during generation");
          setGenerationState("failed");
          setStatusLabel("failed");
          updateFeed(lastJobId, { status: "failed" });
        }
      }, 1500);
    };

    return () => {
      // Only close if this is still the current WebSocket
      if (wsRef.current === ws) {
        console.log(`[WS] Cleanup: closing connection for job ${lastJobId}`);
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
        const activeEl = document.activeElement;
        if (activeEl?.closest('[data-snippet-editor="true"]')) {
          return;
        }

        if (!selectedWorkflowId || isBusy || engineOffline) return;
        handleGenerate(formData);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedWorkflowId, isBusy, engineOffline, formData]);

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

  useEffect(() => {
    if (!generation) return;
    const handler = async () => {
      // Use latest refs to ensure we catch current state without re-binding
      if (formDataRef.current) {
        await handleGenerateRef.current(formDataRef.current);
      }
    };
    generation.registerGenerateHandler(handler);
    return () => generation.unregisterGenerateHandler();
  }, [generation]);

  const handleCancel = async () => {
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

  const handleGallerySelect = (item: GalleryItem) => {
    handlePreviewSelect(item.image.path, {
      prompt: item.prompt,
      created_at: item.created_at,
      job_params: item.job_params
    });
  };

  const handleWorkflowSelect = async (workflowId: string, fromImagePath?: string) => {
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
          const imageFieldKey = Object.keys(targetSchema).find(key => {
            const f = targetSchema[key];
            return f.widget === "upload" || f.widget === "image_upload" || (f.title && f.title.includes("LoadImage"));
          });

          if (imageFieldKey) {
            // Use the standardized persistence key to ensure this image selection survives reloads
            const key = `ds_pipe_params_${workflowId}`;
            const currentStored = JSON.parse(localStorage.getItem(key) || "{}");
            const newData = { ...currentStored, [imageFieldKey]: uploaded.filename };
            localStorage.setItem(key, JSON.stringify(newData));
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
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-slate-100 flex overflow-hidden relative">

      {/* 1. Left Column - Prompt Constructor */}
      <div className="w-[380px] flex-none bg-white border-r hidden xl:block overflow-hidden">
        {selectedWorkflow ? (
          <PromptConstructor
            // Filter out hidden parameters if the new editor logic flagged them
            schema={
              Object.fromEntries(
                Object.entries(visibleSchema ?? {}).filter(
                  ([_, val]: [string, any]) => !val.__hidden
                )
              )
            }
            currentValues={formData}
            onUpdate={handlePromptUpdate}
            onUpdateMany={handlePromptUpdateMany}
            targetField={focusedField}
            onTargetChange={setFocusedField}
            onFinish={() => setFocusedField("")}
            snippets={library}
            onUpdateSnippets={setLibrary}
          />
        ) : (
          <div className="p-4 text-xs text-slate-400">select a prompt pipe to use the constructor</div>
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
                    {selectedProject?.name || "Draft Mode"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">draft mode (unsaved)</SelectItem>
                  {draftsProject && (
                    <SelectItem value={String(draftsProject.id)}>
                      {draftsProject.name || "Drafts"}
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

            {/* Destination Selector (Compact) */}
            {selectedProjectId && (
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

          {/* GENERATE BUTTON */}
          <div className="pt-1">
            <Button
              size="lg"
              className="w-full relative overflow-hidden transition-all active:scale-[0.98] shadow-sm hover:shadow-md"
              disabled={!selectedWorkflowId || engineOffline || isBusy}
              onClick={() => handleGenerate(formData)}
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
                        <span>{Math.round(progress)}% · ~{Math.round(remaining)}s remaining</span>
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
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6" style={{ scrollbarGutter: 'stable' }}>

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
              <SelectContent>
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
              formData={formData}
              onChange={handleFormChange}
              onFieldFocus={setFocusedField}
              activeField={focusedField}
              submitDisabled={engineOffline}
              engineId={selectedEngineId}
              onReset={handleResetDefaults}
              snippets={library}
              projectSlug={selectedProject?.slug}
              destinationFolder={generationTarget || undefined}
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
            images={galleryImages.map(gi => gi.image)}
            galleryItems={galleryImages}
            metadata={previewMetadata}
            selectedImagePath={previewPath || undefined}
            workflows={workflows}
            onSelectWorkflow={handleWorkflowSelect}
            onImageUpdate={(updatedCalc) => {
              setGalleryImages(prev => prev.map(item =>
                item.image.id === updatedCalc.id ? { ...item, image: updatedCalc } : item
              ));
            }}
            onDelete={(id) => handleGalleryDelete(id)}
          />
        </ErrorBoundary>
      </div>

      {/* 4. Project Gallery (Right Side) */}
      <ProjectGallery
        projects={projects}
        onSelectImage={(imagePath) => {
          // Show clicked image in the viewer
          setPreviewPath(`/api/v1/gallery/image/path?path=${encodeURIComponent(imagePath)}`);
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
