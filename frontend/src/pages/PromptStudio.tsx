import { useEffect, useState } from "react";
import { api, Engine, WorkflowTemplate, FileItem, GalleryItem } from "@/lib/api";
import { DynamicForm } from "@/components/DynamicForm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2, Server, Workflow } from "lucide-react";
import { RunningGallery } from "@/components/RunningGallery";
import { FileExplorer } from "@/components/FileExplorer";
import { ImageViewer } from "@/components/ImageViewer";

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

  // Add a refresh key for gallery
  const [galleryRefresh, setGalleryRefresh] = useState(0);

  // Persist selections
  useEffect(() => {
    if (selectedEngineId) localStorage.setItem("ds_selected_engine", selectedEngineId);
  }, [selectedEngineId]);

  useEffect(() => {
    if (selectedWorkflowId) localStorage.setItem("ds_selected_workflow", selectedWorkflowId);
  }, [selectedWorkflowId]);

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

        // Auto-select first result
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
  }, []);

  const handleGenerate = async (formData: any) => {
    if (!selectedEngineId || !selectedWorkflowId) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const job = await api.createJob(
        parseInt(selectedEngineId),
        parseInt(selectedWorkflowId),
        formData
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

  // We need to pass selection handler to RunningGallery too?
  // Currently RunningGallery has recursive selection or just internal state.
  // Ideally RunningGallery exposes `onSelect` prop. 
  // But wait, the `RunningGallery` component I built handles its own selection state in a lightbox.
  // I should modify `RunningGallery` to accept `onSelect` or just use the FileExplorer for main selection.
  // Actually, the user asked for: "selected image... preview... generation info underneath".
  // So Gallery clicks should probably update the CENTER preview.

  const selectedWorkflow = workflows.find((w) => String(w.id) === selectedWorkflowId);

  const handleGallerySelect = (item: GalleryItem) => {
    setPreviewPath(item.image.path);
    setPreviewMetadata(item);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex overflow-hidden bg-slate-100">

      {/* 1. File Explorer (Far Left) */}
      <div className="w-64 flex-none bg-white border-r hidden xl:block">
        <FileExplorer engineId={selectedEngineId} onFileSelect={handleFileSelect} />
      </div>

      {/* 2. Configuration (Left) */}
      <div className="w-[300px] flex-none bg-white border-r overflow-y-auto p-4 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold mb-4">Configuration</h2>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Engine</label>
              <Select value={selectedEngineId} onValueChange={setSelectedEngineId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Engine" />
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
                  <SelectValue placeholder="Select Workflow" />
                </SelectTrigger>
                <SelectContent>
                  {workflows.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              persistenceKey={`workflow_form_${selectedWorkflow.id}`}
              engineId={selectedEngineId}
            />
          ) : (
            <div className="text-center py-8 text-slate-400 text-sm">Select workflow</div>
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
      </div>

      {/* 3. Center Preview */}
      <div className="flex-1 overflow-hidden relative bg-slate-50">
        <ImageViewer imagePath={previewPath} metadata={previewMetadata} />
      </div>

      {/* 4. Running Gallery (Right Sidebar) */}
      <div className="w-[120px] flex-none bg-white border-l hidden lg:block">
        <RunningGallery onRefresh={galleryRefresh} onSelect={handleGallerySelect} />
      </div>
    </div>
  );
}
