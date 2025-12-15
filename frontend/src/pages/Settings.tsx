import { useState, useEffect } from "react";
import { api, Engine, ComfyLaunchConfig } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Loader2, Save, RefreshCw } from "lucide-react";

export default function Settings() {
    const [engines, setEngines] = useState<Engine[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Form state for the first (primary) engine
    const [formData, setFormData] = useState({
        name: "",
        base_url: "",
        output_dir: "",
        input_dir: "",
    });

    // ComfyUI Launch Config state
    const [launchConfig, setLaunchConfig] = useState<ComfyLaunchConfig | null>(null);
    const [comfyPath, setComfyPath] = useState("");
    const [launchArgs, setLaunchArgs] = useState("");
    const [savingLaunch, setSavingLaunch] = useState(false);

    useEffect(() => {
        loadEngines();
        loadLaunchConfig();
    }, []);

    const loadEngines = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.getEngines();
            setEngines(data);
            // Populate form with first engine
            if (data.length > 0) {
                const engine = data[0];
                setFormData({
                    name: engine.name,
                    base_url: engine.base_url,
                    output_dir: engine.output_dir,
                    input_dir: engine.input_dir,
                });
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load engines");
        } finally {
            setLoading(false);
        }
    };

    const loadLaunchConfig = async () => {
        try {
            const config = await api.getComfyUILaunchConfig();
            setLaunchConfig(config);
            setComfyPath(config.path || "");
            setLaunchArgs(config.args?.join(" ") || "");
        } catch (e) {
            console.warn("Failed to load ComfyUI launch config", e);
        }
    };

    const handleSave = async () => {
        if (engines.length === 0) return;

        setSaving(true);
        setError(null);
        setSuccess(null);

        try {
            await api.updateEngine(engines[0].id, formData);
            setSuccess("Settings saved successfully!");
            // Clear success message after 3 seconds
            setTimeout(() => setSuccess(null), 3000);
            // Reload to confirm changes
            await loadEngines();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to save settings");
        } finally {
            setSaving(false);
        }
    };

    const handleSaveLaunchConfig = async () => {
        setSavingLaunch(true);
        setError(null);
        setSuccess(null);

        try {
            const newConfig = await api.saveComfyUILaunchConfig({
                path: comfyPath || null,
                args: launchArgs || null,
            });
            setLaunchConfig(newConfig);
            setSuccess("ComfyUI launch settings saved!");
            setTimeout(() => setSuccess(null), 3000);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to save launch config");
        } finally {
            setSavingLaunch(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="h-full overflow-auto">
            <div className="max-w-2xl mx-auto p-6 space-y-8">
                <div>
                    <h1 className="text-2xl font-semibold">Settings</h1>
                    <p className="text-muted-foreground">Configure your ComfyUI connection and paths</p>
                </div>

                {error && (
                    <div className="flex items-center gap-2 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {success && (
                    <div className="flex items-center gap-2 p-4 bg-green-50 text-green-700 rounded-lg border border-green-200">
                        <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                        <span>{success}</span>
                    </div>
                )}

                <div className="space-y-6 bg-white rounded-xl p-6 border shadow-sm">
                    <h2 className="text-lg font-medium border-b pb-2">ComfyUI Engine</h2>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Engine Name</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="Local ComfyUI"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="base_url">ComfyUI URL</Label>
                            <Input
                                id="base_url"
                                value={formData.base_url}
                                onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                                placeholder="http://127.0.0.1:8188"
                            />
                            <p className="text-xs text-muted-foreground">
                                The URL where ComfyUI is running
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="output_dir">Output Directory</Label>
                            <Input
                                id="output_dir"
                                value={formData.output_dir}
                                onChange={(e) => setFormData({ ...formData, output_dir: e.target.value })}
                                placeholder="/path/to/ComfyUI/output"
                            />
                            <p className="text-xs text-muted-foreground">
                                Where ComfyUI saves generated images (e.g., C:\ComfyUI\output or /opt/ComfyUI/output)
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="input_dir">Input Directory</Label>
                            <Input
                                id="input_dir"
                                value={formData.input_dir}
                                onChange={(e) => setFormData({ ...formData, input_dir: e.target.value })}
                                placeholder="/path/to/ComfyUI/input"
                            />
                            <p className="text-xs text-muted-foreground">
                                Where ComfyUI looks for input images
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 pt-4 border-t">
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="w-4 h-4 mr-2" />
                            )}
                            Save Settings
                        </Button>
                        <Button variant="outline" onClick={loadEngines} disabled={loading}>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Reload
                        </Button>
                    </div>
                </div>

                {/* ComfyUI Launch Settings */}
                <div className="space-y-6 bg-white rounded-xl p-6 border shadow-sm">
                    <h2 className="text-lg font-medium border-b pb-2">ComfyUI Launch Settings</h2>
                    <p className="text-sm text-muted-foreground">
                        Configure how Sweet Tea Studio launches ComfyUI. Leave fields blank to use automatic detection.
                    </p>

                    {launchConfig && (
                        <div className="text-xs text-slate-500 bg-slate-50 p-3 rounded">
                            <span className="font-medium">Detection: </span>
                            {launchConfig.detection_method === "not_found" ? (
                                <span className="text-amber-600">Not found - configure path below</span>
                            ) : (
                                <span className="text-green-600">{launchConfig.detection_method}</span>
                            )}
                            {launchConfig.path && (
                                <div className="mt-1 font-mono text-[10px] truncate" title={launchConfig.path}>
                                    Current: {launchConfig.path}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="comfy_path">ComfyUI Folder Path</Label>
                            <Input
                                id="comfy_path"
                                value={comfyPath}
                                onChange={(e) => setComfyPath(e.target.value)}
                                placeholder="Leave blank to auto-detect"
                                className="font-mono text-sm"
                            />
                            <p className="text-xs text-muted-foreground">
                                Path to your ComfyUI installation folder (contains main.py)
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="launch_args">Launch Arguments</Label>
                            <Input
                                id="launch_args"
                                value={launchArgs}
                                onChange={(e) => setLaunchArgs(e.target.value)}
                                placeholder="e.g., --lowvram --preview-method auto"
                                className="font-mono text-sm"
                            />
                            <p className="text-xs text-muted-foreground">
                                Optional arguments passed to ComfyUI on launch (e.g., --listen --port 8188)
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 pt-4 border-t">
                        <Button onClick={handleSaveLaunchConfig} disabled={savingLaunch}>
                            {savingLaunch ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="w-4 h-4 mr-2" />
                            )}
                            Save Launch Settings
                        </Button>
                    </div>
                </div>

                <div className="text-xs text-muted-foreground p-4 bg-slate-50 rounded-lg">
                    <strong>Tip:</strong> You can also set paths via environment variables before starting the backend:
                    <ul className="list-disc ml-5 mt-2 space-y-1">
                        <li><code>SWEET_TEA_COMFYUI_OUTPUT_DIR=/path/to/output</code></li>
                        <li><code>SWEET_TEA_COMFYUI_INPUT_DIR=/path/to/input</code></li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
