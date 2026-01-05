import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";

// ============================================================================
// Theme Template Schema - This is the standardized format for custom themes
// ============================================================================

/**
 * Custom theme template that users can create and upload.
 * All color values should be valid CSS color values (hex, hsl, rgb, etc.)
 */
export interface CustomThemeTemplate {
    /** Unique identifier for the theme */
    id: string;
    /** Display name for the theme */
    name: string;
    /** Optional description */
    description?: string;
    /** Theme author */
    author?: string;
    /** Schema version for future compatibility */
    version: "1.0";

    /** Color definitions */
    colors: {
        /** Main background color */
        background: string;
        /** Main text color */
        foreground: string;

        /** Surface colors for cards and containers */
        surface: string;
        surfaceRaised?: string;
        surfaceOverlay?: string;

        /** Card component colors */
        card: string;
        cardForeground: string;

        /** Popover/dropdown colors */
        popover: string;
        popoverForeground: string;

        /** Primary brand color */
        primary: string;
        primaryForeground: string;

        /** Secondary accent color */
        secondary: string;
        secondaryForeground: string;

        /** Muted/subtle colors */
        muted: string;
        mutedForeground: string;

        /** Accent highlight color */
        accent: string;
        accentForeground: string;

        /** Destructive/error color */
        destructive: string;
        destructiveForeground: string;

        /** Border and input colors */
        border: string;
        input: string;
        ring: string;

        /** Interactive states (optional) */
        hover?: string;
        active?: string;
    };

    /** Optional additional customizations */
    radius?: string;

    /**
     * Optional hint used to decide whether Tailwind `dark:` utilities should be active.
     * If omitted, Sweet Tea will infer based on the background color when possible.
     */
    appearance?: "light" | "dark";
}

// Built-in theme definitions
const LIGHT_THEME: CustomThemeTemplate = {
    id: "light",
    name: "Light",
    version: "1.0",
    appearance: "light",
    colors: {
        background: "hsl(220 23% 97%)",
        foreground: "hsl(229 24% 18%)",
        surface: "hsl(0 0% 100%)",
        surfaceRaised: "hsl(0 0% 100%)",
        surfaceOverlay: "hsl(0 0% 100%)",
        card: "hsl(0 0% 100%)",
        cardForeground: "hsl(229 24% 18%)",
        popover: "hsl(0 0% 100%)",
        popoverForeground: "hsl(229 24% 18%)",
        primary: "hsl(256 84% 56%)",
        primaryForeground: "hsl(210 40% 98%)",
        secondary: "hsl(198 86% 51%)",
        secondaryForeground: "hsl(210 40% 98%)",
        muted: "hsl(225 18% 92%)",
        mutedForeground: "hsl(225 16% 46%)",
        accent: "hsl(43 96% 64%)",
        accentForeground: "hsl(229 24% 18%)",
        destructive: "hsl(0 79% 63%)",
        destructiveForeground: "hsl(210 40% 98%)",
        border: "hsl(223 15% 86%)",
        input: "hsl(223 15% 86%)",
        ring: "hsl(256 84% 56%)",
        hover: "hsl(225 18% 96%)",
        active: "hsl(225 18% 90%)",
    },
    radius: "0.75rem",
};

const DARK_THEME: CustomThemeTemplate = {
    id: "dark",
    name: "Dark",
    version: "1.0",
    appearance: "dark",
    colors: {
        background: "#050508",
        foreground: "#e2e8f0",
        surface: "#0b0c15",
        surfaceRaised: "#0f111a",
        surfaceOverlay: "#121428",
        card: "#0b0c15",
        cardForeground: "#e2e8f0",
        popover: "#0f111a",
        popoverForeground: "#e2e8f0",
        primary: "#3b82f6",
        primaryForeground: "#ffffff",
        secondary: "#60a5fa",
        secondaryForeground: "#050508",
        muted: "#111327",
        mutedForeground: "#94a3b8",
        accent: "#1e3a8a",
        accentForeground: "#e2e8f0",
        destructive: "#ef4444",
        destructiveForeground: "#ffffff",
        border: "#1e2235",
        input: "#1e2235",
        ring: "#3b82f6",
        hover: "#0f111a",
        active: "#121428",
    },
    radius: "0.75rem",
};

// ============================================================================
// Theme Context
// ============================================================================

export type ThemeMode = "light" | "dark" | "system" | "custom";
export type ResolvedTheme = "light" | "dark" | "custom";

interface ThemeContextType {
    /** Current theme mode selection */
    theme: ThemeMode;
    /** Resolved theme after system preference is applied */
    resolvedTheme: ResolvedTheme;
    /** Set the theme mode */
    setTheme: (theme: ThemeMode) => void;
    /** Currently active custom theme (if any) */
    customTheme: CustomThemeTemplate | null;
    /** All saved custom themes */
    customThemes: CustomThemeTemplate[];
    /** Import a custom theme from JSON */
    importTheme: (json: string) => { success: boolean; error?: string; theme?: CustomThemeTemplate };
    /** Export a theme to JSON string */
    exportTheme: (themeId?: string) => string;
    /** Apply a specific custom theme */
    applyCustomTheme: (themeId: string) => void;
    /** Delete a custom theme */
    deleteCustomTheme: (themeId: string) => void;
    /** Get the template for creating new themes */
    getThemeTemplate: () => string;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_MODE_KEY = "ds_theme";
const CUSTOM_THEMES_KEY = "ds_custom_themes";
const ACTIVE_CUSTOM_THEME_KEY = "ds_active_custom_theme";

function getSystemTheme(): "light" | "dark" {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyThemeToDocument(theme: CustomThemeTemplate) {
    const root = document.documentElement;
    const colors = theme.colors;

    // Apply all color variables
    root.style.setProperty("--color-background", colors.background);
    root.style.setProperty("--color-foreground", colors.foreground);
    root.style.setProperty("--color-surface", colors.surface);
    root.style.setProperty("--color-surface-raised", colors.surfaceRaised || colors.surface);
    root.style.setProperty("--color-surface-overlay", colors.surfaceOverlay || colors.surface);
    root.style.setProperty("--color-card", colors.card);
    root.style.setProperty("--color-card-foreground", colors.cardForeground);
    root.style.setProperty("--color-popover", colors.popover);
    root.style.setProperty("--color-popover-foreground", colors.popoverForeground);
    root.style.setProperty("--color-primary", colors.primary);
    root.style.setProperty("--color-primary-foreground", colors.primaryForeground);
    root.style.setProperty("--color-secondary", colors.secondary);
    root.style.setProperty("--color-secondary-foreground", colors.secondaryForeground);
    root.style.setProperty("--color-muted", colors.muted);
    root.style.setProperty("--color-muted-foreground", colors.mutedForeground);
    root.style.setProperty("--color-accent", colors.accent);
    root.style.setProperty("--color-accent-foreground", colors.accentForeground);
    root.style.setProperty("--color-destructive", colors.destructive);
    root.style.setProperty("--color-destructive-foreground", colors.destructiveForeground);
    root.style.setProperty("--color-border", colors.border);
    root.style.setProperty("--color-input", colors.input);
    root.style.setProperty("--color-ring", colors.ring);
    root.style.setProperty("--color-hover", colors.hover || colors.muted);
    root.style.setProperty("--color-active", colors.active || colors.muted);

    if (theme.radius) {
        root.style.setProperty("--radius", theme.radius);
    }
}

function clearCustomStyles() {
    const root = document.documentElement;
    const props = [
        "--color-background", "--color-foreground", "--color-surface", "--color-surface-raised",
        "--color-surface-overlay", "--color-card", "--color-card-foreground", "--color-popover",
        "--color-popover-foreground", "--color-primary", "--color-primary-foreground", "--color-secondary",
        "--color-secondary-foreground", "--color-muted", "--color-muted-foreground", "--color-accent",
        "--color-accent-foreground", "--color-destructive", "--color-destructive-foreground",
        "--color-border", "--color-input", "--color-ring", "--color-hover", "--color-active", "--radius"
    ];
    props.forEach(prop => root.style.removeProperty(prop));
}

function validateTheme(theme: unknown): theme is CustomThemeTemplate {
    if (!theme || typeof theme !== "object") return false;
    const t = theme as Record<string, unknown>;

    if (typeof t.id !== "string" || !t.id) return false;
    if (typeof t.name !== "string" || !t.name) return false;
    if (t.version !== "1.0") return false;
    if (!t.colors || typeof t.colors !== "object") return false;

    const colors = t.colors as Record<string, unknown>;
    const requiredColors = [
        "background", "foreground", "surface", "card", "cardForeground",
        "popover", "popoverForeground", "primary", "primaryForeground",
        "secondary", "secondaryForeground", "muted", "mutedForeground",
        "accent", "accentForeground", "destructive", "destructiveForeground",
        "border", "input", "ring"
    ];

    for (const color of requiredColors) {
        if (typeof colors[color] !== "string") return false;
    }

    if (t.appearance !== undefined && t.appearance !== "light" && t.appearance !== "dark") {
        return false;
    }

    return true;
}

function inferAppearanceFromBackground(background: string): "light" | "dark" | null {
    const raw = background.trim().toLowerCase();
    if (raw === "black") return "dark";
    if (raw === "white") return "light";

    const hex = raw.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
    if (hex) {
        const expanded = hex.length <= 4
            ? hex.split("").map((c) => c + c).join("")
            : hex;
        const r = parseInt(expanded.slice(0, 2), 16);
        const g = parseInt(expanded.slice(2, 4), 16);
        const b = parseInt(expanded.slice(4, 6), 16);
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        return luminance < 0.5 ? "dark" : "light";
    }

    const hslMatch = raw.match(/^hsla?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)%\s*(?:,\s*|\s+)([\d.]+)%/i);
    if (hslMatch) {
        const lightness = Number(hslMatch[3]);
        if (!Number.isFinite(lightness)) return null;
        return lightness < 50 ? "dark" : "light";
    }

    const rgbMatch = raw.match(/^rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)/i);
    if (rgbMatch) {
        const r = Number(rgbMatch[1]);
        const g = Number(rgbMatch[2]);
        const b = Number(rgbMatch[3]);
        if (![r, g, b].every(Number.isFinite)) return null;
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        return luminance < 0.5 ? "dark" : "light";
    }

    return null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<ThemeMode>(() => {
        if (typeof window === "undefined") return "light";
        const stored = localStorage.getItem(THEME_MODE_KEY);
        if (stored === "light" || stored === "dark" || stored === "system" || stored === "custom") {
            return stored;
        }
        return "light";
    });

    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

    const [customThemes, setCustomThemes] = useState<CustomThemeTemplate[]>(() => {
        if (typeof window === "undefined") return [];
        try {
            const stored = localStorage.getItem(CUSTOM_THEMES_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                return Array.isArray(parsed) ? parsed.filter(validateTheme) : [];
            }
        } catch {
            // Invalid JSON
        }
        return [];
    });

    const [customTheme, setCustomTheme] = useState<CustomThemeTemplate | null>(() => {
        if (typeof window === "undefined") return null;
        const activeId = localStorage.getItem(ACTIVE_CUSTOM_THEME_KEY);
        if (activeId) {
            try {
                const stored = localStorage.getItem(CUSTOM_THEMES_KEY);
                if (stored) {
                    const themes = JSON.parse(stored) as CustomThemeTemplate[];
                    return themes.find(t => t.id === activeId) || null;
                }
            } catch {
                // Invalid JSON
            }
        }
        return null;
    });

    // Apply theme based on current mode
    useEffect(() => {
        const root = document.documentElement;

        if (theme === "custom" && customTheme) {
            const inferred = inferAppearanceFromBackground(customTheme.colors.background);
            const appearance = inferred && customTheme.appearance && inferred !== customTheme.appearance
                ? inferred
                : (customTheme.appearance ?? inferred ?? "dark");
            root.classList.remove("light", "dark", "custom");
            root.classList.add("custom", appearance);
            applyThemeToDocument(customTheme);
            setResolvedTheme("custom");
        } else {
            clearCustomStyles();
            const resolved = theme === "system" ? getSystemTheme() : theme === "custom" ? "light" : theme;
            root.classList.remove("light", "dark", "custom");
            root.classList.add(resolved);
            setResolvedTheme(resolved);
        }
    }, [theme, customTheme]);

    // Listen for system theme changes
    useEffect(() => {
        if (theme !== "system") return;

        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = (e: MediaQueryListEvent) => {
            const newResolved = e.matches ? "dark" : "light";
            setResolvedTheme(newResolved);
            const root = document.documentElement;
            root.classList.remove("light", "dark");
            root.classList.add(newResolved);
        };

        mediaQuery.addEventListener("change", handler);
        return () => mediaQuery.removeEventListener("change", handler);
    }, [theme]);

    // Persist custom themes
    useEffect(() => {
        localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(customThemes));
    }, [customThemes]);

    const setTheme = useCallback((newTheme: ThemeMode) => {
        setThemeState(newTheme);
        localStorage.setItem(THEME_MODE_KEY, newTheme);
    }, []);

    const importTheme = useCallback((json: string): { success: boolean; error?: string; theme?: CustomThemeTemplate } => {
        try {
            const parsed = JSON.parse(json);

            if (!validateTheme(parsed)) {
                return { success: false, error: "Invalid theme format. Please check the template structure." };
            }

            // Check for duplicate ID
            const existingIndex = customThemes.findIndex(t => t.id === parsed.id);
            if (existingIndex >= 0) {
                // Replace existing theme
                const updated = [...customThemes];
                updated[existingIndex] = parsed;
                setCustomThemes(updated);
            } else {
                setCustomThemes([...customThemes, parsed]);
            }

            return { success: true, theme: parsed };
        } catch (e) {
            return { success: false, error: `Invalid JSON: ${e instanceof Error ? e.message : "Unknown error"}` };
        }
    }, [customThemes]);

    const exportTheme = useCallback((themeId?: string): string => {
        if (themeId === "light") return JSON.stringify(LIGHT_THEME, null, 2);
        if (themeId === "dark") return JSON.stringify(DARK_THEME, null, 2);

        const themeToExport = themeId
            ? customThemes.find(t => t.id === themeId)
            : customTheme;

        if (themeToExport) {
            return JSON.stringify(themeToExport, null, 2);
        }

        // Return light theme as default
        return JSON.stringify(LIGHT_THEME, null, 2);
    }, [customThemes, customTheme]);

    const applyCustomTheme = useCallback((themeId: string) => {
        const themeToApply = customThemes.find(t => t.id === themeId);
        if (themeToApply) {
            setCustomTheme(themeToApply);
            setTheme("custom");
            localStorage.setItem(ACTIVE_CUSTOM_THEME_KEY, themeId);
        }
    }, [customThemes, setTheme]);

    const deleteCustomTheme = useCallback((themeId: string) => {
        setCustomThemes(prev => prev.filter(t => t.id !== themeId));
        if (customTheme?.id === themeId) {
            setCustomTheme(null);
            localStorage.removeItem(ACTIVE_CUSTOM_THEME_KEY);
            setTheme("light");
        }
    }, [customTheme, setTheme]);

    const getThemeTemplate = useCallback((): string => {
        const template: CustomThemeTemplate = {
            id: "my-custom-theme",
            name: "My Custom Theme",
            description: "A custom theme for Sweet Tea Studio",
            author: "Your Name",
            version: "1.0",
            appearance: "light",
            colors: {
                background: "hsl(220 23% 97%)",
                foreground: "hsl(229 24% 18%)",
                surface: "hsl(0 0% 100%)",
                surfaceRaised: "hsl(0 0% 100%)",
                surfaceOverlay: "hsl(0 0% 100%)",
                card: "hsl(0 0% 100%)",
                cardForeground: "hsl(229 24% 18%)",
                popover: "hsl(0 0% 100%)",
                popoverForeground: "hsl(229 24% 18%)",
                primary: "hsl(256 84% 56%)",
                primaryForeground: "hsl(210 40% 98%)",
                secondary: "hsl(198 86% 51%)",
                secondaryForeground: "hsl(210 40% 98%)",
                muted: "hsl(225 18% 92%)",
                mutedForeground: "hsl(225 16% 46%)",
                accent: "hsl(43 96% 64%)",
                accentForeground: "hsl(229 24% 18%)",
                destructive: "hsl(0 79% 63%)",
                destructiveForeground: "hsl(210 40% 98%)",
                border: "hsl(223 15% 86%)",
                input: "hsl(223 15% 86%)",
                ring: "hsl(256 84% 56%)",
                hover: "hsl(225 18% 96%)",
                active: "hsl(225 18% 90%)",
            },
            radius: "0.75rem",
        };
        return JSON.stringify(template, null, 2);
    }, []);

    return (
        <ThemeContext.Provider value={{
            theme,
            resolvedTheme,
            setTheme,
            customTheme,
            customThemes,
            importTheme,
            exportTheme,
            applyCustomTheme,
            deleteCustomTheme,
            getThemeTemplate,
        }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
}

// Re-export Theme type for backwards compatibility
export type Theme = ThemeMode;
