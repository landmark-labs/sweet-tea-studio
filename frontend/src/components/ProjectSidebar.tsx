import { useEffect, useMemo, useState } from "react";
import { Folder, ChevronLeft, ChevronRight, Layers, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, Project } from "@/lib/api";

interface ProjectSidebarProps {
  selectedProjectId: number | null;
  onSelectProject: (id: number | null) => void;
  projects?: Project[];
  className?: string;
  // Folder selection props for file-explorer style navigation
  selectedFolder?: string | null;
  onSelectFolder?: (folder: string | null) => void;
  projectFolders?: string[];
}

export function ProjectSidebar({
  selectedProjectId,
  onSelectProject,
  projects: providedProjects,
  className,
  selectedFolder,
  onSelectFolder,
  projectFolders = []
}: ProjectSidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem("project_sidebar_collapsed");
    return saved !== null ? saved === "true" : true;
  });
  const [projects, setProjects] = useState<Project[]>(providedProjects || []);

  useEffect(() => {
    localStorage.setItem("project_sidebar_collapsed", String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (providedProjects) {
      setProjects(providedProjects);
      return;
    }
    const loadProjects = async () => {
      try {
        const data = await api.getProjects();
        setProjects(data);
      } catch (err) {
        console.error("Failed to load projects", err);
      }
    };
    loadProjects();
  }, [providedProjects]);

  const draftsProject = useMemo(() => projects.find((p) => p.slug === "drafts"), [projects]);
  const otherProjects = useMemo(() => projects.filter((p) => p.slug !== "drafts"), [projects]);

  return (
    <div
      className={cn(
        "relative border-r bg-card transition-all duration-300 flex flex-col",
        collapsed ? "w-12" : "w-64",
        className
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute -right-3 top-4 h-6 w-6 rounded-full border bg-background shadow-sm z-10"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </Button>

      <div className="p-2 flex items-center justify-between border-b h-14">
        {!collapsed && <span className="font-semibold text-foreground">projects</span>}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          <Button
            variant={selectedProjectId === null ? "secondary" : "ghost"}
            className={cn("w-full justify-start", collapsed ? "px-2" : "px-4")}
            onClick={() => onSelectProject(null)}
            title="all projects"
          >
            <Layers className="h-4 w-4 mr-2" />
            {!collapsed && <span>all projects</span>}
          </Button>

          {draftsProject && (
            <Button
              variant={selectedProjectId === draftsProject.id ? "secondary" : "ghost"}
              className={cn("w-full justify-start", collapsed ? "px-2" : "px-4")}
              onClick={() => onSelectProject(draftsProject.id)}
              title="drafts"
            >
              <FolderOpen className={cn("h-4 w-4 mr-2", selectedProjectId === draftsProject.id ? "text-foreground" : "text-muted-foreground")} />
              {!collapsed && <span className="truncate">drafts</span>}
            </Button>
          )}

          {otherProjects.map((project) => (
            <div key={project.id}>
              <Button
                variant={selectedProjectId === project.id ? "secondary" : "ghost"}
                className={cn("w-full justify-start truncate", collapsed ? "px-2" : "px-4")}
                onClick={() => onSelectProject(project.id)}
                title={project.name}
              >
                <Folder className={cn("h-4 w-4 mr-2", selectedProjectId === project.id ? "text-foreground" : "text-muted-foreground")} />
                {!collapsed && <span className="truncate">{project.name}</span>}
              </Button>
              {/* Subfolders shown under selected project */}
              {selectedProjectId === project.id && projectFolders.length > 0 && !collapsed && onSelectFolder && (
                <div className="ml-6 mt-1 space-y-0.5 mb-2">
                  <button
                    onClick={() => onSelectFolder(null)}
                    className={cn(
                      "w-full text-left px-2 py-1 rounded text-xs transition flex items-center gap-1.5",
                      !selectedFolder
                        ? "bg-muted text-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <Layers className="h-3 w-3" />
                    all
                  </button>
                  {projectFolders.map((folder) => (
                    <button
                      key={folder}
                      onClick={() => onSelectFolder(folder)}
                      className={cn(
                        "w-full text-left px-2 py-1 rounded text-xs transition flex items-center gap-1.5 truncate",
                        selectedFolder === folder
                          ? "bg-muted text-foreground font-medium"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                      title={folder}
                    >
                      <FolderOpen className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{folder}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

