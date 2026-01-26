import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Download, Monitor, Moon, Palette, Sun, Trash2, Upload } from "lucide-react";
import { useTheme, ThemeMode } from "@/lib/ThemeContext";

interface ThemeSettingsSectionProps {
  setError: (value: string | null) => void;
  setSuccess: (value: string | null) => void;
}

export function ThemeSettingsSection({ setError, setSuccess }: ThemeSettingsSectionProps) {
  const { theme, setTheme, customThemes, customTheme, importTheme, exportTheme, applyCustomTheme, deleteCustomTheme, getThemeTemplate } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const themeOptions: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: "Light", icon: <Sun className="w-4 h-4" /> },
    { value: "dark", label: "Dark", icon: <Moon className="w-4 h-4" /> },
    { value: "system", label: "System", icon: <Monitor className="w-4 h-4" /> },
    { value: "custom", label: "Custom", icon: <Palette className="w-4 h-4" /> },
  ];

  return (
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
                onClick={() => {
                  if (option.value === "custom") {
                    const idToApply = customTheme?.id ?? customThemes[0]?.id;
                    if (idToApply) {
                      applyCustomTheme(idToApply);
                    } else {
                      setTheme("custom");
                    }
                    return;
                  }
                  setTheme(option.value);
                }}
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
                        if (result.theme?.id) {
                          applyCustomTheme(result.theme.id);
                        }
                        setSuccess(`Theme "${result.theme?.name}" imported and applied!`);
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
  );
}
