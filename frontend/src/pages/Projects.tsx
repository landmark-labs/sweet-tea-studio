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
import { Plus, FolderOpen, Archive, Calendar, Hash, Image as ImageIcon, Settings, FolderPlus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

import { api, Project } from "@/lib/api";
import { useGeneration } from "@/lib/GenerationContext";

export default function Projects() {
    const generation = useGeneration();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newProjectName, setNewProjectName] = useState("");
    const [isCreating, setIsCreating] = useState(false);

    const [showArchived, setShowArchived] = useState(false);

    // Folder Management State
    const [managingProject, setManagingProject] = useState<Project | null>(null);
    const [newFolderName, setNewFolderName] = useState("");
    const [isAddingFolder, setIsAddingFolder] = useState(false);
    const [isDeletingFolder, setIsDeletingFolder] = useState<string | null>(null);

    const reservedFolders = new Set(["input", "output", "masks"]);

    const fetchProjects = async () => {
        try {
            const data = await api.getProjects(showArchived);
            setProjects(data);
        } catch (e) {
            console.error("Failed to fetch projects:", e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchProjects();
    }, [showArchived]);

    const handleCreateProject = async () => {
        if (!newProjectName.trim()) return;

        setIsCreating(true);
        try {
            await api.createProject({ name: newProjectName.trim() });
            setNewProjectName("");
            setIsCreateOpen(false);
            fetchProjects();
            // Refresh global context so Prompt Studio sees it
            if (generation?.refreshProjects) {
                generation.refreshProjects();
            }
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

    const handleUnarchiveProject = async (projectId: number) => {
        try {
            await api.unarchiveProject(projectId);
            fetchProjects();
        } catch (e) {
            console.error("Failed to unarchive project:", e);
        }
    };

    const handleAddFolder = async () => {
        console.log("[Projects] handleAddFolder called", { managingProject, newFolderName, isAddingFolder });
        if (!managingProject || !newFolderName.trim()) {
            console.log("[Projects] Bailing early - missing project or folder name");
            return;
        }
        setIsAddingFolder(true);
        try {
            console.log("[Projects] Calling api.addProjectFolder", { projectId: managingProject.id, folderName: newFolderName.trim() });
            const updated = await api.addProjectFolder(managingProject.id, newFolderName.trim());
            console.log("[Projects] API returned full response:", JSON.stringify(updated, null, 2));
            console.log("[Projects] Returned config_json:", updated.config_json);
            console.log("[Projects] Returned folders:", updated.config_json?.folders);

            // Update local state
            setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
            setManagingProject(updated);
            setNewFolderName("");

            console.log("[Projects] State updated with new project data");

            // Refresh global context so Prompt Studio sees the new folder
            if (generation?.refreshProjects) {
                generation.refreshProjects();
            }
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
    // Separate drafts from other projects
    const draftsProject = projects.find((p) => p.slug === "drafts");
    const nonDraftProjects = projects.filter((p) => p.slug !== "drafts");
    const activeProjects = nonDraftProjects.filter(p => !p.archived_at);
    const archivedProjects = nonDraftProjects.filter(p => !!p.archived_at);

    return (
        <div className="p-4 space-y-4 h-full overflow-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">{labels.pageTitle.projects}</h1>
                    <p className="text-muted-foreground text-sm">
                        organize your generations into projects
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <Button
                        variant={showArchived ? "secondary" : "ghost"}
                        onClick={() => setShowArchived(!showArchived)}
                        className="gap-2"
                        title={showArchived ? "Hide archived projects" : "Show archived projects"}
                    >
                        <Archive size={16} />
                        {showArchived ? "hide archived" : "view archived"}
                    </Button>
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
            </div>

            {/* Folder Management Dialog */}
            <Dialog open={!!managingProject} onOpenChange={(open) => !open && setManagingProject(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>manage folders: {managingProject?.name}</DialogTitle>
                        <DialogDescription>
                            organize outputs into subfolders.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <div className="text-sm font-medium">current folders</div>
                            <ScrollArea className="h-[300px] w-full rounded-md border p-2">
                                <div className="space-y-1">
                                    {(managingProject?.config_json?.folders || ["input", "output", "masks"]).map((folder) => (
                                        <div key={folder} className="flex items-center justify-between text-sm text-muted-foreground px-2 py-1 bg-muted/50 rounded">
                                            <div className="flex items-center gap-2">
                                                <FolderOpen size={14} />
                                                <span>{folder}</span>
                                            </div>
                                            {!reservedFolders.has(folder) && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-slate-400 hover:text-red-500"
                                                    onClick={async () => {
                                                        if (!managingProject) return;
                                                        if (!confirm(`Delete folder "${folder}"? This only works if the folder is empty.`)) return;
                                                        setIsDeletingFolder(folder);
                                                        try {
                                                            const updated = await api.deleteProjectFolder(managingProject.id, folder);
                                                            setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
                                                            setManagingProject(updated);
                                                            if (generation?.refreshProjects) {
                                                                generation.refreshProjects();
                                                            }
                                                        } catch (e) {
                                                            console.error("Failed to delete folder:", e);
                                                            alert((e as any).message || "Failed to delete folder");
                                                        } finally {
                                                            setIsDeletingFolder(null);
                                                        }
                                                    }}
                                                    disabled={isDeletingFolder === folder}
                                                    title="Delete empty folder"
                                                >
                                                    <Trash2 size={12} />
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>

                        <div className="flex items-center gap-2">
                            <Input
                                placeholder="new folder name..."
                                value={newFolderName}
                                onChange={(e) => {
                                    console.log("[Projects] Input onChange:", e.target.value);
                                    setNewFolderName(e.target.value);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        console.log("[Projects] Enter key pressed");
                                        handleAddFolder();
                                    }
                                }}
                            />
                            <Button
                                type="button"
                                size="icon"
                                onClick={() => {
                                    console.log("[Projects] Button clicked! Current state:", { newFolderName, isAddingFolder, managingProject: !!managingProject });
                                    handleAddFolder();
                                }}
                                disabled={isAddingFolder || !newFolderName.trim()}
                            >
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
                <div className="space-y-2">
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">
                        {labels.entity.drafts}
                    </h2>
                    <Card
                        className={cn(
                            "transition-all hover:border-primary/50 max-w-sm",
                        )}
                    >
                        <CardHeader className="pb-2 p-3">
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
                        <CardContent className="pt-0 p-3">
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
            {activeProjects.length > 0 && (
                <div className="space-y-2">
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1">
                        {labels.entity.projects}
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {activeProjects.map((project) => (
                            <ProjectCard
                                key={project.id}
                                project={project}
                                formatDate={formatDate}
                                onManage={(p) => setManagingProject(p)}
                                onArchive={handleArchiveProject}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Archived Projects grid */}
            {showArchived && archivedProjects.length > 0 && (
                <div className="space-y-2 pt-4 border-t">
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pl-1 flex items-center gap-2">
                        <Archive size={12} />
                        archived projects
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 opacity-75">
                        {archivedProjects.map((project) => (
                            <ProjectCard
                                key={project.id}
                                project={project}
                                formatDate={formatDate}
                                onManage={(p) => setManagingProject(p)}
                                onUnarchive={handleUnarchiveProject}
                                isArchived
                            />
                        ))}
                    </div>
                </div>
            )}

            {showArchived && archivedProjects.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                    no archived projects found
                </div>
            )}
        </div>
    );
}

function ProjectCard({
    project,
    formatDate,
    onManage,
    onArchive,
    onUnarchive,
    isArchived = false
}: {
    project: Project,
    formatDate: (d?: string | null) => string,
    onManage: (p: Project) => void,
    onArchive?: (id: number) => void,
    onUnarchive?: (id: number) => void,
    isArchived?: boolean
}) {
    return (
        <Card
            className={cn(
                "transition-all hover:border-primary/50 group relative",
                isArchived && "bg-muted/30 border-dashed"
            )}
        >
            <CardHeader className="pb-2 p-3">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className={cn("p-2 rounded-lg", isArchived ? "bg-muted" : "bg-primary/10")}>
                            <FolderOpen size={20} className={cn(isArchived ? "text-muted-foreground" : "text-primary")} />
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

                    <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        {!isArchived && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-primary"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onManage(project);
                                }}
                                title="manage folders"
                            >
                                <Settings size={14} />
                            </Button>
                        )}

                        {isArchived ? (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-green-600"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onUnarchive?.(project.id);
                                }}
                                title="restore project"
                            >
                                <Archive size={14} className="rotate-180" />
                            </Button>
                        ) : (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onArchive?.(project.id);
                                }}
                                title="archive project"
                            >
                                <Archive size={14} />
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-0 p-3">
                <Separator className="my-2" />
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                        <ImageIcon size={12} />
                        {project.image_count || 0} images
                    </div>
                    <div className="flex items-center gap-1">
                        <Calendar size={12} />
                        {isArchived
                            ? `curr: ${formatDate(project.archived_at)}`
                            : `active ${formatDate(project.last_activity)}`
                        }
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
