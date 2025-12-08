import { useMemo, useState } from "react";
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

const comfyModelFolders = [
  {
    name: "Checkpoints",
    path: "ComfyUI/models/checkpoints",
    description: "Stable Diffusion or custom checkpoints used for base generations.",
  },
  {
    name: "LoRAs",
    path: "ComfyUI/models/loras",
    description: "Style, character, or specialty LoRAs for fine-tuning outputs.",
  },
  {
    name: "ControlNets",
    path: "ComfyUI/models/controlnet",
    description: "Edge, depth, and pose ControlNet weights.",
  },
  {
    name: "Upscalers / VAEs",
    path: "ComfyUI/models/upscale (or vae)",
    description: "High-resolution upscalers or alternate VAEs.",
  },
  {
    name: "VLM / Vision",
    path: "ComfyUI/models/vlm",
    description: "Vision-language models used by Sweet Tea's captioning/tagging.",
  },
];

type ModelCategory = "Checkpoint" | "LoRA" | "ControlNet" | "Upscaler" | "VLM";

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

const seededModels: InstalledModel[] = [
  {
    id: "mdl-1",
    name: "Juggernaut XL",
    category: "Checkpoint",
    source: "Hugging Face",
    size: "6.1 GB",
    location: "ComfyUI/models/checkpoints/juggernautXL.safetensors",
    version: "1.2",
    notes: "Primary XL base used by Sweet Tea Studio",
  },
  {
    id: "mdl-2",
    name: "epiCPhotoGasm",
    category: "LoRA",
    source: "Civitai",
    size: "220 MB",
    location: "ComfyUI/models/loras/epiCPhotoGasm.safetensors",
    notes: "Portrait enhancer for people-focused workflows",
  },
  {
    id: "mdl-3",
    name: "ControlNet OpenPose",
    category: "ControlNet",
    source: "Hugging Face",
    size: "1.5 GB",
    location: "ComfyUI/models/controlnet/control_v11p_sd15_openpose.pth",
  },
  {
    id: "mdl-4",
    name: "4x-AnimeSharp",
    category: "Upscaler",
    source: "Manual",
    size: "140 MB",
    location: "ComfyUI/models/upscale/4x-AnimeSharp.pth",
  },
  {
    id: "mdl-5",
    name: "Qwen2-VL-7B-Instruct",
    category: "VLM",
    source: "Hugging Face",
    size: "14.3 GB",
    location: "ComfyUI/models/vlm/qwen2-vl-7b-instruct",
    notes: "Used for automatic captioning and tags",
  },
];

const initialQueue: DownloadJob[] = [
  {
    id: "job-1",
    source: "Hugging Face",
    link: "https://huggingface.co/stabilityai/sd_xl_base_1.0",
    category: "Checkpoint",
    target: "checkpoints",
    status: "downloading",
    progress: 68,
    speed: "32 MB/s via aria2c",
    eta: "1m",
  },
  {
    id: "job-2",
    source: "Civitai",
    link: "https://civitai.com/models/12345/custom-lora",
    category: "LoRA",
    target: "loras",
    status: "queued",
    progress: 0,
    eta: "pending",
  },
];

export default function Models() {
  const [models] = useState<InstalledModel[]>(seededModels);
  const [downloadQueue, setDownloadQueue] = useState<DownloadJob[]>(initialQueue);
  const [hfLinks, setHfLinks] = useState("");
  const [civitaiLinks, setCivitaiLinks] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<ModelCategory>("Checkpoint");
  const [search, setSearch] = useState("");
  const [targetFolder, setTargetFolder] = useState("checkpoints");

  const filteredModels = useMemo(() => {
    const term = search.toLowerCase();
    return models.filter((m) => {
      const matchesSearch =
        !term ||
        m.name.toLowerCase().includes(term) ||
        m.location.toLowerCase().includes(term) ||
        (m.notes?.toLowerCase().includes(term) ?? false);
      return matchesSearch && (selectedCategory ? m.category === selectedCategory : true);
    });
  }, [models, search, selectedCategory]);

  const addDownloads = (links: string, source: DownloadSource) => {
    const entries = links
      .split("\n")
      .map((link) => link.trim())
      .filter(Boolean);

    if (!entries.length) return;

    const newJobs: DownloadJob[] = entries.map((link, idx) => ({
      id: `${source}-${Date.now()}-${idx}`,
      source,
      link,
      category: selectedCategory,
      target: targetFolder,
      status: "queued",
      progress: 0,
      eta: "pending",
    }));

    setDownloadQueue((prev) => [...newJobs, ...prev]);
    if (source === "Hugging Face") setHfLinks("");
    if (source === "Civitai") setCivitaiLinks("");
  };

  const markComplete = (id: string) => {
    setDownloadQueue((prev) =>
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
    setDownloadQueue((prev) => prev.filter((job) => job.id !== id));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Sparkles className="text-blue-600" size={24} />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Models & Checkpoints</h1>
            <p className="text-sm text-slate-600">
              Manage everything Sweet Tea feeds to ComfyUI: checkpoints, LoRAs, ControlNets, upscalers, and VLM assets.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">ComfyUI folders</CardTitle>
            <FolderOpen className="text-blue-500" size={18} />
          </CardHeader>
          <CardContent className="space-y-3">
            {comfyModelFolders.map((folder) => (
              <div key={folder.name} className="rounded-md border border-slate-200 p-3 bg-white">
                <div className="flex items-center justify-between text-sm font-medium text-slate-800">
                  <span>{folder.name}</span>
                  <span className="text-xs text-slate-500">{folder.path}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">{folder.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Download queue</CardTitle>
            <CardDescription>Hugging Face (aria2c) and Civitai downloads land in the proper Comfy folders.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {downloadQueue.map((job) => (
              <div key={job.id} className="rounded-md border border-slate-200 p-3 bg-white space-y-2">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <ArrowDownCircle size={16} className="text-blue-500" />
                      <span>{job.category}</span>
                    </div>
                    <p className="text-xs text-slate-500 break-all">{job.link}</p>
                    <p className="text-xs text-slate-500">{job.source} → {job.target}</p>
                  </div>
                  <div className="flex gap-2">
                    {job.status !== "completed" && (
                      <Button size="sm" variant="outline" onClick={() => markComplete(job.id)}>
                        Mark done
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => removeJob(job.id)}>
                      <Trash2 size={16} />
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
              <p className="text-sm text-slate-500">No downloads queued yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Quick facts</CardTitle>
            <CardDescription>Everything Sweet Tea expects for a single Comfy instance.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <div className="flex items-start gap-2">
              <Info size={16} className="text-blue-500 mt-0.5" />
              <p>
                This page replaces "engines"—assumes one Sweet Tea instance talking to one ComfyUI host.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Rocket size={16} className="text-green-600 mt-0.5" />
              <p>
                Use aria2c for fast multi-connection Hugging Face pulls, and civitaidownloader for versioned Civitai grabs.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <ExternalLink size={16} className="text-purple-600 mt-0.5" />
              <p>
                Drop direct links or model IDs; Sweet Tea will place files into the right ComfyUI directory for you.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add model downloads</CardTitle>
          <CardDescription>
            Paste one or more links. Each entry will be queued for the selected model type and target folder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select value={selectedCategory} onValueChange={(value) => setSelectedCategory(value as ModelCategory)}>
              <SelectTrigger>
                <SelectValue placeholder="Model type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Checkpoint">Checkpoint</SelectItem>
                <SelectItem value="LoRA">LoRA</SelectItem>
                <SelectItem value="ControlNet">ControlNet</SelectItem>
                <SelectItem value="Upscaler">Upscaler</SelectItem>
                <SelectItem value="VLM">VLM</SelectItem>
              </SelectContent>
            </Select>
            <Select value={targetFolder} onValueChange={setTargetFolder}>
              <SelectTrigger>
                <SelectValue placeholder="Target folder" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="checkpoints">checkpoints</SelectItem>
                <SelectItem value="loras">loras</SelectItem>
                <SelectItem value="controlnet">controlnet</SelectItem>
                <SelectItem value="upscale">upscale</SelectItem>
                <SelectItem value="vlm">vlm</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Link2 size={16} />
              <span>Links will be pulled with aria2c (HF) or civitaidownloader (Civitai).</span>
            </div>
          </div>

          <Tabs defaultValue="hf" className="w-full">
            <TabsList>
              <TabsTrigger value="hf">Hugging Face</TabsTrigger>
              <TabsTrigger value="civitai">Civitai</TabsTrigger>
            </TabsList>
            <TabsContent value="hf" className="space-y-2">
              <Textarea
                placeholder="https://huggingface.co/stabilityai/sd_xl_base_1.0\nhttps://huggingface.co/..."
                value={hfLinks}
                onChange={(e) => setHfLinks(e.target.value)}
                className="min-h-[120px]"
              />
              <div className="flex justify-end">
                <Button onClick={() => addDownloads(hfLinks, "Hugging Face")}>Queue Hugging Face downloads</Button>
              </div>
            </TabsContent>
            <TabsContent value="civitai" className="space-y-2">
              <Textarea
                placeholder="https://civitai.com/models/..."
                value={civitaiLinks}
                onChange={(e) => setCivitaiLinks(e.target.value)}
                className="min-h-[120px]"
              />
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => addDownloads(civitaiLinks, "Civitai")}>
                  Queue Civitai downloads
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Installed models</CardTitle>
          <CardDescription>Discover what is already available inside ComfyUI for this Sweet Tea instance.</CardDescription>
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
                <SelectItem value="Checkpoint">Checkpoint</SelectItem>
                <SelectItem value="LoRA">LoRA</SelectItem>
                <SelectItem value="ControlNet">ControlNet</SelectItem>
                <SelectItem value="Upscaler">Upscaler</SelectItem>
                <SelectItem value="VLM">VLM</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline">Refresh inventory</Button>
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
