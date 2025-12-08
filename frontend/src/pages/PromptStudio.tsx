import { useEffect, useState, useRef } from "react";
import { api, Engine, WorkflowTemplate, FileItem, GalleryItem, Prompt } from "@/lib/api";
import { DynamicForm } from "@/components/DynamicForm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2, GripHorizontal, Save, Search, Sparkles } from "lucide-react";
import { RunningGallery } from "@/components/RunningGallery";
import { FileExplorer } from "@/components/FileExplorer";
import { ImageViewer } from "@/components/ImageViewer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { InstallStatusDialog, InstallStatus } from "@/components/InstallStatusDialog";
import { PromptConstructor } from "@/components/PromptConstructor";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Input } from "@/components/ui/input";

export default function PromptStudio() {
  const [engines, setEngines] = useState<Engine[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);

  const [selectedEngineId, setSelectedEngineId] = useState<string>(
    localStorage.getItem("ds_selected_engine") || ""
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    localStorage.getItem("ds_selected_workflow") || ""
  );

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastJobId, setLastJobId] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [jobImages, setJobImages] = useState<any[]>([]);

  // Selection State
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewMetadata, setPreviewMetadata] = useState<any>(null);

  // Form Data State
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [formData, setFormData] = useState<any>({});
  const [focusedField, setFocusedField] = useState<string>("");

  // Prompt Library State
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptSearch, setPromptSearch] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  // Vision assistance
  const [visionBusy, setVisionBusy] = useState(false);
  const [lastCaption, setLastCaption] = useState("");
  const [captionTags, setCaptionTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [tagExpansion, setTagExpansion] = useState("");

  // Add a refresh key for gallery
  const [galleryRefresh, setGalleryRefresh] = useState(0);

  // Install State
  const [installOpen, setInstallOpen] = useState(false);
  const [installStatus, setInstallStatus] = useState<InstallStatus | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const selectedWorkflow = workflows.find((w) => String(w.id) === selectedWorkflowId);

  // Persist selections
  useEffect(() => {
    if (selectedEngineId) localStorage.setItem("ds_selected_engine", selectedEngineId);
  }, [selectedEngineId]);

  useEffect(() => {
    if (selectedWorkflowId) localStorage.setItem("ds_selected_workflow", selectedWorkflowId);
  }, [selectedWorkflowId]);

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
  const handleFormChange = (newData: any) => {
    setFormData(newData);
    if (selectedWorkflowId) {
      localStorage.setItem(`workflow_form_${selectedWorkflowId}`, JSON.stringify(newData));
    }
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

  const handlePromptSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadPromptLibrary(promptSearch);
  };

  const applyPrompt = (prompt: Prompt) => {
    const params = prompt.parameters || {};
    handleFormChange(params);
    setFocusedField("");

    if (prompt.preview_image_path) {
      setPreviewPath(prompt.preview_image_path);
      setPreviewMetadata({
        prompt: prompt.positive_text || prompt.description,
        created_at: prompt.updated_at || prompt.created_at,
      });
    }
  };

  const handleSaveCurrentPrompt = async () => {
    if (!selectedWorkflowId) {
      setPromptError("Select a workflow before saving prompts");
      return;
    }

    const name = prompt("Name this prompt preset:");
    if (!name) return;

    try {
      await api.savePrompt({
        workflow_id: parseInt(selectedWorkflowId),
        name,
        description: "Saved from Prompt Studio",
        parameters: formData,
        positive_text: formData.prompt,
        negative_text: formData.negative_prompt,
        preview_image_path: previewPath || undefined,
      });

      await loadPromptLibrary(promptSearch);
      alert("Prompt saved to library!");
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : "Failed to save prompt");
    }
  };

  const runCaptionOnPreview = async () => {
    if (!previewPath) {
      setPromptError("Select or generate an image first");
      return;
    }
    setVisionBusy(true);
    setPromptError(null);
    try {
      const res = await fetch(`/api/v1/gallery/image/path?path=${encodeURIComponent(previewPath)}`);
      if (!res.ok) throw new Error("Unable to download preview image");
      const blob = await res.blob();
      const file = new File([blob], previewPath.split(/[\\/]/).pop() || "preview.png", { type: blob.type || "image/png" });
      const caption = await api.captionImage(file);
      setLastCaption(caption.caption);
      setCaptionTags(caption.ranked_tags || []);
      handleFormChange({ ...formData, prompt: caption.caption });
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : "Captioning failed");
    } finally {
      setVisionBusy(false);
    }
  };

  const expandTagsIntoPrompt = async () => {
    const tags = tagDraft.split(",").map(t => t.trim()).filter(Boolean);
    if (tags.length === 0) return;
    setVisionBusy(true);
    try {
      const res = await api.tagsToPrompt(tags);
      setTagExpansion(res.prompt);
      handleFormChange({ ...formData, prompt: res.prompt });
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : "Failed to expand tags");
    } finally {
      setVisionBusy(false);
    }
  };


  useEffect(() => {
    if (!lastJobId) return;

    setJobStatus("initiating");
    setProgress(0);
    setJobImages([]);

    const ws = new WebSocket(`ws://127.0.0.1:8000/api/v1/jobs/${lastJobId}/ws`);

    ws.onopen = () => {
      console.log("Connected to job stream", lastJobId);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "status") {
        setJobStatus(data.status);
      } else if (data.type === "progress") {
        const { value, max } = data.data;
        setProgress((value / max) * 100);
      } else if (data.type === "executing") {
        setJobStatus("processing");
      } else if (data.type === "completed") {
        setJobStatus("completed");
        setProgress(100);
        setJobImages(data.images);

        if (data.images && data.images.length > 0) {
          setPreviewPath(data.images[0].path);
          setPreviewMetadata({
            prompt: "Generated Image",
            created_at: new Date().toISOString()
          });
        }
        setGalleryRefresh(prev => prev + 1);
      } else if (data.type === "error") {
        setJobStatus("failed");
        setError(data.message);
      }
    };

    return () => {
      ws.close();
    };
  }, [lastJobId]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [enginesData, workflowsData] = await Promise.all([
          api.getEngines(),
          api.getWorkflows(),
        ]);
        setEngines(enginesData);
        setWorkflows(workflowsData);

        if (!selectedEngineId && enginesData.length > 0) setSelectedEngineId(String(enginesData[0].id));
        if (!selectedWorkflowId && workflowsData.length > 0) setSelectedWorkflowId(String(workflowsData[0].id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setIsLoading(false);
      }
    };
    loadData();

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // --- Install Logic ---
  const startInstall = async (missing: string[]) => {
    setInstallOpen(true);
    setInstallStatus({ status: "pending", progress_text: "Initializing..." });
    try {
      const res = await api.installMissingNodes(missing);
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

    setIsSubmitting(true);
    setError(null);
    try {
      const job = await api.createJob(
        parseInt(selectedEngineId),
        parseInt(selectedWorkflowId),
        data
      );
      setLastJobId(job.id);
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
    <div className="h-[calc(100vh-4rem)] bg-slate-100 flex overflow-hidden">

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
              <div className="p-4 text-xs text-slate-400">Select a workflow to use Prompt Constructor</div>
            )}
          </Panel>
        </PanelGroup>
      </div>

      {/* 2. Configuration (Left) */}
      <div className="w-[340px] flex-none bg-white border-r overflow-y-auto p-4 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold mb-4">Configuration</h2>
          <div className="space-y-4">
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
              <label className="text-xs font-semibold text-slate-500 uppercase">Workflow</label>
              <Select value={selectedWorkflowId} onValueChange={setSelectedWorkflowId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Workflow">
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
            {selectedWorkflow?.description?.includes("[Missing Nodes:") && (
              <Alert className="border-amber-500 bg-amber-50">
                <AlertTitle className="text-amber-800">Missing Nodes Detected</AlertTitle>
                <AlertDescription className="text-amber-700 text-xs">
                  This workflow requires custom nodes that are not installed.
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
                    Install Missing Nodes
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex-1">
          {selectedWorkflow ? (
            <DynamicForm
              schema={selectedWorkflow.input_schema}
              onSubmit={handleGenerate}
              isLoading={isSubmitting}
              engineId={selectedEngineId}
              submitLabel="Generate"
              formData={formData}
              onChange={handleFormChange}
              onFieldFocus={setFocusedField}
              activeField={focusedField}
            />
          ) : (
            <div className="text-center py-8 text-slate-400 text-sm">
              {workflows.length === 0 ? "No workflows found." : "Select workflow"}
            </div>
          )}
        </div>

        {/* Progress Status */}
        {lastJobId && jobStatus !== "completed" && jobStatus !== "failed" && jobStatus && (
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
        )}

        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-800">Vision Assist</h3>
          </div>
          <Button
            onClick={runCaptionOnPreview}
            disabled={visionBusy || !previewPath}
            variant="secondary"
            size="sm"
          >
            {visionBusy ? "Captioning..." : "Caption preview image"}
          </Button>
          {lastCaption && (
            <div className="p-2 bg-indigo-50 border border-indigo-100 rounded text-xs text-indigo-900">
              <p className="font-medium">{lastCaption}</p>
              {captionTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {captionTags.map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 bg-white border border-indigo-200 rounded">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder="comma-separated tags (city, neon, skyline)"
            />
            <Button onClick={expandTagsIntoPrompt} disabled={visionBusy || !tagDraft.trim()} size="sm">
              <Sparkles className="w-4 h-4 mr-1" />
              Expand tags
            </Button>
            {tagExpansion && (
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 p-2 rounded">{tagExpansion}</p>
            )}
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Prompt Library</h3>
              <p className="text-xs text-slate-500">Save and reuse prompts for this workflow.</p>
            </div>
            <Button size="sm" variant="secondary" onClick={handleSaveCurrentPrompt} disabled={!selectedWorkflowId}>
              <Save className="w-4 h-4 mr-1" />
              Save
            </Button>
          </div>

          <form onSubmit={handlePromptSearch} className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                value={promptSearch}
                onChange={(e) => setPromptSearch(e.target.value)}
                placeholder="Search prompts"
                className="pl-9"
              />
            </div>
            <Button type="submit" variant="outline" size="sm">Search</Button>
          </form>

          {promptError && (
            <Alert variant="destructive" className="mb-2">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{promptError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {promptLoading ? (
              <div className="text-xs text-slate-500">Loading prompts...</div>
            ) : prompts.length === 0 ? (
              <div className="text-xs text-slate-500 border border-dashed rounded p-3 bg-slate-50">
                No prompts saved yet. Save the current form or finish a job to auto-save.
              </div>
            ) : (
              prompts.map((p) => (
                <div key={p.id} className="p-3 border border-slate-200 rounded-lg bg-slate-50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-slate-900 truncate">{p.name}</p>
                      <p className="text-xs text-slate-500 truncate">{p.description || "No description"}</p>
                      {p.positive_text && (
                        <p className="text-[11px] text-slate-600 line-clamp-1 mt-1">{p.positive_text}</p>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" className="text-blue-600 hover:text-blue-700" onClick={() => applyPrompt(p)}>
                      Load
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2 text-[11px] text-slate-500">
                    {p.parameters?.steps && (
                      <span className="px-2 py-0.5 bg-white border border-slate-200 rounded">Steps: {p.parameters.steps}</span>
                    )}
                    {p.parameters?.cfg && (
                      <span className="px-2 py-0.5 bg-white border border-slate-200 rounded">CFG: {p.parameters.cfg}</span>
                    )}
                    {p.parameters?.sampler_name && (
                      <span className="px-2 py-0.5 bg-white border border-slate-200 rounded">{p.parameters.sampler_name}</span>
                    )}
                    {p.updated_at && (
                      <span className="px-2 py-0.5 bg-white border border-slate-200 rounded">{new Date(p.updated_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 3. Center Preview */}
      <div className="flex-1 overflow-hidden relative bg-slate-50">
        <ErrorBoundary>
          <ImageViewer
            imagePath={previewPath}
            metadata={previewMetadata}
            workflows={workflows}
            onSelectWorkflow={handleWorkflowSelect}
          />
        </ErrorBoundary>
      </div>

      {/* 4. Running Gallery (Right Sidebar) */}
      <div className="w-[120px] flex-none bg-white border-l hidden lg:block">
        <RunningGallery onRefresh={galleryRefresh} onSelect={handleGallerySelect} />
      </div>

      <InstallStatusDialog
        open={installOpen}
        onOpenChange={(open) => {
          setInstallOpen(open);
          if (!open && pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        }}
        status={installStatus}
        onReboot={handleReboot}
      />
    </div>
  );
}
