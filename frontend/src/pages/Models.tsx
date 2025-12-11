import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowDownCircle, ExternalLink, FolderOpen, Info, Link2, Rocket, Sparkles, Trash2 } from "lucide-react";
import { useUndoRedo } from "@/lib/undoRedo";

type ModelCategory = string;

type InstalledModel = {
  id: string;
  name: string;
  category: ModelCategory;
  source: "Hugging Face" | "Civitai" | "Manual";
  size: string;
  location: string;
  version?: string;
  notes?: string;
};

type DownloadSource = "Hugging Face" | "Civitai";

type DownloadJob = {
  id: string;
  source: DownloadSource;
  link: string;
  category: ModelCategory;
  target: string;
  status: "queued" | "downloading" | "completed" | "failed";
  progress: number;
  speed?: string;
  eta?: string;
};

type ModelFolder = {
  name: string;
  path: string;
  items: { name: string; path: string; type: "file" | "directory" }[];
};

// Models are now fetched from API - see fetchModels()

export default function Models() {
  const [models, setModels] = useState<InstalledModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadQueue, setDownloadQueue] = useState<DownloadJob[]>([]);
  const [modelFolders, setModelFolders] = useState<ModelFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>("");
  const [modelsRoot, setModelsRoot] = useState<string>("");

  // New State for Dynamic Download Rows
  const [downloadRows, setDownloadRows] = useState<{ target: string; url: string; id: number }[]>([
    { target: "", url: "", id: Date.now() }
  ]);

  const [selectedCategory, setSelectedCategory] = useState<ModelCategory>("all");
  const [search, setSearch] = useState("");
  // Removed single targetFolder state since it's now per-row
  const { registerStateChange } = useUndoRedo();

  // Fetch installed models from API
  const fetchModels = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/v1/models/installed");
      if (res.ok) {
        const data = await res.json();
        // Map API response to component format
        const mapped: InstalledModel[] = data.map((m: any) => ({
          id: m.id,
          name: m.name,
          category: m.kind.charAt(0).toUpperCase() + m.kind.slice(1) as ModelCategory,
          source: m.source === "civitai" ? "Civitai" : m.source === "huggingface" ? "Hugging Face" : "Manual",
          size: m.size_display,
          location: m.path,
          notes: m.meta?.description,
        }));
        setModels(mapped);
      }
    } catch (e) {
      console.error("Failed to load models:", e);
      // Fall back to empty list
      setModels([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch download queue
  const fetchDownloads = async () => {
    try {
      const res = await fetch("/api/v1/models/downloads");
      if (res.ok) {
        const data = await res.json();
        const mapped: DownloadJob[] = data.map((d: any) => ({
          id: d.job_id,
          source: "Hugging Face" as DownloadSource, // Backend doesn't always send source, but label handles it
          link: d.url || "",
          category: selectedCategory, // Note: backend doesn't return category for job status easily yet
          target: d.target_folder || "unknown",
          status: d.status,
          progress: d.progress,
          speed: d.speed,
          eta: d.eta,
        }));
        setDownloadQueue(mapped);
      }
    } catch (e) {
      console.error("Failed to load downloads:", e);
    }
  };

  const fetchModelFolders = async () => {
    try {
      const res = await fetch("/api/v1/models/directories");
      if (!res.ok) return;
      const data = await res.json();
      setModelsRoot(data.root || "");
      setModelFolders(data.folders || []);
      if (!activeFolder && data.folders?.length) {
        setActiveFolder(data.folders[0].name);
      }
    } catch (e) {
      console.error("Failed to load model folders", e);
      setModelFolders([]);
    }
  };

  useEffect(() => {
    fetchModels();
    fetchDownloads();
    fetchModelFolders();
    // Poll downloads every 2 seconds
    const interval = setInterval(fetchDownloads, 2000);
    return () => clearInterval(interval);
  }, []);

  // Set default target for download rows when folders load
  useEffect(() => {
    if (modelFolders.length > 0) {
      const firstFolder = modelFolders[0].name;
      setDownloadRows(prev => prev.map(row =>
        row.target === "" ? { ...row, target: firstFolder } : row
      ));
    }
  }, [modelFolders]);

  const applyQueue = (next: DownloadJob[]) => setDownloadQueue(next);
  const updateQueue = (
    label: string,
    builder: (prev: DownloadJob[]) => DownloadJob[],
    guardable = false
  ) => {
    setDownloadQueue((prev) => {
      const next = builder(prev);
      registerStateChange(label, prev, next, applyQueue, guardable);
      return next;
    });
  };

  const filteredModels = useMemo(() => {
    const term = search.toLowerCase();
    return models.filter((m) => {
      const matchesSearch =
        !term ||
        m.name.toLowerCase().includes(term) ||
        m.location.toLowerCase().includes(term) ||
        (m.notes?.toLowerCase().includes(term) ?? false);
      if (selectedCategory === "all" || !selectedCategory) return matchesSearch;

      const pathSegments = m.location.toLowerCase().split(/[\\/]/);
      return matchesSearch && pathSegments.includes(selectedCategory.toLowerCase());
    });
  }, [models, search, selectedCategory]);

  const handleAddRow = () => {
    const defaultTarget = modelFolders.length > 0 ? modelFolders[0].name : "checkpoints";
    setDownloadRows(prev => [...prev, { target: defaultTarget, url: "", id: Date.now() }]);
  };

  const handleRemoveRow = (id: number) => {
    if (downloadRows.length === 1) {
      const defaultTarget = modelFolders.length > 0 ? modelFolders[0].name : "checkpoints";
      setDownloadRows([{ target: defaultTarget, url: "", id: Date.now() }]); // Reset if last one
      return;
    }
    setDownloadRows(prev => prev.filter(r => r.id !== id));
  };

  const handleRowChange = (id: number, field: 'target' | 'url', value: string) => {
    setDownloadRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const processQueue = async () => {
    const validRows = downloadRows.filter(r => r.url.trim().length > 0);
    if (!validRows.length) return;

    for (const row of validRows) {
      try {
        await fetch("/api/v1/models/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: row.url.trim(),
            target_folder: row.target.toLowerCase(),
            // Backend will auto-detect Civitai vs Aria2c based on URL
          }),
        });
      } catch (e) {
        console.error("Failed to queue download:", e);
        alert(`Failed to queue: ${row.url}`);
      }
    }

    // Clear rows and refresh
    setDownloadRows([{ target: "checkpoints", url: "", id: Date.now() }]);
    fetchDownloads();
  };

  const markComplete = (id: string) => {
    updateQueue("Marked download complete", (prev) =>
      prev.map((job) =>
        job.id === id
          ? {
            ...job,
            status: "completed",
            progress: 100,
            eta: "done",
          }
          : job
      )
    );
  };

  const removeJob = (id: string) => {
    if (!confirm("Remove this download from the queue? You can undo immediately if needed.")) return;
    updateQueue(
      "Removed download job",
      (prev) => prev.filter((job) => job.id !== id),
      true
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Sparkles className="text-blue-600" size={24} />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">models</h1>
            <p className="text-sm text-slate-600">
              manage everything sweet tea feeds to comfyui: checkpoints, loras, controlnets, upscalers, and vlm assets.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Column 1: ComfyUI Folders */}
        <Card className="h-full flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">ComfyUI folders</CardTitle>
            <FolderOpen
              className="text-blue-500 cursor-pointer hover:text-blue-600 active:scale-95 transition-all"
              size={18}
              title="Click to set a custom models directory"
              onClick={async () => {
                const newPath = prompt(
                  `Current models directory:\n${modelsRoot || "(not detected)"}\n\nEnter a new path to override (leave blank to auto-detect):`,
                  modelsRoot || ""
                );
                if (newPath === null) return; // Cancelled

                try {
                  const res = await fetch("/api/v1/models/directories", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path: newPath || null }),
                  });
                  if (!res.ok) {
                    const err = await res.json();
                    alert(`Failed to update: ${err.detail || "Unknown error"}`);
                    return;
                  }
                  const data = await res.json();
                  setModelsRoot(data.root || "");
                  setModelFolders(data.folders || []);
                  if (data.folders?.length) {
                    setActiveFolder(data.folders[0].name);
                  }
                } catch (e) {
                  console.error("Failed to update models directory:", e);
                  alert("Failed to update models directory. Check console.");
                }
              }}
            />
          </CardHeader>
          <CardContent className="flex gap-3 flex-1 min-h-[320px]">
            <ScrollArea className="w-1/3 border rounded-md max-h-[600px]">
              <div className="p-2 space-y-1">
                {modelFolders.map((folder) => (
                  <button
                    key={folder.name}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${activeFolder === folder.name ? "bg-blue-50 text-blue-700 border border-blue-200" : "hover:bg-slate-50"}`}
                    onClick={() => setActiveFolder(folder.name)}
                  >
                    <div className="font-medium">{folder.name}</div>
                    <div className="text-[11px] text-slate-500 break-all">{folder.path}</div>
                  </button>
                ))}
                {!modelFolders.length && (
                  <div className="text-sm text-slate-500 px-2 py-1">no model folders found</div>
                )}
              </div>
            </ScrollArea>
            <ScrollArea className="flex-1 border rounded-md max-h-[600px]">
              <div className="p-3 space-y-2">
                {modelFolders
                  .find((f) => f.name === activeFolder)
                  ?.items.filter((item) => {
                    if (item.type === "directory") return true;
                    // Filter for common model file extensions
                    return /\.(safetensors|gguf|pth|ckpt|pt|bin|onnx)$/i.test(item.name);
                  })
                  .map((item) => (
                    <div key={item.path} className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm bg-white hover:bg-slate-50 transition-colors">
                      {item.type === "directory" ? (
                        <FolderOpen size={14} className="text-slate-500 flex-shrink-0" />
                      ) : (
                        <Link2 size={14} className="text-slate-400 flex-shrink-0" />
                      )}
                      <span className="truncate font-medium">{item.name}</span>
                    </div>
                  ))}
                {!modelFolders.length && <div className="text-sm text-slate-500">select or add a models directory to explore contents.</div>}
                {modelFolders.length > 0 && !modelFolders.find((f) => f.name === activeFolder)?.items.length && (
                  <div className="text-sm text-slate-500">no files found in this folder.</div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Column 2: Add Model Downloads */}
        <Card className="h-full flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Add model downloads</CardTitle>
            <CardDescription className="text-xs">
              Smart-detects Civitai vs Hugging Face links.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 flex-1 overflow-y-auto max-h-[600px]">
            <div className="space-y-2">
              {downloadRows.map((row, index) => (
                <div key={row.id} className="flex gap-2 items-start animate-in slide-in-from-left-2 duration-200" style={{ animationDelay: `${index * 50}ms` }}>
                  <Select
                    value={row.target}
                    onValueChange={(v) => handleRowChange(row.id, 'target', v)}
                  >
                    <SelectTrigger className="w-[110px] flex-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelFolders.map((folder) => (
                        <SelectItem key={folder.name} value={folder.name}>
                          {folder.name}
                        </SelectItem>
                      ))}
                      {!modelFolders.length && (
                        <SelectItem value="checkpoints" disabled>checkpoints (loading...)</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Paste link..."
                    className="flex-1 min-w-0"
                    value={row.url}
                    onChange={(e) => handleRowChange(row.id, 'url', e.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="flex-none text-slate-400 hover:text-red-500"
                    onClick={() => handleRemoveRow(row.id)}
                    disabled={downloadRows.length === 1 && !row.url}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
            </div>

            <Button
              variant="secondary"
              className="w-full text-xs gap-1 h-8"
              onClick={handleAddRow}
            >
              <div className="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-600">+</div>
              Add another link
            </Button>

            <div className="pt-4 border-t mt-4">
              <Button className="w-full" onClick={processQueue} disabled={!downloadRows.some(r => r.url.trim().length > 0)}>
                <Rocket className="w-4 h-4 mr-2" />
                Start Downloads
              </Button>
            </div>

            <div className="bg-slate-50 p-3 rounded text-xs text-slate-500 space-y-1">
              <div className="flex gap-2 items-center"><Info size={14} /> <span>Auto-sorted by link type</span></div>
              <p>Civitai links use civitaidownloader (API key supported if env var set). HF links use aria2c (multiconnection).</p>
            </div>
          </CardContent>
        </Card>

        {/* Column 3: Download Queue */}
        <Card className="h-full flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Download queue</CardTitle>
            <CardDescription className="text-xs">Active and past jobs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 flex-1 overflow-y-auto max-h-[600px]">
            {downloadQueue.map((job) => (
              <div key={job.id} className="rounded-md border border-slate-200 p-3 bg-white space-y-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-1 w-full overflow-hidden">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <ArrowDownCircle size={16} className="text-blue-500 flex-none" />
                      <span className="capitalize truncate">{job.target}</span>
                    </div>
                    <p className="text-xs text-slate-500 truncate" title={job.link}>{job.link}</p>
                  </div>
                  <div className="flex gap-1 flex-none">
                    {job.status !== "completed" && (
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => markComplete(job.id)}>
                        Reset
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeJob(job.id)}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="capitalize">{job.status}</span>
                    <span>{job.eta || job.speed}</span>
                  </div>
                  <Progress value={job.progress} className="h-2" />
                </div>
              </div>
            ))}
            {!downloadQueue.length && (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <ArrowDownCircle className="w-8 h-8 opacity-20 mb-2" />
                <p className="text-sm">Queue is empty</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Installed models</CardTitle>
          <CardDescription>discover what is already available inside comfyui for this sweet tea instance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              placeholder="Search models or paths"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={selectedCategory} onValueChange={(value) => setSelectedCategory(value as ModelCategory)}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all</SelectItem>
                {modelFolders.map((folder) => (
                  <SelectItem key={folder.name} value={folder.name}>
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={fetchModels} disabled={isLoading}>
              {isLoading ? "loading..." : "refresh inventory"}
            </Button>
          </div>

          <ScrollArea className="max-h-[420px] rounded-md border border-slate-200">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredModels.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell className="font-medium">{model.name}</TableCell>
                    <TableCell>{model.category}</TableCell>
                    <TableCell>{model.source}</TableCell>
                    <TableCell>{model.size}</TableCell>
                    <TableCell className="text-xs text-slate-600 break-all">{model.location}</TableCell>
                    <TableCell className="text-xs text-slate-600">{model.notes || "—"}</TableCell>
                  </TableRow>
                ))}
                {!filteredModels.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500">
                      No models match the current filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
