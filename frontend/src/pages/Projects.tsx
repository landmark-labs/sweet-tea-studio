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
import { Plus, FolderOpen, Archive, Calendar, Hash, Image as ImageIcon, Settings, FolderPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

import { api, Project } from "@/lib/api";

export default function Projects() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newProjectName, setNewProjectName] = useState("");
    const [isCreating, setIsCreating] = useState(false);

    // Folder Management State
    const [managingProject, setManagingProject] = useState<Project | null>(null);
    const [newFolderName, setNewFolderName] = useState("");
    const [isAddingFolder, setIsAddingFolder] = useState(false);

    const fetchProjects = async () => {
        try {
            const data = await api.getProjects();
            setProjects(data);
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
            await api.createProject({ name: newProjectName.trim() });
            setNewProjectName("");
            setIsCreateOpen(false);
            fetchProjects();
        } catch (e) {
            console.error("Failed to create project:", e);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            alert((e as any).message || "Failed to create project");
        } finally {
            setIsCreating(false);
        }
    };

    const handleArchiveProject = async (projectId: number) => {
        try {
            await api.archiveProject(projectId);
            fetchProjects();
        } catch (e) {
            console.error("Failed to archive project:", e);
        }
    };

    const handleAddFolder = async () => {
        if (!managingProject || !newFolderName.trim()) return;
        setIsAddingFolder(true);
        try {
            const updated = await api.addProjectFolder(managingProject.id, newFolderName.trim());

            // Update local state
            setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
            setManagingProject(updated);
            setNewFolderName("");
        } catch (e) {
            console.error("Failed to add folder:", e);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            alert((e as any).message || "Failed to add folder");
        } finally {
            setIsAddingFolder(false);
        }
    };

    const formatDate = (dateStr?: string | null) => {
        if (!dateStr) return "Never";
        const date = new Date(dateStr);
        // Relative time if < 24h, else date
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours < 24) {
            if (diffHours < 1) {
                const diffMins = Math.round(diffMs / (1000 * 60));
                return diffMins <= 1 ? "Just now" : `${diffMins}m ago`;
            }
            return `${Math.round(diffHours)}h ago`;
        }

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

            {/* Folder Management Dialog */}
            <Dialog open={!!managingProject} onOpenChange={(open) => !open && setManagingProject(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Manage Folders: {managingProject?.name}</DialogTitle>
                        <DialogDescription>
                            Organize outputs into subfolders.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <div className="text-sm font-medium">Current Folders</div>
                            <ScrollArea className="h-[300px] w-full rounded-md border p-2">
                                <div className="space-y-1">
                                    {(managingProject?.config_json?.folders || ["inputs", "output", "masks"]).map((folder) => (
                                        <div key={folder} className="flex items-center gap-2 text-sm text-muted-foreground px-2 py-1 bg-muted/50 rounded">
                                            <FolderOpen size={14} />
                                            <span>{folder}</span>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>

                        <div className="flex items-center gap-2">
                            <Input
                                placeholder="New folder name..."
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleAddFolder();
                                }}
                            />
                            <Button type="button" size="icon" onClick={handleAddFolder} disabled={isAddingFolder || !newFolderName.trim()}>
                                <FolderPlus size={16} />
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

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
                            "transition-all hover:border-primary/50",
                        )}
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
                        <CardContent className="pt-0">
                            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
                                <div className="flex items-center gap-1">
                                    <ImageIcon size={12} />
                                    {draftsProject.image_count || 0} images
                                </div>
                                <div className="flex items-center gap-1">
                                    <Calendar size={12} />
                                    active {formatDate(draftsProject.last_activity || draftsProject.updated_at)}
                                </div>
                            </div>
                        </CardContent>
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
                                    "transition-all hover:border-primary/50 group relative"
                                )}
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

                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-muted-foreground hover:text-primary"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setManagingProject(project);
                                                }}
                                                title="Manage folders"
                                            >
                                                <Settings size={14} />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleArchiveProject(project.id);
                                                }}
                                                title="Archive project"
                                            >
                                                <Archive size={14} />
                                            </Button>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="pt-0">
                                    <Separator className="my-2" />
                                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                        <div className="flex items-center gap-1">
                                            <ImageIcon size={12} />
                                            {project.image_count || 0} images
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Calendar size={12} />
                                            active {formatDate(project.last_activity)}
                                        </div>
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
