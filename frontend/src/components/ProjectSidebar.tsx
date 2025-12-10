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
}

export function ProjectSidebar({ selectedProjectId, onSelectProject, projects: providedProjects, className }: ProjectSidebarProps) {
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
        "relative border-r bg-slate-50 transition-all duration-300 flex flex-col",
        collapsed ? "w-12" : "w-64",
        className
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute -right-3 top-4 h-6 w-6 rounded-full border bg-white shadow-sm z-10"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </Button>

      <div className="p-2 flex items-center justify-between border-b h-14">
        {!collapsed && <span className="font-semibold text-slate-700">Projects</span>}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          <Button
            variant={selectedProjectId === null ? "secondary" : "ghost"}
            className={cn("w-full justify-start", collapsed ? "px-2" : "px-4")}
            onClick={() => onSelectProject(null)}
            title="All Projects"
          >
            <Layers className="h-4 w-4 mr-2" />
            {!collapsed && <span>All Projects</span>}
          </Button>

          <Button
            variant={selectedProjectId === -1 ? "secondary" : "ghost"}
            className={cn("w-full justify-start", collapsed ? "px-2" : "px-4")}
            onClick={() => onSelectProject(-1)}
            title="Draft generations"
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            {!collapsed && <span>Draft mode</span>}
          </Button>

          {draftsProject && (
            <Button
              variant={selectedProjectId === draftsProject.id ? "secondary" : "ghost"}
              className={cn("w-full justify-start", collapsed ? "px-2" : "px-4")}
              onClick={() => onSelectProject(draftsProject.id)}
              title="Drafts"
            >
              <FolderOpen className={cn("h-4 w-4 mr-2", selectedProjectId === draftsProject.id ? "text-blue-600" : "text-slate-500")} />
              {!collapsed && <span className="truncate">Drafts</span>}
            </Button>
          )}

          {otherProjects.map((project) => (
            <Button
              key={project.id}
              variant={selectedProjectId === project.id ? "secondary" : "ghost"}
              className={cn("w-full justify-start truncate", collapsed ? "px-2" : "px-4")}
              onClick={() => onSelectProject(project.id)}
              title={project.name}
            >
              <Folder className={cn("h-4 w-4 mr-2", selectedProjectId === project.id ? "text-blue-600" : "text-slate-500")} />
              {!collapsed && <span className="truncate">{project.name}</span>}
            </Button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
