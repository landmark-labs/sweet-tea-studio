import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowDownCircle, FolderOpen, Info, Link2, Rocket, Sparkles, Trash2, XCircle } from "lucide-react";

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
  status: "queued" | "downloading" | "completed" | "failed" | "cancelled";
  progress: number;
  speed?: string;
  eta?: string;
  filename?: string;
  downloaded_bytes?: number;
  total_bytes?: number;
  error?: string;
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

  // Fetch installed models from API
  const fetchModels = async (refresh = false) => {
    setIsLoading(true);
    try {
      const url = refresh ? "/api/v1/models/installed?refresh=true" : "/api/v1/models/installed";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        console.log("[Models] Fetched installed models:", data);
        // Map API response to component format
        const mapped: InstalledModel[] = data.map((m: any, index: number) => ({
          id: m.id || `model-${index}-${Date.now()}`,
          name: m.name || "Unknown Model",
          category: (m.kind ? (m.kind.charAt(0).toUpperCase() + m.kind.slice(1)) : "Other") as ModelCategory,
          source: m.source === "civitai" ? "Civitai" : m.source === "huggingface" ? "Hugging Face" : "Manual",
          size: m.size_display || "?",
          location: m.path || "",
          notes: m.meta?.description,
        }));
        console.log("[Models] Mapped to:", mapped);
        setModels(mapped);
      } else {
        console.error("[Models] Failed response:", res.status, await res.text());
        // NEVER clear models on error to prevent data loss from stale closures
      }
    } catch (e) {
      console.error("Failed to load models:", e);
      // NEVER clear models on error
    } finally {
      setIsLoading(false);
    }
  };


  // Fetch download queue
  const fetchDownloads = async () => {
    try {
      // Add timestamp to prevent caching
      const res = await fetch(`/api/v1/models/downloads?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        const mapped: DownloadJob[] = data.map((d: any) => ({
          id: d.job_id,
          source: "Hugging Face" as DownloadSource, // Backend doesn't always send source, label handles it
          link: d.url || "",
          category: selectedCategory,
          target: d.target_folder || "unknown",
          status: d.status,
          progress: d.progress ?? 0,
          speed: d.speed || "",
          eta: d.eta || "",
          filename: d.filename || "",
          downloaded_bytes: d.downloaded_bytes,
          total_bytes: d.total_bytes,
          error: d.error || undefined,
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

  // Fetch contents of a specific folder (lazy-loaded)
  const fetchFolderContents = async (folderName: string) => {
    try {
      const res = await fetch(`/api/v1/models/directories/${folderName}`);
      if (!res.ok) return;
      const data = await res.json();
      // Update the items for this folder in modelFolders
      setModelFolders(prev => prev.map(f =>
        f.name === folderName ? { ...f, items: data.items || [] } : f
      ));
    } catch (e) {
      console.error(`Failed to load folder contents for ${folderName}:`, e);
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

  // Load folder contents when activeFolder changes
  useEffect(() => {
    if (activeFolder) {
      fetchFolderContents(activeFolder);
    }
  }, [activeFolder]);

  // Set default target for download rows when folders load
  useEffect(() => {
    if (modelFolders.length > 0) {
      const firstFolder = modelFolders[0].name;
      setDownloadRows(prev => prev.map(row =>
        row.target === "" ? { ...row, target: firstFolder } : row
      ));
    }
  }, [modelFolders]);



  const filteredModels = useMemo(() => {
    console.log("[Models] Computing filteredModels. models.length:", models.length, "selectedCategory:", selectedCategory, "search:", search);
    const term = search.toLowerCase();
    const result = models.filter((m) => {
      const matchesSearch =
        !term ||
        m.name.toLowerCase().includes(term) ||
        m.location.toLowerCase().includes(term) ||
        (m.notes?.toLowerCase().includes(term) ?? false);
      if (selectedCategory === "all" || !selectedCategory) return matchesSearch;

      const pathSegments = m.location.toLowerCase().split(/[\\/]/);
      return matchesSearch && pathSegments.includes(selectedCategory.toLowerCase());
    });
    console.log("[Models] filteredModels result:", result.length);
    return result;
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

    let successCount = 0;
    const errors: string[] = [];

    for (const row of validRows) {
      try {
        const res = await fetch("/api/v1/models/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: row.url.trim(),
            target_folder: row.target.toLowerCase(),
          }),
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          errors.push(`${row.url}: ${errorData.detail || res.statusText}`);
        } else {
          successCount++;
        }
      } catch (e) {
        console.error("Failed to queue download:", e);
        errors.push(`${row.url}: Network error - ${e instanceof Error ? e.message : "Unknown error"}`);
      }
    }

    if (errors.length > 0) {
      alert(`Failed to queue ${errors.length} download(s):\n${errors.join("\n")}`);
    }

    // Clear rows and refresh if any succeeded
    if (successCount > 0) {
      setDownloadRows([{ target: modelFolders.length > 0 ? modelFolders[0].name : "checkpoints", url: "", id: Date.now() }]);
    }
    fetchDownloads();
  };

  const cancelJob = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/models/downloads/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchDownloads(); // Refresh the queue
      } else {
        console.error("Failed to cancel download");
      }
    } catch (e) {
      console.error("Failed to cancel download:", e);
    }
  };

  const clearQueue = async () => {
    try {
      const res = await fetch("/api/v1/models/downloads/clear", {
        method: "DELETE",
      });
      if (res.ok) {
        fetchDownloads(); // Refresh the queue
      }
    } catch (e) {
      console.error("Failed to clear queue:", e);
    }
  };

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-hidden">
      <div className="flex-none flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Sparkles className="text-blue-600" size={20} />
          <div>
            <h1 className="text-xl font-semibold">models</h1>
            <p className="text-xs text-muted-foreground">
              manage everything sweet tea feeds to comfyui: checkpoints, loras, controlnets, upscalers, and vlm assets.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-none grid grid-cols-1 md:grid-cols-3 gap-4 h-[400px]">
        {/* Column 1: ComfyUI Folders */}
        <Card className="h-full flex flex-col overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-1 p-3 flex-none">
            <CardTitle className="text-sm">comfyui folders</CardTitle>
            <span title="click to set a custom models directory">
              <FolderOpen
                className="text-blue-500 cursor-pointer hover:text-blue-600 active:scale-95 transition-all"
                size={14}
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
            </span>
          </CardHeader>
          <CardContent className="flex gap-2 flex-1 min-h-0 p-2 overflow-hidden">
            <ScrollArea className="w-1/3 border rounded-md h-full">
              <div className="p-1 space-y-0.5">
                {modelFolders.map((folder) => (
                  <button
                    key={folder.name}
                    className={`w-full text-left px-2 py-1.5 rounded-sm text-xs transition-colors ${activeFolder === folder.name ? "bg-blue-50 text-blue-700 border border-blue-200" : "hover:bg-muted/40"}`}
                    onClick={() => setActiveFolder(folder.name)}
                  >
                    <div className="font-medium truncate">{folder.name}</div>
                    <div className="text-[10px] text-muted-foreground break-all truncate">{folder.path}</div>
                  </button>
                ))}
                {!modelFolders.length && (
                  <div className="text-xs text-muted-foreground px-2 py-1">no folders detected</div>
                )}
              </div>
            </ScrollArea>
            <ScrollArea className="flex-1 border rounded-md h-full">
              <div className="p-2 space-y-1">
                {modelFolders
                  .find((f) => f.name === activeFolder)
                  ?.items.filter((item) => {
                    if (item.type === "directory") return true;
                    // Filter for common model file extensions
                    return /\.(safetensors|gguf|pth|ckpt|pt|bin|onnx)$/i.test(item.name);
                  })
                  .map((item) => (
                    <div key={item.path} className="flex items-center gap-2 rounded border border-border/60 px-2 py-1 text-xs bg-card hover:bg-muted/30 transition-colors">
                      {item.type === "directory" ? (
                        <FolderOpen size={12} className="text-muted-foreground flex-shrink-0" />
                      ) : (
                        <Link2 size={12} className="text-muted-foreground/70 flex-shrink-0" />
                      )}
                      <span className="truncate font-medium">{item.name}</span>
                    </div>
                  ))}
                {!modelFolders.length && <div className="text-xs text-muted-foreground">select directory</div>}
                {modelFolders.length > 0 && !modelFolders.find((f) => f.name === activeFolder)?.items.length && (
                  <div className="text-xs text-muted-foreground">empty folder</div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Column 2: Add Model Downloads */}
        <Card className="h-full flex flex-col overflow-hidden">
          <CardHeader className="pb-1 p-3 flex-none">
            <CardTitle className="text-sm">add model downloads</CardTitle>
            <CardDescription className="text-[10px]">
              smart-detects civitai vs hugging face links.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 flex-1 overflow-y-auto p-2 scrollbar-thin">
            <div className="space-y-2">
              {downloadRows.map((row, index) => (
                <div key={row.id} className="flex gap-2 items-start animate-in slide-in-from-left-2 duration-200" style={{ animationDelay: `${index * 50}ms` }}>
                  <Select
                    value={row.target}
                    onValueChange={(v) => handleRowChange(row.id, 'target', v)}
                  >
                    <SelectTrigger className="w-[100px] flex-none h-7 text-xs">
                      <span className="truncate block max-w-[70px]"><SelectValue /></span>
                    </SelectTrigger>
                    <SelectContent>
                      {modelFolders.map((folder) => (
                        <SelectItem key={folder.name} value={folder.name} className="text-xs">
                          {folder.name}
                        </SelectItem>
                      ))}
                      {!modelFolders.length && (
                        <SelectItem value="checkpoints" disabled className="text-xs">checkpoints</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="paste link..."
                    className="flex-1 min-w-0 h-7 text-xs"
                    value={row.url}
                    onChange={(e) => handleRowChange(row.id, 'url', e.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="flex-none h-7 w-7 text-muted-foreground hover:text-red-500"
                    onClick={() => handleRemoveRow(row.id)}
                    disabled={downloadRows.length === 1 && !row.url}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>

            <Button
              variant="secondary"
              className="w-full text-[10px] gap-1 h-6"
              onClick={handleAddRow}
            >
              <div className="w-3 h-3 rounded-full bg-muted flex items-center justify-center font-bold text-muted-foreground">+</div>
              add another link
            </Button>

            <div className="pt-2 border-t mt-2">
              <Button className="w-full h-8 text-xs" onClick={processQueue} disabled={!downloadRows.some(r => r.url.trim().length > 0)}>
                <Rocket className="w-3 h-3 mr-2" />
                start downloads
              </Button>
            </div>

            <div className="bg-muted/30 p-2 rounded text-[10px] text-muted-foreground space-y-1">
              <div className="flex gap-2 items-center"><Info size={12} /> <span>Auto-sorted by link type</span></div>
              <p>Civitai: API downloader. HF file links: aria2c. HF repo IDs: huggingface_hub (sharded models).</p>
            </div>
          </CardContent>
        </Card>

        {/* Column 3: Download Queue */}
        <Card className="h-full flex flex-col overflow-hidden">
          <CardHeader className="pb-1 p-3 flex-none flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm">download queue</CardTitle>
              <CardDescription className="text-[10px]">active and past jobs.</CardDescription>
            </div>
            {downloadQueue.some(j => j.status === "completed" || j.status === "failed" || j.status === "cancelled") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] text-muted-foreground hover:text-red-500"
                onClick={clearQueue}
              >
                <Trash2 size={12} className="mr-1" />
                clear
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2 flex-1 overflow-y-auto p-2 scrollbar-thin">
            {downloadQueue.map((job) => (
              <div key={job.id} className={`rounded-md border p-2 bg-card space-y-1 ${job.status === "failed" ? "border-destructive/40 bg-destructive/10" :
                job.status === "cancelled" ? "border-border/60 bg-muted/20" :
                  job.status === "completed" ? "border-emerald-500/30 bg-emerald-500/10" :
                    "border-border/60"
                }`}>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5 w-full overflow-hidden">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <ArrowDownCircle size={14} className={`flex-none ${job.status === "downloading" ? "text-blue-500 animate-pulse" :
                        job.status === "completed" ? "text-green-500" :
                          job.status === "failed" ? "text-red-500" :
                            job.status === "cancelled" ? "text-muted-foreground/70" :
                              "text-muted-foreground"
                        }`} />
                      <span className="truncate">{job.filename || job.target}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate" title={job.link}>{job.link}</p>
                  </div>
                  <div className="flex gap-0.5 flex-none">
                    {(job.status === "queued" || job.status === "downloading") && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-muted-foreground hover:text-red-500"
                        onClick={() => cancelJob(job.id)}
                        title="cancel download"
                      >
                        <XCircle size={14} />
                      </Button>
                    )}
                    {(job.status === "completed" || job.status === "failed" || job.status === "cancelled") && (
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-red-500" onClick={() => cancelJob(job.id)} title="Remove from queue">
                        <Trash2 size={12} />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className={`capitalize font-medium ${job.status === "downloading" ? "text-blue-600" :
                      job.status === "completed" ? "text-green-600" :
                        job.status === "failed" ? "text-red-600" :
                          job.status === "cancelled" ? "text-muted-foreground" :
                            "text-muted-foreground"
                      }`}>{job.status}</span>
                    <span className="flex items-center gap-2">
                      {job.speed && <span>{job.speed}</span>}
                      {job.eta && job.status === "downloading" && <span className="text-muted-foreground/70">ETA: {job.eta}</span>}
                    </span>
                  </div>
                  <Progress value={job.progress} className="h-1.5" />
                  {job.error && (
                    <p className="text-[10px] text-red-600 truncate" title={job.error}>{job.error}</p>
                  )}
                </div>
              </div>
            ))}
            {!downloadQueue.length && (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/70">
                <ArrowDownCircle className="w-6 h-6 opacity-20 mb-1" />
                <p className="text-xs">queue is empty</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <CardHeader className="py-2 px-4 flex-none border-b">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">installed models</CardTitle>
              <CardDescription className="text-xs">discover what is already available inside comfyui for this sweet tea instance.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="search models..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 text-xs w-48"
              />
              <Select value={selectedCategory} onValueChange={(value) => setSelectedCategory(value as ModelCategory)}>
                <SelectTrigger className="h-7 text-xs w-32">
                  <SelectValue placeholder="filter type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">all types</SelectItem>
                  {modelFolders.map((folder) => (
                    <SelectItem key={folder.name} value={folder.name} className="text-xs">
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => fetchModels(true)} disabled={isLoading} className="h-7 text-xs">
                {isLoading ? "..." : "refresh"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0 overflow-auto">
          <Table className="text-xs w-full">
            <TableHeader className="bg-muted/30 sticky top-0 z-10 shadow-sm">
              <TableRow className="h-8 hover:bg-muted/30 border-b border-border/60">
                <TableHead className="h-8 py-1 pl-4 w-[25%]">name</TableHead>
                <TableHead className="h-8 py-1 w-[10%]">type</TableHead>
                <TableHead className="h-8 py-1 w-[10%]">source</TableHead>
                <TableHead className="h-8 py-1 w-[10%]">size</TableHead>
                <TableHead className="h-8 py-1 w-[30%]">location</TableHead>
                <TableHead className="h-8 py-1 w-[15%]">notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredModels.map((model) => (
                <TableRow key={model.id} className="h-8 hover:bg-muted/30 border-b-0">
                  <TableCell className="py-1 pl-4 font-medium truncate max-w-[200px]" title={model.name}>{model.name}</TableCell>
                  <TableCell className="py-1">{model.category}</TableCell>
                  <TableCell className="py-1">{model.source}</TableCell>
                  <TableCell className="py-1">{model.size}</TableCell>
                  <TableCell className="py-1 text-muted-foreground truncate max-w-[300px]" title={model.location}>{model.location}</TableCell>
                  <TableCell className="py-1 text-muted-foreground truncate max-w-[150px]">{model.notes || "—"}</TableCell>
                </TableRow>
              ))}
              {!filteredModels.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    no models match the current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
