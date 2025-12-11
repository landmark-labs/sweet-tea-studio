import { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { api, Engine, WorkflowTemplate, FileItem, GalleryItem, PromptLibraryItem, EngineHealth, Project } from "@/lib/api";
import { DynamicForm } from "@/components/DynamicForm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, GripHorizontal } from "lucide-react";
import { FileExplorer } from "@/components/FileExplorer";
import { ImageViewer } from "@/components/ImageViewer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { InstallStatusDialog, InstallStatus } from "@/components/InstallStatusDialog";
import { PromptConstructor } from "@/components/PromptConstructor";
import { DraggablePanel } from "@/components/ui/draggable-panel";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useUndoRedo } from "@/lib/undoRedo";
import { GenerationFeed } from "@/components/GenerationFeed";
import { PromptLibraryQuickPanel } from "@/components/PromptLibraryQuickPanel";
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
  const [galleryScopeAll, setGalleryScopeAll] = useState(
    localStorage.getItem("ds_gallery_scope") === "all"
  );

  const location = useLocation();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastJobId, setLastJobId] = useState<number | null>(null);
  const lastSubmittedParamsRef = useRef<any>(null); // Track params for preview
  const [jobStatus, setJobStatus] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [jobStartTime, setJobStartTime] = useState<number | null>(null);


  // Selection State
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewMetadata, setPreviewMetadata] = useState<any>(null);
  const handlePreviewSelect = (path: string, metadata?: any) => {
    setPreviewPath(path);
    setPreviewMetadata(metadata ?? null);
  };

  // Form Data State
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [formData, setFormData] = useState<any>({});
  const [focusedField, setFocusedField] = useState<string>("");

  const { generationFeed, trackFeedStart, updateFeed } = useGenerationFeedStore();

  // Prompt Library State
  const { prompts, searchQuery: promptSearch, setSearchQuery: setPromptSearch, setPrompts, clearPrompts, shouldRefetch: shouldRefetchPrompts } = usePromptLibraryStore();
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  // Add a refresh key for gallery
  const [galleryRefresh, setGalleryRefresh] = useState(0);
  const [galleryImages, setGalleryImages] = useState<GalleryItem[]>([]);
  const [selectedGalleryIds, setSelectedGalleryIds] = useState<Set<number>>(new Set());
  const [unsavedJobIds, setUnsavedJobIds] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem("ds_unsaved_job_ids");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Failed to parse unsaved job ids", e);
    }
    return [];
  });
  const [projectDraftName, setProjectDraftName] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);

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
  const selectedProject = selectedProjectId ? projects.find((p) => String(p.id) === selectedProjectId) || null : null;
  const draftsProject = projects.find((p) => p.slug === "drafts");
  const selectedEngineHealth = engineHealth.find((h) => String(h.engine_id) === selectedEngineId);
  const engineOffline = Boolean(selectedEngineHealth && !selectedEngineHealth.healthy);

  const projectFolders = (selectedProject?.config_json as { folders?: string[] })?.folders || ["inputs", "output", "masks"];
  const [generationTarget, setGenerationTarget] = useState<string>("");

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
    if (selectedProject) {
      // Default to 'output' if available, else first folder
      setGenerationTarget("output");
    } else {
      setGenerationTarget("");
    }
  }, [selectedProject]);

  const previousProjectRef = useRef<string | null>(selectedProjectId);
  useEffect(() => {
    if (previousProjectRef.current && !selectedProjectId) {
      // Starting a new draft session; clear any old unsaved records
      setUnsavedJobIds([]);
    }
    previousProjectRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedWorkflow) {
      const schema = selectedWorkflow.input_schema;
      const key = `ds_pipe_params_${String(selectedWorkflow.id)}`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let initialData: any = {};
      Object.keys(schema).forEach((k) => {
        if (schema[k].default !== undefined) initialData[k] = schema[k].default;
      });
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          const parsed = JSON.parse(saved);
          initialData = { ...initialData, ...parsed };
        }
      } catch (e) { /* ignore */ }
      setFormData(initialData);
    }
  }, [selectedWorkflowId, workflows]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { registerStateChange } = useUndoRedo();

  const persistForm = (data: any) => {
    // Safety: Don't persist if checkpoint got wiped (common init race condition)
    if (data['CheckpointLoaderSimple.ckpt_name'] === "" && formData['CheckpointLoaderSimple.ckpt_name']) {
      console.warn("[SafeGuard] Prevented overwriting checkpoint with empty string");
      // Keep the old checkpoint value
      data['CheckpointLoaderSimple.ckpt_name'] = formData['CheckpointLoaderSimple.ckpt_name'];
    }

    setFormData(data);
    if (selectedWorkflowId) {
      localStorage.setItem(`ds_pipe_params_${selectedWorkflowId}`, JSON.stringify(data));
    }
  };

  const handleResetDefaults = () => {
    if (!selectedWorkflow) return;
    const schema = selectedWorkflow.input_schema;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let defaults: any = {};
    Object.keys(schema).forEach((k) => {
      if (schema[k].default !== undefined) defaults[k] = schema[k].default;
    });

    // Clear persistence
    localStorage.removeItem(`ds_pipe_params_${selectedWorkflow.id}`);

    // Update state 
    persistForm(defaults);
    setFocusedField("");
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleFormChange = (newData: any) => {
    const previous = formData;
    persistForm(newData);
    registerStateChange("Form updated", previous, newData, persistForm);
  };

  const handlePromptUpdate = (field: string, value: string) => {
    handleFormChange({ ...formData, [field]: value });
  };

  useEffect(() => {
    const state = location.state as { loadParams?: GalleryItem } | null;
    if (!state?.loadParams) return;

    const { loadParams } = state;

    if (loadParams.workflow_template_id) {
      setSelectedWorkflowId(String(loadParams.workflow_template_id));
    }

    if (loadParams.project_id !== undefined) {
      setSelectedProjectId(loadParams.project_id ? String(loadParams.project_id) : null);
    }

    if (loadParams.job_params) {
      handleFormChange(loadParams.job_params);
    }

    setPreviewPath(`/api/v1/gallery/image/path?path=${encodeURIComponent(loadParams.image.path)}`);
    setPreviewMetadata({
      prompt: loadParams.prompt || loadParams.job_params?.prompt,
      negative_prompt: loadParams.negative_prompt || loadParams.job_params?.negative_prompt,
      caption: loadParams.caption,
      created_at: loadParams.created_at,
    });

    navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, navigate, location.pathname]);

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

  const adoptDraftsIntoProject = async (projectId: number, jobIds: number[] = unsavedJobIds) => {
    if (jobIds.length === 0) return;
    try {
      await api.adoptJobsIntoProject(projectId, jobIds);
      setUnsavedJobIds((prev) => prev.filter((id) => !jobIds.includes(id)));
      setGalleryRefresh((prev) => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move drafts into project");
    }
  };

  const handleCreateProjectFromDrafts = async () => {
    if (!projectDraftName.trim()) {
      setError("Project name is required to capture your drafts.");
      return;
    }

    setIsCreatingProject(true);
    try {
      const project = await api.createProject({ name: projectDraftName.trim() });
      setProjects((prev) => [project, ...prev]);
      if (unsavedJobIds.length > 0) {
        await adoptDraftsIntoProject(project.id, unsavedJobIds);
      }
      setSelectedProjectId(String(project.id));
      setProjectDraftName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setIsCreatingProject(false);
    }
  };

  const applyPrompt = (prompt: PromptLibraryItem) => {
    const params = prompt.job_params || {};
    handleFormChange(params);
    setFocusedField("");

    if (prompt.preview_path) {
      handlePreviewSelect(prompt.preview_path, {
        prompt: prompt.active_positive,
        created_at: prompt.created_at,
      });
    }
  };






  // On mount, check if we have a running job in the feed and restore lastJobId to resume WS
  useEffect(() => {
    // We only want to do this ONCE on mount
    if (lastJobId) return;

    const active = generationFeed[0];
    if (active && (active.status === "queued" || active.status === "processing" || active.status === "initiating")) {
      console.log("Resuming WebSocket for job", active.jobId);
      setLastJobId(active.jobId);
      setJobStatus(active.status);
      setProgress(active.progress);
    }
  }, []); // Empty dependency array intentionally to run only on mount

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!lastJobId) return;

    // Close previous WebSocket if exists
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      wsRef.current.close();
    }

    setJobStatus(prev => prev || "initiating");
    setProgress(prev => prev > 0 ? prev : 0);
    if (!jobStartTime) setJobStartTime(Date.now());

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsApiPath = window.location.pathname.startsWith('/studio') ? '/sts-api/api/v1' : '/api/v1';
    const wsUrl = `${wsProtocol}//${window.location.host}${wsApiPath}/jobs/${lastJobId}/ws`;
    console.log(`[WS] Connecting to: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`[WS] Connected to job ${lastJobId}`);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log(`[WS] Message received:`, data.type);

      if (data.type === "status") {
        setJobStatus(data.status);
        updateFeed(lastJobId, { status: data.status });
      } else if (data.type === "progress") {
        const { value, max } = data.data;
        const pct = (value / max) * 100;
        setProgress(pct);
        updateFeed(lastJobId, { progress: pct, status: "processing" });
      } else if (data.type === "executing") {
        setJobStatus("processing");
        updateFeed(lastJobId, { status: "processing" });
      } else if (data.type === "completed") {
        setJobStatus("completed");
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
      } else if (data.type === "preview") {
        // Live Preview from KSampler
        console.log("[Preview] Received preview blob:", data.data.blob?.substring(0, 50) + "...", "length:", data.data.blob?.length);
        updateFeed(lastJobId, { previewBlob: data.data.blob });
      } else if (data.type === "error") {
        setJobStatus("failed");
        setError(data.message);
        updateFeed(lastJobId, { status: "failed" });
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
            setJobStatus("completed");
            setProgress(100);
            setGalleryRefresh(prev => prev + 1);
          } else if (job.status === "failed" || job.status === "cancelled") {
            setJobStatus(job.status);
            setError(job.error || "Job failed");
            updateFeed(lastJobId, { status: job.status });
          } else {
            // Job might still be running, poll again
            setError("Connection lost - checking status...");
          }
        } catch (e) {
          console.error("Failed to check job status:", e);
          setError("Connection lost during generation");
          setJobStatus("failed");
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
        if (!selectedWorkflowId || isSubmitting || engineOffline || jobStatus === "initiating") return;
        handleGenerate(formData);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedWorkflowId, isSubmitting, engineOffline, jobStatus, formData]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [enginesRes, workflowsRes, projectsRes] = await Promise.allSettled([
          api.getEngines(),
          api.getWorkflows(),
          api.getProjects(),
        ]);

        if (enginesRes.status === "fulfilled") {
          const enginesData = enginesRes.value;
          setEngines(enginesData);
          if (!selectedEngineId && enginesData.length > 0) setSelectedEngineId(String(enginesData[0].id));
        } else {
          console.error("Failed to load engines", enginesRes.reason);
        }

        if (workflowsRes.status === "fulfilled") {
          const workflowsData = workflowsRes.value;
          setWorkflows(workflowsData);
          if (!selectedWorkflowId && workflowsData.length > 0) setSelectedWorkflowId(String(workflowsData[0].id));
        } else {
          console.error("Failed to load workflows", workflowsRes.reason);
          // If workflows specifically fail, we could set a workflowError state, 
          // but for now relying on the empty list fallback or global error if everything fails.
          // Setting the global error would hide successful engines, so better to log and maybe show toast.
          // The dropdown will show "no pipes found" which is acceptable fallback.
        }

        if (projectsRes.status === "fulfilled") {
          setProjects(projectsRes.value);
        } else {
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
    pollHealth();
    healthIntervalRef.current = setInterval(pollHealth, 2500);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (healthIntervalRef.current) clearInterval(healthIntervalRef.current);
    };
  }, []);

  // --- Install Logic ---
  const startInstall = async (missing: string[]) => {
    setInstallOpen(true);
    setInstallStatus({ status: "pending", progress_text: "Initializing..." });
    try {
      const res = await api.installMissingNodes(missing, allowManualClone);
      startPolling(res.job_id);
    } catch (err) {
      setInstallStatus({ status: "failed", error: `Start failed: ${(err as Error).message}`, progress_text: "" });
    }
  };

  const startPolling = (jobId: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const status = await api.getInstallStatus(jobId);
        setInstallStatus(status);
        if (status.status === "completed" || status.status === "failed") {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        }
      } catch (err) {
        console.error("Poll error", err);
      }
    }, 1000);
  };

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

    setIsSubmitting(true);
    setError(null);
    try {
      // Filter params to only include those in the current schema
      // This prevents "pollution" from previous workflows or uncleaned state
      // Filter params to only include those in the current schema AND not bypassed
      // This prevents "pollution" from previous workflows or bypassed nodes
      const schema = selectedWorkflow.input_schema || {};

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
      lastSubmittedParamsRef.current = cleanParams; // Persist for preview
      setLastJobId(job.id);
      trackFeedStart(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delegate to Context for Global Header button
  const generation = useGeneration();
  const handleGenerateRef = useRef(handleGenerate);
  handleGenerateRef.current = handleGenerate;
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

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
      setJobStatus("cancelled");
    } catch (err) {
      console.error("Failed to cancel", err);
    }
  };

  const handleFileSelect = (file: FileItem) => {
    handlePreviewSelect(file.path, {
      created_at: null // External file
    });
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

      {/* 1. Left Column (Split: Explorer / Constructor) */}
      <div className="w-[480px] flex-none bg-white border-r hidden xl:block overflow-hidden">
        <PanelGroup direction="vertical">
          <Panel defaultSize={40} minSize={20}>
            <FileExplorer engineId={selectedEngineId} projectId={selectedProjectId || undefined} projectName={selectedProject?.name} onFileSelect={handleFileSelect} />
          </Panel>

          <PanelResizeHandle className="h-2 bg-slate-100 hover:bg-slate-200 transition-colors flex items-center justify-center cursor-row-resize border-y border-slate-200">
            <GripHorizontal size={14} className="text-slate-400" />
          </PanelResizeHandle>

          <Panel defaultSize={60} minSize={20}>
            {selectedWorkflow ? (
              <PromptConstructor
                // Filter out hidden parameters if the new editor logic flagged them
                schema={
                  Object.fromEntries(
                    Object.entries(selectedWorkflow.input_schema).filter(([_, val]: [string, any]) => !val.__hidden)
                  )
                }
                currentValues={formData}
                onUpdate={handlePromptUpdate}
                targetField={focusedField}
                onTargetChange={setFocusedField}
                onFinish={() => setFocusedField("")}
              />
            ) : (
              <div className="p-4 text-xs text-slate-400">select a prompt pipe to use the constructor</div>
            )}
          </Panel>
        </PanelGroup>
      </div>

      {/* 2. Configuration (Left) - NEW LAYOUT */}
      <div className="w-[340px] flex-none bg-blue-50 border-r border-blue-100 flex flex-col h-full overflow-hidden">

        {/* Sticky Header Section */}
        <div className="flex-none p-4 space-y-4 border-b bg-slate-50/50 backdrop-blur z-10">
          <div className="text-xs font-bold text-slate-800 tracking-wider">CONFIGURATOR</div>

          {/* Project Selection */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 lowercase tracking-wider">project</label>
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
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select project">
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

            {/* Target / Description */}
            <div className="text-[10px] text-slate-500 px-1">
              {selectedProject
                ? `Saving to: ${generationTarget ? "/" + generationTarget : "Default"}`
                : "Generations will be temporary drafts."}
            </div>
          </div>

          {/* Destination Selector (Mini) */}
          {selectedProjectId && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 lowercase tracking-wider">destination</label>
              <Select
                value={generationTarget || "engine-default"}
                onValueChange={(value) => setGenerationTarget(value === "engine-default" ? "" : value)}
              >
                <SelectTrigger className="h-7 text-[10px]">
                  <SelectValue placeholder="Output Folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="engine-default">Engine default output</SelectItem>
                  {projectFolders.map((folder) => (
                    <SelectItem key={folder} value={folder}>
                      /{folder}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* GENERATE BUTTON */}
          <div className="pt-2">
            <Button
              size="lg"
              className="w-full relative overflow-hidden transition-all active:scale-[0.98] shadow-sm hover:shadow-md"
              disabled={!selectedWorkflowId || isSubmitting || engineOffline || jobStatus === "initiating"}
              onClick={() => handleGenerate(formData)}
              style={{
                background: (jobStatus === "processing" || jobStatus === "initiating")
                  ? `linear-gradient(90deg, #3b82f6 ${progress}%, #1e40af ${progress}%)`
                  : undefined
              }}
            >
              <div className="relative z-10 flex items-center justify-center gap-2">
                {isSubmitting || jobStatus === "initiating" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>queuing...</span>
                  </>
                ) : jobStatus === "processing" ? (
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
              <AlertTitle>ComfyUI not connected</AlertTitle>
              <AlertDescription>
                {selectedEngineHealth?.last_error || "We could not reach the configured ComfyUI host."}
              </AlertDescription>
            </Alert>
          )}



          {/* Global Error Alert */}
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription className="break-words text-xs font-mono">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {/* Dynamic Form ... */}
          {selectedWorkflow && (
            <DynamicForm
              schema={selectedWorkflow.input_schema}
              onSubmit={handleGenerate}
              isLoading={isSubmitting || jobStatus === "initiating" || jobStatus === "processing"}
              submitLabel="generate"
              formData={formData}
              onChange={handleFormChange}
              onFieldFocus={setFocusedField}
              activeField={focusedField}
              submitDisabled={engineOffline}
              engineId={selectedEngineId}
              onReset={handleResetDefaults}
            />
          )}
        </div>

        {/* Progress Status Footer */}
        {lastJobId && jobStatus !== "completed" && jobStatus !== "failed" && jobStatus && (
          <div className="flex-none p-4 border-t bg-slate-50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-blue-600 capitalize">{jobStatus}</span>
              <span className="text-xs text-slate-500">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-1 mb-2" />
            <Button variant="ghost" size="sm" onClick={handleCancel} className="w-full text-red-500 h-6 text-xs hover:text-red-600 hover:bg-red-50">
              Cancel Job
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
