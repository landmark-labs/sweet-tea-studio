/**
 * Projects page
 * Lists all projects and allows creating new ones
 */
import { useEffect, useState } from "react";
import { labels } from "@/ui/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Plus, FolderOpen, Archive, Calendar, Hash } from "lucide-react";
import { cn } from "@/lib/utils";

interface Project {
    id: number;
    slug: string;
    name: string;
    created_at: string;
    updated_at: string;
    archived_at: string | null;
    config_json: Record<string, unknown> | null;
}

export default function Projects() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newProjectName, setNewProjectName] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);

    const fetchProjects = async () => {
        try {
            const res = await fetch("/api/v1/projects/");
            if (res.ok) {
                const data = await res.json();
                setProjects(data);
            }
        } catch (e) {
            console.error("Failed to fetch projects:", e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchProjects();
    }, []);

    const handleCreateProject = async () => {
        if (!newProjectName.trim()) return;

        setIsCreating(true);
        try {
            const res = await fetch("/api/v1/projects/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newProjectName.trim() }),
            });

            if (res.ok) {
                setNewProjectName("");
                setIsCreateOpen(false);
                fetchProjects();
            } else {
                const error = await res.json();
                alert(error.detail || "Failed to create project");
            }
        } catch (e) {
            console.error("Failed to create project:", e);
        } finally {
            setIsCreating(false);
        }
    };

    const handleArchiveProject = async (projectId: number) => {
        try {
            const res = await fetch(`/api/v1/projects/${projectId}/archive`, {
                method: "POST",
            });
            if (res.ok) {
                fetchProjects();
            }
        } catch (e) {
            console.error("Failed to archive project:", e);
        }
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    };

    // Separate drafts from other projects
    const draftsProject = projects.find((p) => p.slug === "drafts");
    const otherProjects = projects.filter((p) => p.slug !== "drafts");

    return (
        <div className="p-6 space-y-6 h-full overflow-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">{labels.pageTitle.projects}</h1>
                    <p className="text-muted-foreground text-sm">
                        organize your generations into projects
                    </p>
                </div>
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="gap-2">
                            <Plus size={16} />
                            {labels.action.newProject}
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{labels.action.newProject}</DialogTitle>
                            <DialogDescription>
                                create a new project to organize your generations
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4">
                            <Input
                                placeholder={labels.placeholder.projectName}
                                value={newProjectName}
                                onChange={(e) => setNewProjectName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleCreateProject();
                                }}
                            />
                        </div>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => setIsCreateOpen(false)}
                            >
                                cancel
                            </Button>
                            <Button
                                onClick={handleCreateProject}
                                disabled={!newProjectName.trim() || isCreating}
                            >
                                {isCreating ? "creating..." : "create"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Loading state */}
            {isLoading && (
                <div className="text-muted-foreground text-center py-12">
                    loading projects...
                </div>
            )}

            {/* Empty state */}
            {!isLoading && projects.length === 0 && (
                <div className="text-center py-12">
                    <FolderOpen className="mx-auto h-12 w-12 text-muted-foreground/50" />
                    <p className="mt-4 text-muted-foreground">{labels.empty.noProjects}</p>
                    <Button className="mt-4 gap-2" onClick={() => setIsCreateOpen(true)}>
                        <Plus size={16} />
                        {labels.action.newProject}
                    </Button>
                </div>
            )}

            {/* Drafts section */}
            {draftsProject && (
                <div className="space-y-3">
                    <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                        {labels.entity.drafts}
                    </h2>
                    <Card
                        className={cn(
                            "cursor-pointer transition-all hover:border-primary/50",
                            selectedProject?.id === draftsProject.id && "border-primary"
                        )}
                        onClick={() => setSelectedProject(draftsProject)}
                    >
                        <CardHeader className="pb-2">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-muted">
                                    <FolderOpen size={20} className="text-muted-foreground" />
                                </div>
                                <div>
                                    <CardTitle className="text-base lowercase">
                                        {draftsProject.name.toLowerCase()}
                                    </CardTitle>
                                    <CardDescription className="text-xs">
                                        unsaved generations go here
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                    </Card>
                </div>
            )}

            {/* Projects grid */}
            {otherProjects.length > 0 && (
                <div className="space-y-3">
                    <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                        {labels.entity.projects}
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {otherProjects.map((project) => (
                            <Card
                                key={project.id}
                                className={cn(
                                    "cursor-pointer transition-all hover:border-primary/50",
                                    selectedProject?.id === project.id && "border-primary"
                                )}
                                onClick={() => setSelectedProject(project)}
                            >
                                <CardHeader className="pb-2">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-primary/10">
                                                <FolderOpen size={20} className="text-primary" />
                                            </div>
                                            <div>
                                                <CardTitle className="text-base">
                                                    {project.name}
                                                </CardTitle>
                                                <CardDescription className="text-xs flex items-center gap-1">
                                                    <Hash size={12} />
                                                    {project.slug}
                                                </CardDescription>
                                            </div>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleArchiveProject(project.id);
                                            }}
                                        >
                                            <Archive size={14} />
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent className="pt-0">
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <Calendar size={12} />
                                        created {formatDate(project.created_at)}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
