import { useState, useEffect } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { PlusCircle, Settings, Library, Image as ImageIcon, GitBranch, ChevronLeft, ChevronRight, HardDrive, FolderOpen, Database, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UndoRedoBar } from "@/components/UndoRedoBar";
import { ConnectionIndicator } from "@/components/ConnectionIndicator";
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
import { useGeneration } from "@/lib/GenerationContext";

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [isExportingDb, setIsExportingDb] = useState(false);

  // Persisted Panel States
  const [feedOpen, setFeedOpen] = useState(() => localStorage.getItem("ds_feed_open") !== "false");
  const [libraryOpen, setLibraryOpen] = useState(() => localStorage.getItem("ds_library_open") !== "false");
  const [perfHudOpen, setPerfHudOpen] = useState(() => localStorage.getItem("ds_perf_hud_open") === "true");

  // Persist effects
  useEffect(() => localStorage.setItem("ds_feed_open", String(feedOpen)), [feedOpen]);
  useEffect(() => localStorage.setItem("ds_library_open", String(libraryOpen)), [libraryOpen]);
  useEffect(() => localStorage.setItem("ds_perf_hud_open", String(perfHudOpen)), [perfHudOpen]);

  const handleExportDatabase = async () => {
    setIsExportingDb(true);
    try {
      const result = await api.exportDatabaseToComfy();
      alert(`exported profile.db to ${result.path}`);
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alert((e as any)?.message || "Failed to export database");
    } finally {
      setIsExportingDb(false);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-gradient-to-br from-background via-surface to-muted text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "border-r border-border/70 bg-surface/95 backdrop-blur flex flex-col transition-all duration-300 shadow-sm",
          collapsed ? "w-16" : "w-72"
        )}
      >
        <div className={cn("p-4 border-b border-border/70 flex items-center", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <div>
              <div className="flex items-baseline gap-2">
                <h1 className="text-xl font-semibold bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent whitespace-nowrap">
                  sweet tea
                </h1>
                <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">studio</span>
              </div>
              <p className="text-xs text-muted-foreground whitespace-nowrap">a creative workspace</p>
            </div>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </Button>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-x-hidden">
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
        </nav>
        <div className="p-3 border-t border-border/70">
          <div
            className={cn(
              "flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/70 rounded-xl cursor-pointer",
              collapsed && "justify-center px-2"
            )}
          >
            <Settings size={20} />
            {!collapsed && <span>{labels.nav.settings}</span>}
          </div>
        </div>
      </aside>
      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gradient-to-b from-surface/50 to-background">
        <div className="w-full h-full flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 flex-none border-b border-border/50 bg-surface/50">
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

              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={handleExportDatabase}
                disabled={isExportingDb}
                title="vacuum profile.db and drop a zip into ComfyUI/sweet_tea"
              >
                {isExportingDb ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Database className="w-4 h-4 mr-2" />
                )}
                save db to comfy
              </Button>

              <UndoRedoBar />
            </div>
          </div>
          <div className="flex-1 overflow-hidden relative">
            <Outlet context={{ feedOpen, setFeedOpen, libraryOpen, setLibraryOpen }} />
          </div>
        </div>
      </main>
      <ConnectionBanner />
      <StatusBar />
      <PerformanceHUD visible={perfHudOpen} />

      {/* Global Floating Panels */}
      <GlobalFloatingPanels feedOpen={feedOpen} libraryOpen={libraryOpen} />
    </div>
  );
}

// Separate component for panels to use hooks
function GlobalFloatingPanels({ feedOpen, libraryOpen }: { feedOpen: boolean; libraryOpen: boolean }) {
  const { generationFeed } = useGenerationFeedStore();
  const { prompts, searchQuery: promptSearch, setSearchQuery: setPromptSearch } = usePromptLibraryStore();
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
          <div className="p-2 bg-slate-100 border-b text-xs font-semibold cursor-move">Generation Feed</div>
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
            onClose={() => { }}
          />
        </div>
      </DraggablePanel>
    </>
  );
}
