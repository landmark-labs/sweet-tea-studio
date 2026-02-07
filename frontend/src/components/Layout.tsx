import { useState, useEffect, useCallback } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { PlusCircle, Settings, Library, Image as ImageIcon, GitBranch, ChevronLeft, ChevronRight, HardDrive, FolderOpen, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UndoRedoBar } from "@/components/UndoRedoBar";
import { ConnectionIndicator } from "@/components/ConnectionIndicator";
import brandingLogo from "@/../assets/sweet_tea_studio_branding.png";
import brandingLogoDark from "@/../assets/sweet_tea_studio_branding_darkmode.png";
import lemonBadgeLogo from "@/../assets/sweet_tea_studio_lemon_badge.png";
import { labels } from "@/ui/labels";
import { useTheme } from "@/lib/ThemeContext";
import { api } from "@/lib/api";

const navItems = [
  { to: "/", label: labels.nav.generation, icon: PlusCircle },
  { to: "/projects", label: labels.nav.projects, icon: FolderOpen },
  { to: "/pipes", label: labels.nav.pipes, icon: GitBranch },
  { to: "/gallery", label: labels.nav.gallery, icon: ImageIcon },
  { to: "/library", label: labels.nav.library, icon: Library },
  { to: "/models", label: labels.nav.models, icon: HardDrive },
];
import { PerformanceHUD } from "@/components/PerformanceHUD";
import { StatusBar } from "@/components/StatusBar";

import { ComfyUIControl } from "@/components/ComfyUIControl";
import { DraggablePanel } from "@/components/ui/draggable-panel";
import { GenerationFeed } from "@/components/GenerationFeed";
import { PromptLibraryQuickPanel } from "@/components/PromptLibraryQuickPanel";
import { useGenerationFeedStore, usePromptLibraryStore } from "@/lib/stores/promptDataStore";
import { useStatusPollingStore } from "@/lib/stores/statusPollingStore";
import { useGeneration } from "@/lib/GenerationContext";
import { initClientDiagnostics } from "@/lib/clientDiagnostics";
import { CanvasSidebar } from "@/components/CanvasSidebar";

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const { resolvedTheme } = useTheme();

  // Determine if dark mode is active (dark theme or custom with dark appearance)
  const isDarkMode = resolvedTheme === "dark" || (resolvedTheme === "custom" && document.documentElement.classList.contains("dark"));
  const currentBrandingLogo = isDarkMode ? brandingLogoDark : brandingLogo;

  // Persisted Panel States
  const [feedOpen, setFeedOpen] = useState(() => localStorage.getItem("ds_feed_open") !== "false");
  const [paletteOpen, setPaletteOpen] = useState(() => localStorage.getItem("ds_palette_open") === "true");
  const [libraryOpen, setLibraryOpen] = useState(() => localStorage.getItem("ds_library_open") !== "false");
  const [perfHudOpen, setPerfHudOpen] = useState(() => localStorage.getItem("ds_perf_hud_open") === "true");

  // Persist effects
  // Use selector to only re-render when clearPreviewBlobs changes (very rare)
  const clearPreviewBlobs = useGenerationFeedStore(useCallback(state => state.clearPreviewBlobs, []));

  useEffect(() => localStorage.setItem("ds_feed_open", String(feedOpen)), [feedOpen]);
  useEffect(() => {
    if (!feedOpen) {
      clearPreviewBlobs();
    }
  }, [feedOpen, clearPreviewBlobs]);
  useEffect(() => localStorage.setItem("ds_palette_open", String(paletteOpen)), [paletteOpen]);
  useEffect(() => localStorage.setItem("ds_library_open", String(libraryOpen)), [libraryOpen]);
  useEffect(() => localStorage.setItem("ds_perf_hud_open", String(perfHudOpen)), [perfHudOpen]);
  useEffect(() => {
    initClientDiagnostics();
  }, []);
  const startStatusPolling = useStatusPollingStore(useCallback(state => state.startPolling, []));
  const stopStatusPolling = useStatusPollingStore(useCallback(state => state.stopPolling, []));
  useEffect(() => {
    startStatusPolling();
    return () => stopStatusPolling();
  }, [startStatusPolling, stopStatusPolling]);

  const handleRestartBackend = async () => {
    if (!confirm("Are you sure you want to restart the backend? This will temporarily disconnect all services.")) {
      return;
    }
    setIsRestarting(true);
    try {
      await api.restartBackend();
      // Backend handles the restart gracefully with a delay, so we expect a success response.
    } catch (e: unknown) {
      console.error("Failed to restart backend:", e);
      if (e instanceof Error) {
        alert(`Failed to restart backend: ${e.message}`);
      } else {
        alert("Failed to restart backend: Unknown error");
      }
    } finally {
      // Keep spinning for a moment as backend restarts
      setTimeout(() => setIsRestarting(false), 3000);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "border-r border-border bg-surface flex flex-col transition-all duration-300",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <div className={cn("p-3 border-b border-border flex items-center relative min-h-[72px]", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed ? (
            <div className="w-full">
              <img
                src={currentBrandingLogo}
                alt="Sweet Tea Studio"
                className="h-14 w-auto max-w-full object-contain"
              />
            </div>
          ) : (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -ml-[3px] -mt-[3px] flex items-center justify-center">
              <img
                src={lemonBadgeLogo}
                alt="Sweet Tea Studio"
                className="h-10 w-auto object-contain"
              />
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "rounded-full border border-transparent transition-all",
              collapsed
                ? "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 hover:bg-transparent text-foreground/80 font-bold dark:!text-black"
                : "h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-hover dark:!text-white"
            )}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronRight size={18} strokeWidth={3} /> : <ChevronLeft size={16} />}
          </Button>
        </div>
        <nav className="flex-1 p-3 overflow-x-hidden flex flex-col gap-4">
          <div className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all border",
                    isActive
                      ? "bg-muted text-foreground border-border shadow-xs"
                      : "text-muted-foreground border-transparent hover:text-foreground hover:bg-hover",
                    collapsed && "justify-center px-2"
                  )
                }
              >
                <item.icon size={20} />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            ))}
          </div>
          <CanvasSidebar collapsed={collapsed} />
        </nav>
        <div className="border-t border-border/70">
          <StatusBar collapsed={collapsed} />
        </div>
        <div className={cn("border-t-0 border-border/70 flex items-center transition-all", collapsed ? "flex-col p-2 gap-2 pb-4" : "p-3 gap-2")}>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all border",
                !collapsed && "flex-1",
                isActive
                  ? "bg-muted text-foreground border-border shadow-xs"
                  : "text-muted-foreground border-transparent hover:text-foreground hover:bg-hover",
                collapsed && "justify-center px-2 w-full h-9"
              )
            }
          >
            <Settings size={20} />
            {!collapsed && <span>{labels.nav.settings}</span>}
          </NavLink>
          <Button
            variant="ghost"
            size="icon"
            className={cn("text-muted-foreground hover:text-foreground hover:bg-hover", collapsed ? "h-9 w-full" : "h-9 w-9")}
            onClick={handleRestartBackend}
            disabled={isRestarting}
            title="restart backend"
          >
            <RefreshCw size={18} className={isRestarting ? "animate-spin" : ""} />
          </Button>
        </div>
      </aside>
      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-background">
        <div className="w-full h-full flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 flex-none border-b border-border bg-surface">
            {/* Left: Connection Indicator + ComfyUI Control */}
            <div className="flex items-center gap-3">
              <ConnectionIndicator />
              <ComfyUIControl />
            </div>

            {/* Right: Toggle Buttons & UndoRedo */}
            <div className="flex items-center gap-3">
              {/* Toggle Buttons Group */}
              <div className="flex items-center gap-1.5 mr-3 rounded-lg border border-border bg-surface-raised p-1">
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-7 text-xs transition-colors",
                    paletteOpen
                      ? "bg-surface text-foreground border-border shadow-xs"
                      : "text-muted-foreground bg-transparent hover:bg-hover border-transparent"
                  )}
                  onClick={() => setPaletteOpen(!paletteOpen)}
                >
                  palette
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-7 text-xs transition-colors",
                    feedOpen
                      ? "bg-surface text-foreground border-border shadow-xs"
                      : "text-muted-foreground bg-transparent hover:bg-hover border-transparent"
                  )}
                  onClick={() => setFeedOpen(!feedOpen)}
                >
                  generation feed
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-7 text-xs transition-colors",
                    libraryOpen
                      ? "bg-surface text-foreground border-border shadow-xs"
                      : "text-muted-foreground bg-transparent hover:bg-hover border-transparent"
                  )}
                  onClick={() => setLibraryOpen(!libraryOpen)}
                >
                  prompt library
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-7 text-xs transition-colors",
                    perfHudOpen
                      ? "bg-surface text-foreground border-border shadow-xs"
                      : "text-muted-foreground bg-transparent hover:bg-hover border-transparent"
                  )}
                  onClick={() => setPerfHudOpen(!perfHudOpen)}
                >
                  performance hud
                </Button>
              </div>

              <UndoRedoBar />
            </div>
          </div>
          <div className="flex-1 overflow-hidden relative">
            <Outlet context={{ feedOpen, setFeedOpen, paletteOpen, setPaletteOpen, libraryOpen, setLibraryOpen }} />
          </div>
        </div>
      </main>

      <PerformanceHUD visible={perfHudOpen} onClose={() => setPerfHudOpen(false)} />

      {/* Global Floating Panels */}
      <GlobalFloatingPanels feedOpen={feedOpen} libraryOpen={libraryOpen} onFeedClose={() => setFeedOpen(false)} onLibraryClose={() => setLibraryOpen(false)} />
    </div>
  );
}

// Separate component for panels to use hooks
function GlobalFloatingPanels({ feedOpen, libraryOpen, onFeedClose, onLibraryClose }: { feedOpen: boolean; libraryOpen: boolean; onFeedClose: () => void; onLibraryClose: () => void }) {
  // Use selectors to minimize re-renders - only subscribe to what's actually used
  const generationFeed = useGenerationFeedStore(useCallback(state => state.generationFeed, []));
  const prompts = usePromptLibraryStore(useCallback(state => state.prompts, []));
  const promptSearch = usePromptLibraryStore(useCallback(state => state.searchQuery, []));
  const setPromptSearch = usePromptLibraryStore(useCallback(state => state.setSearchQuery, []));
  const generation = useGeneration();

  return (
    <>
      {/* Generation Feed Panel */}
      <DraggablePanel
        persistenceKey="ds_feed_pos"
        defaultPosition={{ x: 20, y: 100 }}
        className={`z-40 ${feedOpen ? "" : "hidden"}`}
      >
        <div className="shadow-md border border-border bg-surface/95 ring-1 ring-black/5 dark:ring-white/5 backdrop-blur overflow-hidden rounded-xl text-[11px] text-foreground">
          <div className="px-2.5 py-1.5 border-b border-border bg-surface-raised/80 text-xs font-semibold cursor-move flex items-center justify-between">
            <span>generation feed</span>
            <button
              onClick={onFeedClose}
              className="p-0.5 rounded hover:bg-hover text-muted-foreground hover:text-foreground"
              aria-label="Close generation feed"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-2">
            <GenerationFeed
              embedded
              items={generationFeed}
              onSelectPreview={() => { }}
              onGenerate={generation?.handleGenerate}
              isGenerating={generation?.isGenerating}
            />
          </div>
        </div>
      </DraggablePanel>

      {/* Prompt Library Panel */}
      <DraggablePanel
        persistenceKey="ds_library_pos"
        defaultPosition={{ x: 100, y: 100 }}
        className={`z-50 ${libraryOpen ? "" : "hidden"} w-80`}
      >
        <PromptLibraryQuickPanel
          open={libraryOpen}
          prompts={prompts}
          onApply={generation?.applyPrompt || (() => { })}
          onSearchChange={setPromptSearch}
          onSearchSubmit={generation?.loadPromptLibrary || (() => { })}
          searchValue={promptSearch}
          onClose={onLibraryClose}
        />
      </DraggablePanel>
    </>
  );
}
