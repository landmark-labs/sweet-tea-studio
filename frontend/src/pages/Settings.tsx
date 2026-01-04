import { useState, useEffect, useRef } from "react";
import { api, Engine, ComfyLaunchConfig, ApiKeysSettings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Loader2, Save, RefreshCw, Eye, EyeOff, Database, Sun, Moon, Monitor, Upload, Download, Trash2, Palette } from "lucide-react";
import { useTheme, ThemeMode } from "@/lib/ThemeContext";

export default function Settings() {
    const { theme, setTheme, customThemes, customTheme, importTheme, exportTheme, applyCustomTheme, deleteCustomTheme, getThemeTemplate } = useTheme();
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

    // API Keys state
    const [apiKeys, setApiKeys] = useState<ApiKeysSettings | null>(null);
    const [apiKeysForm, setApiKeysForm] = useState({
        civitai_api_key: "",
        rule34_api_key: "",
        rule34_user_id: "",
    });
    const [savingApiKeys, setSavingApiKeys] = useState(false);
    const [showCivitaiKey, setShowCivitaiKey] = useState(false);
    const [showRule34Key, setShowRule34Key] = useState(false);
    const [isExportingDb, setIsExportingDb] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const themeOptions: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
        { value: "light", label: "Light", icon: <Sun className="w-4 h-4" /> },
        { value: "dark", label: "Dark", icon: <Moon className="w-4 h-4" /> },
        { value: "system", label: "System", icon: <Monitor className="w-4 h-4" /> },
    ];

    useEffect(() => {
        loadEngines();
        loadLaunchConfig();
        loadApiKeys();
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

    const loadApiKeys = async () => {
        try {
            const keys = await api.getApiKeys();
            setApiKeys(keys);
            // Don't populate form - user will enter new values if they want to change
        } catch (e) {
            console.warn("Failed to load API keys", e);
        }
    };

    const handleSaveApiKeys = async () => {
        setSavingApiKeys(true);
        setError(null);
        setSuccess(null);

        try {
            const updated = await api.updateApiKeys(apiKeysForm);
            setApiKeys(updated);
            // Clear form after save
            setApiKeysForm({
                civitai_api_key: "",
                rule34_api_key: "",
                rule34_user_id: "",
            });
            setSuccess("API keys saved!");
            setTimeout(() => setSuccess(null), 3000);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to save API keys");
        } finally {
            setSavingApiKeys(false);
        }
    };

    const handleExportProfile = async () => {
        setIsExportingDb(true);
        try {
            const result = await api.exportDatabaseToComfy();
            setSuccess(`Profile exported to ${result.path}`);
            setTimeout(() => setSuccess(null), 5000);
        } catch (e) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setError((e as any)?.message || "Failed to export profile");
        } finally {
            setIsExportingDb(false);
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
                    <h1 className="text-2xl font-semibold">settings</h1>
                    <p className="text-muted-foreground">configure your comfyui connection and paths</p>
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

                <div className="space-y-6 bg-card rounded-xl p-6 border shadow-sm">
                    <h2 className="text-lg font-medium border-b pb-2">comfyui engine</h2>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">engine name</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="Local ComfyUI"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="base_url">comfyui url</Label>
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
                            <Label htmlFor="output_dir">output directory</Label>
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
                            <Label htmlFor="input_dir">input directory</Label>
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
                            save settings
                        </Button>
                        <Button variant="outline" onClick={loadEngines} disabled={loading}>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            reload
                        </Button>
                    </div>
                </div>

                {/* ComfyUI Launch Settings */}
                <div className="space-y-6 bg-card rounded-xl p-6 border shadow-sm">
                    <h2 className="text-lg font-medium border-b pb-2">comfyui launch settings</h2>
                    <p className="text-sm text-muted-foreground">
                        configure how sweet tea studio launches comfyui. leave fields blank to use automatic detection.
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
                            <Label htmlFor="comfy_path">comfyui folder path</Label>
                            <Input
                                id="comfy_path"
                                value={comfyPath}
                                onChange={(e) => setComfyPath(e.target.value)}
                                placeholder="leave blank to auto-detect"
                                className="font-mono text-sm"
                            />
                            <p className="text-xs text-muted-foreground">
                                Path to your ComfyUI installation folder (contains main.py)
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="launch_args">launch arguments</Label>
                            <Input
                                id="launch_args"
                                value={launchArgs}
                                onChange={(e) => setLaunchArgs(e.target.value)}
                                placeholder="e.g., --lowvram --preview-method auto"
                                className="font-mono text-sm"
                            />
                            <p className="text-xs text-muted-foreground">
                                optional arguments passed to comfyui on launch (e.g., --listen --port 8188)
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
                            save launch settings
                        </Button>
                    </div>
                </div>

                {/* API Keys */}
                <div className="space-y-6 bg-card rounded-xl p-6 border shadow-sm">
                    <h2 className="text-lg font-medium border-b pb-2">api keys</h2>
                    <p className="text-sm text-muted-foreground">
                        configure api keys for external services. keys are stored in the database and override environment variables.
                    </p>

                    <div className="space-y-4">
                        {/* Civitai API Key */}
                        <div className="space-y-2">
                            <Label htmlFor="civitai_api_key">civitai api key</Label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Input
                                        id="civitai_api_key"
                                        type={showCivitaiKey ? "text" : "password"}
                                        value={apiKeysForm.civitai_api_key}
                                        onChange={(e) => setApiKeysForm({ ...apiKeysForm, civitai_api_key: e.target.value })}
                                        placeholder={apiKeys?.civitai_api_key.is_set ? `current: ${apiKeys.civitai_api_key.value}` : "enter api key"}
                                        className="font-mono text-sm pr-10"
                                    />
                                    <button
                                        type="button"
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                        onClick={() => setShowCivitaiKey(!showCivitaiKey)}
                                    >
                                        {showCivitaiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                required for downloading models from civitai.{" "}
                                <a href="https://civitai.com/user/account" target="_blank" rel="noreferrer" className="text-blue-600 underline">
                                    get your key
                                </a>
                                {apiKeys?.civitai_api_key.is_set && (
                                    <span className="ml-2 text-green-600">
                                        ✓ Set via {apiKeys.civitai_api_key.source}
                                    </span>
                                )}
                            </p>
                        </div>

                        {/* Rule34 API Key */}
                        <div className="space-y-2">
                            <Label htmlFor="rule34_api_key">rule34 api key</Label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Input
                                        id="rule34_api_key"
                                        type={showRule34Key ? "text" : "password"}
                                        value={apiKeysForm.rule34_api_key}
                                        onChange={(e) => setApiKeysForm({ ...apiKeysForm, rule34_api_key: e.target.value })}
                                        placeholder={apiKeys?.rule34_api_key.is_set ? `current: ${apiKeys.rule34_api_key.value}` : "enter api key"}
                                        className="font-mono text-sm pr-10"
                                    />
                                    <button
                                        type="button"
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                        onClick={() => setShowRule34Key(!showRule34Key)}
                                    >
                                        {showRule34Key ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                            {apiKeys?.rule34_api_key.is_set && (
                                <p className="text-xs text-green-600">
                                    ✓ Set via {apiKeys.rule34_api_key.source}
                                </p>
                            )}
                        </div>

                        {/* Rule34 User ID */}
                        <div className="space-y-2">
                            <Label htmlFor="rule34_user_id">rule34 user id</Label>
                            <Input
                                id="rule34_user_id"
                                value={apiKeysForm.rule34_user_id}
                                onChange={(e) => setApiKeysForm({ ...apiKeysForm, rule34_user_id: e.target.value })}
                                placeholder={apiKeys?.rule34_user_id.is_set ? `current: ${apiKeys.rule34_user_id.value}` : "enter user id"}
                                className="font-mono text-sm"
                            />
                            <p className="text-xs text-muted-foreground">
                                optional credentials for rule34 tag autocomplete.{" "}
                                <a href="https://rule34.xxx/index.php?page=account&s=options" target="_blank" rel="noreferrer" className="text-blue-600 underline">
                                    get your credentials
                                </a>
                                {apiKeys?.rule34_user_id.is_set && (
                                    <span className="ml-2 text-green-600">
                                        ✓ Set via {apiKeys.rule34_user_id.source}
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 pt-4 border-t">
                        <Button onClick={handleSaveApiKeys} disabled={savingApiKeys}>
                            {savingApiKeys ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="w-4 h-4 mr-2" />
                            )}
                            save api keys
                        </Button>
                        <span className="text-xs text-muted-foreground">
                            leave fields empty to keep current values
                        </span>
                    </div>
                </div>

                {/* Profile Export */}
                <div className="space-y-6 bg-card rounded-xl p-6 border shadow-sm">
                    <h2 className="text-lg font-medium border-b pb-2">profile export</h2>
                    <p className="text-sm text-muted-foreground">
                        export your profile database for backup or transfer to another installation.
                        this creates a compressed zip file with your settings, workflows, and generation history.
                    </p>

                    <div className="flex items-center gap-3">
                        <Button onClick={handleExportProfile} disabled={isExportingDb}>
                            {isExportingDb ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <Database className="w-4 h-4 mr-2" />
                            )}
                            export profile
                        </Button>
                    </div>
                </div>

                {/* Appearance Settings */}
                <div className="space-y-6 bg-card rounded-xl p-6 border shadow-sm">
                    <h2 className="text-lg font-medium border-b pb-2">appearance</h2>
                    <p className="text-sm text-muted-foreground">
                        customize the look and feel of sweet tea studio.
                    </p>

                    <div className="space-y-6">
                        {/* Built-in theme selection */}
                        <div className="space-y-2">
                            <Label>theme</Label>
                            <div className="flex gap-2 flex-wrap">
                                {themeOptions.map((option) => (
                                    <button
                                        key={option.value}
                                        onClick={() => setTheme(option.value)}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${theme === option.value
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "bg-card hover:bg-muted border-border"
                                            }`}
                                    >
                                        {option.icon}
                                        <span className="text-sm font-medium">{option.label}</span>
                                    </button>
                                ))}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {theme === "system"
                                    ? "Automatically matches your operating system's theme preference."
                                    : theme === "custom"
                                        ? `Using custom theme: ${customTheme?.name || "Unknown"}`
                                        : `Using ${theme} mode.`}
                            </p>
                        </div>

                        {/* Custom Themes Section */}
                        <div className="space-y-4 pt-4 border-t">
                            <div className="flex items-center gap-2">
                                <Palette className="w-4 h-4 text-muted-foreground" />
                                <Label className="text-base">custom themes</Label>
                            </div>

                            {/* Saved custom themes list */}
                            {customThemes.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-xs text-muted-foreground">your saved themes:</p>
                                    <div className="grid gap-2">
                                        {customThemes.map((t) => (
                                            <div
                                                key={t.id}
                                                className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${theme === "custom" && customTheme?.id === t.id
                                                    ? "bg-primary/10 border-primary"
                                                    : "bg-muted/50 border-border hover:border-muted-foreground"
                                                    }`}
                                            >
                                                <div className="flex-1">
                                                    <div className="font-medium text-sm">{t.name}</div>
                                                    {t.description && (
                                                        <div className="text-xs text-muted-foreground">{t.description}</div>
                                                    )}
                                                    {t.author && (
                                                        <div className="text-xs text-muted-foreground">by {t.author}</div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant={theme === "custom" && customTheme?.id === t.id ? "default" : "outline"}
                                                        onClick={() => applyCustomTheme(t.id)}
                                                    >
                                                        {theme === "custom" && customTheme?.id === t.id ? "Active" : "Apply"}
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => {
                                                            const json = exportTheme(t.id);
                                                            const blob = new Blob([json], { type: "application/json" });
                                                            const url = URL.createObjectURL(blob);
                                                            const a = document.createElement("a");
                                                            a.href = url;
                                                            a.download = `${t.id}-theme.json`;
                                                            a.click();
                                                            URL.revokeObjectURL(url);
                                                        }}
                                                    >
                                                        <Download className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-destructive hover:text-destructive"
                                                        onClick={() => deleteCustomTheme(t.id)}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Import theme file */}
                            <div className="space-y-2">
                                <Label htmlFor="theme-upload">import theme</Label>
                                <div className="flex gap-2">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        id="theme-upload"
                                        accept=".json"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                const reader = new FileReader();
                                                reader.onload = (event) => {
                                                    const json = event.target?.result as string;
                                                    const result = importTheme(json);
                                                    if (result.success) {
                                                        setSuccess(`Theme "${result.theme?.name}" imported successfully!`);
                                                        setTimeout(() => setSuccess(null), 3000);
                                                    } else {
                                                        setError(result.error || "Failed to import theme");
                                                    }
                                                };
                                                reader.readAsText(file);
                                            }
                                            e.target.value = "";
                                        }}
                                    />
                                    <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                                        <Upload className="w-4 h-4 mr-2" />
                                        upload theme file (.json)
                                    </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    upload a .json theme file to add a custom color scheme
                                </p>
                            </div>

                            {/* Download template */}
                            <div className="space-y-2">
                                <Label>create your own theme</Label>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        const template = getThemeTemplate();
                                        const blob = new Blob([template], { type: "application/json" });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement("a");
                                        a.href = url;
                                        a.download = "sweet-tea-theme-template.json";
                                        a.click();
                                        URL.revokeObjectURL(url);
                                    }}
                                >
                                    <Download className="w-4 h-4 mr-2" />
                                    download theme template (.json)
                                </Button>
                                <p className="text-xs text-muted-foreground">
                                    download a template json file with all customizable color tokens
                                </p>
                            </div>

                            {/* Export built-in themes */}
                            <div className="space-y-2">
                                <Label>export built-in themes</Label>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            const json = exportTheme("light");
                                            const blob = new Blob([json], { type: "application/json" });
                                            const url = URL.createObjectURL(blob);
                                            const a = document.createElement("a");
                                            a.href = url;
                                            a.download = "light-theme.json";
                                            a.click();
                                            URL.revokeObjectURL(url);
                                        }}
                                    >
                                        <Sun className="w-4 h-4 mr-2" />
                                        export light
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            const json = exportTheme("dark");
                                            const blob = new Blob([json], { type: "application/json" });
                                            const url = URL.createObjectURL(blob);
                                            const a = document.createElement("a");
                                            a.href = url;
                                            a.download = "dark-theme.json";
                                            a.click();
                                            URL.revokeObjectURL(url);
                                        }}
                                    >
                                        <Moon className="w-4 h-4 mr-2" />
                                        export dark
                                    </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    export built-in themes as a starting point for customization
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="text-xs text-muted-foreground p-4 bg-muted rounded-lg">
                    <strong>Tip:</strong> You can also set paths via environment variables before starting the backend:
                    <ul className="list-disc ml-5 mt-2 space-y-1">
                        <li><code>SWEET_TEA_COMFYUI_OUTPUT_DIR=/path/to/output</code></li>
                        <li><code>SWEET_TEA_COMFYUI_INPUT_DIR=/path/to/input</code></li>
                        <li><code>CIVITAI_API_KEY=your_api_key</code></li>
                        <li><code>SWEET_TEA_RULE34_API_KEY=your_api_key</code></li>
                        <li><code>SWEET_TEA_RULE34_USER_ID=your_user_id</code></li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
