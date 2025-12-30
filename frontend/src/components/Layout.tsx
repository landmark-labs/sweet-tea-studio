import { useState, useEffect, useCallback } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { PlusCircle, Settings, Library, Image as ImageIcon, GitBranch, ChevronLeft, ChevronRight, HardDrive, FolderOpen, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UndoRedoBar } from "@/components/UndoRedoBar";
import { ConnectionIndicator } from "@/components/ConnectionIndicator";
import { LemonBadge } from "@/components/icons/LemonBadge";
import { labels } from "@/ui/labels";
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
import { ConnectionBanner } from "@/components/ConnectionBanner";
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

  // Persisted Panel States
  const [feedOpen, setFeedOpen] = useState(() => localStorage.getItem("ds_feed_open") !== "false");
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
      // Backend will restart, page should reconnect automatically
    } catch (e) {
      // Expected - backend exits before response completes
      console.log("Backend restarting...");
    }
    // Keep spinning for a moment as backend restarts
    setTimeout(() => setIsRestarting(false), 3000);
  };

  return (
    <div className="flex h-screen w-screen bg-gradient-to-br from-background via-surface to-muted text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "border-r border-border/70 bg-blue-50/80 backdrop-blur flex flex-col transition-all duration-300 shadow-sm",
          collapsed ? "w-16" : "w-56"
        )}
      >
        <div className={cn("p-4 border-b border-border/70 flex items-center relative", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed ? (
            <div>
              <h1 className="flex items-baseline gap-1 text-xl font-semibold leading-none whitespace-nowrap">
                <span className="bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
                  sweet tea
                </span>
                <span className="relative inline-flex items-center justify-center text-foreground ml-0 -mt-[15px]">
                  <LemonBadge className="absolute h-[64px] w-[102px] left-1/2 top-1/2 -translate-y-1/2 -translate-x-[calc(50%+8px)]" />
                  <span className="relative z-10 text-sm font-semibold px-2">studio</span>
                </span>
              </h1>
              <p className="text-[10px] text-muted-foreground whitespace-nowrap">a creative workspace</p>
            </div>
          ) : (
            <div className="absolute left-[calc(50%-5px)] top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
              <LemonBadge className="h-[36px] w-[58px]" />
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "rounded-full transition-all",
              collapsed
                ? "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 hover:bg-transparent text-slate-700 font-bold"
                : "h-8 w-8"
            )}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronRight size={18} strokeWidth={3} /> : <ChevronLeft size={16} />}
          </Button>
        </div>
        <nav className="flex-1 p-3 overflow-x-hidden flex flex-col gap-3">
          <div className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all border border-transparent",
                    isActive
                      ? "bg-primary/10 text-primary border-primary/20 shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
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
                "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all border border-transparent",
                !collapsed && "flex-1",
                isActive
                  ? "bg-primary/10 text-primary border-primary/20 shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
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
            className={cn("text-muted-foreground hover:text-foreground hover:bg-muted/60", collapsed ? "h-9 w-full" : "h-9 w-9")}
            onClick={handleRestartBackend}
            disabled={isRestarting}
            title="restart backend"
          >
            <RefreshCw size={18} className={isRestarting ? "animate-spin" : ""} />
          </Button>
        </div>
      </aside>
      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gradient-to-b from-surface/50 to-background">
        <div className="w-full h-full flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 flex-none border-b border-border/50 bg-blue-50/80">
            {/* Left: Connection Indicator + ComfyUI Control */}
            <div className="flex items-center gap-3">
              <ConnectionIndicator />
              <ComfyUIControl />
            </div>

            {/* Right: Toggle Buttons & UndoRedo */}
            <div className="flex items-center gap-3">
              {/* Toggle Buttons Group */}
              <div className="flex items-center gap-2 mr-4">
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("text-xs transition-colors", feedOpen ? "bg-blue-500 text-white hover:bg-blue-600 hover:text-white border-blue-600" : "text-slate-500 bg-slate-100 hover:bg-slate-200")}
                  onClick={() => setFeedOpen(!feedOpen)}
                >
                  generation feed
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("text-xs transition-colors", libraryOpen ? "bg-blue-500 text-white hover:bg-blue-600 hover:text-white border-blue-600" : "text-slate-500 bg-slate-100 hover:bg-slate-200")}
                  onClick={() => setLibraryOpen(!libraryOpen)}
                >
                  prompt library
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("text-xs transition-colors", perfHudOpen ? "bg-blue-500 text-white hover:bg-blue-600 hover:text-white border-blue-600" : "text-slate-500 bg-slate-100 hover:bg-slate-200")}
                  onClick={() => setPerfHudOpen(!perfHudOpen)}
                >
                  performance hud
                </Button>
              </div>

              <UndoRedoBar />
            </div>
          </div>
          <div className="flex-1 overflow-hidden relative">
            <Outlet context={{ feedOpen, setFeedOpen, libraryOpen, setLibraryOpen }} />
          </div>
        </div>
      </main>
      <ConnectionBanner />
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
        <div className="bg-white rounded-lg shadow-xl border overflow-hidden" style={{ maxWidth: '90vw' }}>
          <div className="p-2 bg-slate-100 border-b text-xs font-semibold cursor-move flex items-center justify-between">
            <span>generation feed</span>
            <button
              onClick={onFeedClose}
              className="p-0.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700"
              aria-label="Close generation feed"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <GenerationFeed
            items={generationFeed}
            onSelectPreview={() => { }}
            onGenerate={generation?.handleGenerate}
          />
        </div>
      </DraggablePanel>

      {/* Prompt Library Panel */}
      <DraggablePanel
        persistenceKey="ds_library_pos"
        defaultPosition={{ x: 100, y: 100 }}
        className={`z-50 ${libraryOpen ? "" : "hidden"}`}
      >
        <div className="h-[600px] w-[400px]">
          <PromptLibraryQuickPanel
            open={libraryOpen}
            prompts={prompts}
            onApply={generation?.applyPrompt || (() => { })}
            onSearchChange={setPromptSearch}
            onSearchSubmit={generation?.loadPromptLibrary || (() => { })}
            searchValue={promptSearch}
            onClose={onLibraryClose}
          />
        </div>
      </DraggablePanel>
    </>
  );
}
