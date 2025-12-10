import { useEffect, useState, useRef } from "react";
import { api, Engine, WorkflowTemplate, FileItem, GalleryItem, PromptLibraryItem, EngineHealth, Project } from "@/lib/api";
import { DynamicForm } from "@/components/DynamicForm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, GripHorizontal } from "lucide-react";
import { RunningGallery } from "@/components/RunningGallery";
import { FileExplorer } from "@/components/FileExplorer";
import { ImageViewer } from "@/components/ImageViewer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { InstallStatusDialog, InstallStatus } from "@/components/InstallStatusDialog";
import { PromptConstructor } from "@/components/PromptConstructor";
import { DraggablePanel } from "@/components/ui/draggable-panel";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useUndoRedo } from "@/lib/undoRedo";
import { GenerationFeed, GenerationFeedItem } from "@/components/GenerationFeed";
import { PromptLibraryQuickPanel } from "@/components/PromptLibraryQuickPanel";

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

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastJobId, setLastJobId] = useState<number | null>(null);
  const lastSubmittedParamsRef = useRef<any>(null); // Track params for preview
  const [jobStatus, setJobStatus] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);


  // Selection State
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewMetadata, setPreviewMetadata] = useState<any>(null);

  // Form Data State
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [formData, setFormData] = useState<any>({});
  const [focusedField, setFocusedField] = useState<string>("");

  const [generationFeed, setGenerationFeed] = useState<GenerationFeedItem[]>([]);

  // Prompt Library State
  const [prompts, setPrompts] = useState<PromptLibraryItem[]>([]);
  const [promptSearch, setPromptSearch] = useState("");
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


  const [previewPanelOpen, setPreviewPanelOpen] = useState(true);
  const [promptPanelOpen, setPromptPanelOpen] = useState(true);

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

  const projectPaths = (selectedProject?.config_json || {}) as { input_dir?: string; output_dir?: string; mask_dir?: string };

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
      const key = `workflow_form_${selectedWorkflow.id}`;

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
    setFormData(data);
    if (selectedWorkflowId) {
      localStorage.setItem(`workflow_form_${selectedWorkflowId}`, JSON.stringify(data));
    }
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

  const loadPromptLibrary = async (query?: string) => {
    if (!selectedWorkflowId) return;
    setPromptLoading(true);
    setPromptError(null);
    try {
      const data = await api.getPrompts(query, parseInt(selectedWorkflowId));
      setPrompts(data);
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
      setPrompts([]);
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

  const trackFeedStart = (jobId: number) => {
    setGenerationFeed((prev) => [
      {
        jobId,
        status: "queued",
        progress: 0,
        previewPath: null,
        startedAt: new Date().toISOString(),
      },
      ...prev.filter((item) => item.jobId !== jobId),
    ].slice(0, 8));
  };

  const updateFeed = (jobId: number, updates: Partial<GenerationFeedItem>) => {
    setGenerationFeed((prev) =>
      prev.map((item) => (item.jobId === jobId ? { ...item, ...updates } : item))
    );
  };

  const applyPrompt = (prompt: PromptLibraryItem) => {
    const params = prompt.job_params || {};
    handleFormChange(params);
    setFocusedField("");

    if (prompt.preview_path) {
      setPreviewPath(prompt.preview_path);
      setPreviewMetadata({
        prompt: prompt.active_positive,
        created_at: prompt.created_at,
      });
    }
  };






  useEffect(() => {
    if (!lastJobId) return;

    setJobStatus("initiating");
    setProgress(0);


    const ws = new WebSocket(`ws://127.0.0.1:8000/api/v1/jobs/${lastJobId}/ws`);

    ws.onopen = () => {
      console.log("Connected to job stream", lastJobId);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "status") {
        setJobStatus(data.status);
        updateFeed(lastJobId, { status: data.status });
      } else if (data.type === "progress") {
        const { value, max } = data.data;
        setProgress((value / max) * 100);
        updateFeed(lastJobId, { progress: (value / max) * 100, status: "processing" });
      } else if (data.type === "executing") {
        setJobStatus("processing");
        updateFeed(lastJobId, { status: "processing" });
      } else if (data.type === "completed") {
        setJobStatus("completed");
        setProgress(100);


        if (data.images && data.images.length > 0) {
          updateFeed(lastJobId, {
            status: "completed",
            progress: 100,
            previewPath: data.images[0].path,
          });
        } else {
          updateFeed(lastJobId, { status: "completed", progress: 100 });
        }

        if (data.images && data.images.length > 0) {
          setPreviewPath(data.images[0].path);

          // Try to find the main prompt
          const params = lastSubmittedParamsRef.current || {};
          // Heuristic: finding the longest string or specific keys
          const potentialPromptKeys = ["positive", "positive_prompt", "prompt", "text", "undefined"];
          let mainPrompt = "Generated Image";

          for (const key of potentialPromptKeys) {
            if (params[key] && typeof params[key] === 'string' && params[key].length > 0) {
              mainPrompt = params[key];
              break;
            }
          }
          // Fallback: Use the first long string found
          if (mainPrompt === "Generated Image") {
            const longString = Object.values(params).find(v => typeof v === 'string' && v.length > 20);
            if (longString) mainPrompt = String(longString);
          }

          setPreviewMetadata({
            prompt: mainPrompt,
            created_at: new Date().toISOString(),
            job_params: params
          });
        }
        setGalleryRefresh(prev => prev + 1);
      } else if (data.type === "preview") {
        // Live Preview from KSampler
        updateFeed(lastJobId, { previewBlob: data.data.blob });
      } else if (data.type === "error") {
        setJobStatus("failed");
        setError(data.message);
        updateFeed(lastJobId, { status: "failed" });
      }
    };

    return () => {
      ws.close();
    };
  }, [lastJobId]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [enginesData, workflowsData, projectsData] = await Promise.all([
          api.getEngines(),
          api.getWorkflows(),
          api.getProjects(),
        ]);
        setEngines(enginesData);
        setWorkflows(workflowsData);
        setProjects(projectsData);

        if (!selectedEngineId && enginesData.length > 0) setSelectedEngineId(String(enginesData[0].id));
        if (!selectedWorkflowId && workflowsData.length > 0) setSelectedWorkflowId(String(workflowsData[0].id));
      } catch (err) {
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
    healthIntervalRef.current = setInterval(pollHealth, 5000);

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
      const job = await api.createJob(
        parseInt(selectedEngineId),
        parseInt(selectedWorkflowId),
        selectedProjectId ? parseInt(selectedProjectId) : null,
        data
      );
      if (!selectedProjectId) {
        setUnsavedJobIds((prev) => (prev.includes(job.id) ? prev : [...prev, job.id]));
      }
      lastSubmittedParamsRef.current = data; // Persist for preview
      setLastJobId(job.id);
      trackFeedStart(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create job");
    } finally {
      setIsSubmitting(false);
    }
  };

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
    setPreviewPath(file.path);
    setPreviewMetadata({
      created_at: null // External file
    });
  };

  const handleGallerySelect = (item: GalleryItem) => {
    setPreviewPath(item.image.path);
    setPreviewMetadata({
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
            const key = `workflow_form_${workflowId}`;
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
            <FileExplorer engineId={selectedEngineId} onFileSelect={handleFileSelect} />
          </Panel>

          <PanelResizeHandle className="h-2 bg-slate-100 hover:bg-slate-200 transition-colors flex items-center justify-center cursor-row-resize border-y border-slate-200">
            <GripHorizontal size={14} className="text-slate-400" />
          </PanelResizeHandle>

          <Panel defaultSize={60} minSize={20}>
            {selectedWorkflow ? (
              <PromptConstructor
                schema={selectedWorkflow.input_schema}
                currentValues={formData}
                onUpdate={handlePromptUpdate}
                targetField={focusedField}
                onTargetChange={setFocusedField} // Allows "Select" internally if we want, but better to clear
                onFinish={() => setFocusedField("")} // Explicitly clear focus on "Finish"
              />
            ) : (
              <div className="p-4 text-xs text-slate-400">select a pipe to use prompt constructor</div>
            )}
          </Panel>
        </PanelGroup>
      </div>

      {/* 2. Configuration (Left) */}
      <div className="w-[340px] flex-none bg-white border-r overflow-y-auto p-4 flex flex-col gap-4" style={{ scrollbarGutter: 'stable' }}>
        <div>
          <div className="flex items-start justify-between mb-4">
            <h2 className="text-lg font-bold">Configuration</h2>
            <div className="flex flex-col gap-1.5">
              <Button
                variant="outline"
                className="h-6 text-[10px] px-2 w-24 justify-between"
                onClick={() => setPreviewPanelOpen(!previewPanelOpen)}
              >
                <span>Feed</span>
                <span className="text-slate-500">{previewPanelOpen ? "Hide" : "Show"}</span>
              </Button>
              <Button
                variant="outline"
                className="h-6 text-[10px] px-2 w-24 justify-between"
                onClick={() => setPromptPanelOpen(!promptPanelOpen)}
              >
                <span>Library</span>
                <span className="text-slate-500">{promptPanelOpen ? "Hide" : "Show"}</span>
              </Button>
            </div>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Project</label>
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
                <SelectTrigger>
                  <SelectValue placeholder="Select project">
                    {selectedProject?.name || "No project (draft mode)"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project (draft mode)</SelectItem>
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
              <div className="bg-slate-50 border rounded-md p-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">Active project scope</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={() => setGalleryScopeAll((prev) => !prev)}
                  >
                    {galleryScopeAll ? "View project" : "View all"}
                  </Button>
                </div>
                <p className="text-slate-600">
                  {galleryScopeAll
                    ? "Gallery shows images from every project."
                    : selectedProject
                      ? `Generation and gallery are scoped to ${selectedProject.name}.`
                      : "Generating in draft mode. Attach these to a project when you're ready."}
                </p>
                <div className="grid grid-cols-1 gap-1 text-slate-600">
                  <span>Inputs: {projectPaths.input_dir || "project/input"}</span>
                  <span>Outputs: {projectPaths.output_dir || "project/output"}</span>
                  <span>Masks: {projectPaths.mask_dir || "project/masks"}</span>
                </div>
                <div className="flex items-center justify-between pt-2">
                  {selectedProjectId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px] text-slate-700"
                      onClick={() => setSelectedProjectId(null)}
                    >
                      Close project
                    </Button>
                  )}
                </div>
              </div>
              {unsavedJobIds.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs space-y-2">
                  <div className="font-semibold text-amber-800">
                    {unsavedJobIds.length} generation{unsavedJobIds.length === 1 ? "" : "s"} are in draft mode.
                  </div>
                  <p className="text-amber-900">
                    Create a project to adopt these generations, or attach them to a selected project.
                  </p>
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <Input
                        placeholder="New project name"
                        value={projectDraftName}
                        onChange={(e) => setProjectDraftName(e.target.value)}
                        className="h-8 text-xs"
                      />
                      <Button
                        size="sm"
                        className="h-8 text-xs"
                        onClick={handleCreateProjectFromDrafts}
                        disabled={isCreatingProject}
                      >
                        {isCreatingProject ? "Saving..." : "Create & attach"}
                      </Button>
                    </div>
                    {selectedProjectId && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => adoptDraftsIntoProject(parseInt(selectedProjectId))}
                      >
                        Attach drafts to {selectedProject?.name}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Engine</label>
              <Select value={selectedEngineId} onValueChange={setSelectedEngineId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Engine">
                    {engines.find(e => String(e.id) === selectedEngineId)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {engines.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">pipe</label>
              <Select value={selectedWorkflowId} onValueChange={setSelectedWorkflowId}>
                <SelectTrigger>
                  <SelectValue placeholder="select pipe">
                    {workflows.find(w => String(w.id) === selectedWorkflowId)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {workflows.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {
              selectedWorkflow?.description?.includes("[Missing Nodes:") && (
                <Alert className="border-amber-500 bg-amber-50">
                  <AlertTitle className="text-amber-800">missing nodes detected</AlertTitle>
                  <AlertDescription className="text-amber-700 text-xs">
                    this pipe requires custom nodes that are not installed.
                    <br />
                    <span className="font-mono mt-1 block mb-2">
                      {selectedWorkflow.description.match(/\[Missing Nodes: (.*?)\]/)?.[1]}
                    </span>
                    <Button
                      size="sm"
                      variant="default"
                      className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                      onClick={() => {
                        const match = selectedWorkflow.description.match(/\[Missing Nodes: (.*?)\]/);
                        if (match) {
                          const nodes = match[1].split(",").map(s => s.trim());
                          startInstall(nodes);
                        }
                      }}
                    >
                      install missing nodes
                    </Button>
                  </AlertDescription>
                </Alert>
              )
            }
          </div >
        </div >

        {engineOffline && (
          <Alert variant="destructive" className="bg-red-50">
            <AlertTitle>ComfyUI connection lost</AlertTitle>
            <AlertDescription>
              {selectedEngineHealth?.last_error || "We could not reach the configured ComfyUI host."}
              {selectedEngineHealth?.next_check_in !== undefined && (
                <div className="text-xs mt-2 text-red-800">
                  Next automatic retry in {selectedEngineHealth.next_check_in} seconds.
                </div>
              )}
            </AlertDescription>
          </Alert>
        )
        }

        {
          error && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )
        }

        <div className="flex-1">
          {selectedWorkflow ? (
            <DynamicForm
              schema={selectedWorkflow.input_schema}
              onSubmit={handleGenerate}
              isLoading={isSubmitting}
              engineId={selectedEngineId}
              submitDisabled={engineOffline}
              submitLabel="Generate"
              formData={formData}
              onChange={handleFormChange}
              onFieldFocus={setFocusedField}
              activeField={focusedField}
            />
          ) : (
            <div className="text-center py-8 text-slate-400 text-sm">
              {workflows.length === 0 ? "no pipes found." : "select pipe"}
            </div>
          )}
        </div>

        {/* Progress Status */}
        {
          lastJobId && jobStatus !== "completed" && jobStatus !== "failed" && jobStatus && (
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-blue-600 capitalize">{jobStatus}</span>
                <span className="text-xs text-slate-500">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-1 mb-2" />
              <Button variant="ghost" size="sm" onClick={handleCancel} className="w-full text-red-500 h-6 text-xs hover:text-red-600">
                Cancel Job
              </Button>
            </div>
          )
        }
      </div>

      {/* 3. Center Preview with Navigation and Auto-Discard */}
      <div className="flex-1 overflow-hidden relative bg-slate-50 flex flex-col">
        <ErrorBoundary>
          <ImageViewer
            images={galleryImages.map(gi => gi.image)}
            metadata={previewMetadata}
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

      {/* 4. Draggable Panels Area (Feed & Library) & Running Gallery Override */}
      {/* 4. Draggable Panels Area */}
      <DraggablePanel
        persistenceKey="ds_feed_pos"
        defaultPosition={{ x: 20, y: 100 }}
        className={`bg-white border-l shadow-xl z-20 w-[320px] h-[80vh] ${previewPanelOpen ? "" : "hidden"}`}
      >
        <div className="flex-none border-b flex flex-col bg-white h-auto max-h-[40%]">
          <div className="p-2 bg-slate-100 border-b text-xs font-semibold">Generation Feed</div>
          <div className="overflow-hidden">
            <GenerationFeed items={generationFeed} onSelectPreview={(path) => setPreviewPath(path)} />
          </div>
        </div>

        <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
          <RunningGallery
            images={galleryImages}
            selectedIds={selectedGalleryIds}
            onSelectionChange={setSelectedGalleryIds}
            onRefresh={loadGallery}
            onDelete={handleGalleryDelete}
            onLoadParams={(item) => {
              if (item.job_params) setFormData((prev: any) => ({ ...prev, ...item.job_params }));
            }}
            onPreview={(item) => setPreviewPath(item.image.path)}
          />
        </div>
      </DraggablePanel>


      <DraggablePanel
        defaultPosition={{ x: 100, y: 100 }}
        persistenceKey="ds_library_pos"
        className={`h-[600px] w-[400px] z-30 ${promptPanelOpen ? "" : "hidden"}`}
      >
        <PromptLibraryQuickPanel
          open={promptPanelOpen}
          prompts={prompts}
          onApply={applyPrompt}
          onSearchChange={handlePromptSearchChange}
          onSearchSubmit={submitPromptSearch}
          searchValue={promptSearch}
          onClose={() => setPromptPanelOpen(false)}
          loading={promptLoading}
        />
      </DraggablePanel>

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

    </div>
  );
}
