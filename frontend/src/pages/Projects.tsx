import { useEffect, useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import { useProjectsPageStore } from "@/lib/stores/pageStateStores";

export default function Projects() {
    const generation = useGeneration();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);

    const showArchived = useProjectsPageStore((state) => state.showArchived);
    const setShowArchived = useProjectsPageStore((state) => state.setShowArchived);
    const isCreateOpen = useProjectsPageStore((state) => state.isCreateOpen);
    const setIsCreateOpen = useProjectsPageStore((state) => state.setIsCreateOpen);
    const newProjectName = useProjectsPageStore((state) => state.newProjectName);
    const setNewProjectName = useProjectsPageStore((state) => state.setNewProjectName);
    const managingProjectId = useProjectsPageStore((state) => state.managingProjectId);
    const setManagingProjectId = useProjectsPageStore((state) => state.setManagingProjectId);
    const newFolderName = useProjectsPageStore((state) => state.newFolderName);
    const setNewFolderName = useProjectsPageStore((state) => state.setNewFolderName);

    // Folder Management State
    const [isAddingFolder, setIsAddingFolder] = useState(false);
    const [isDeletingFolder, setIsDeletingFolder] = useState<string | null>(null);
    const [isEmptyingTrash, setIsEmptyingTrash] = useState<string | null>(null);

    const reservedFolders = new Set(["input", "output", "masks"]);
    const contextProjects = generation?.projects ?? [];
    const managingProject = managingProjectId ? projects.find((p) => p.id === managingProjectId) || null : null;

    const fetchProjects = async (options?: { background?: boolean }) => {
        if (!options?.background) {
            setIsLoading(true);
        }
        try {
            const data = await api.getProjects(showArchived);
            setProjects(data);
        } catch (e) {
            console.error("Failed to fetch projects:", e);
        } finally {
            if (!options?.background) {
                setIsLoading(false);
            }
        }
    };

    useEffect(() => {
        if (!showArchived && contextProjects.length > 0) {
            setProjects(contextProjects);
            setIsLoading(false);
            void fetchProjects({ background: true });
            return;
        }
        void fetchProjects();
    }, [showArchived, contextProjects]);

    useEffect(() => {
        if (managingProjectId && !projects.some((project) => project.id === managingProjectId)) {
            setManagingProjectId(null);
        }
    }, [projects, managingProjectId, setManagingProjectId]);

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
        if (!managingProject || !newFolderName.trim()) {
            return;
        }
        setIsAddingFolder(true);
        try {
            const updated = await api.addProjectFolder(managingProject.id, newFolderName.trim());
            // Update local state
            setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
            setManagingProjectId(updated.id);
            setNewFolderName("");

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
    const draftsProject = projects.find((p) => p.slug === "drafts");
    const nonDraftProjects = projects.filter((p) => p.slug !== "drafts");
    const activeProjects = nonDraftProjects.filter(p => !p.archived_at);
    const archivedProjects = nonDraftProjects.filter(p => !!p.archived_at);

    // Drag-and-drop sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 },
        })
    );

    // Project IDs for sortable context
    const activeProjectIds = activeProjects.map(p => p.id);

    // Handle project drag end - works on activeProjects only (non-draft, non-archived)
    const handleProjectDragEnd = async (event: any) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        // Work with current projects state directly
        setProjects(currentProjects => {
            const drafts = currentProjects.find(p => p.slug === "drafts");
            const nonDraft = currentProjects.filter(p => p.slug !== "drafts");
            const active_ = nonDraft.filter(p => !p.archived_at);
            const archived = nonDraft.filter(p => !!p.archived_at);

            const oldIndex = active_.findIndex(p => p.id === active.id);
            const newIndex = active_.findIndex(p => p.id === over.id);
            if (oldIndex === -1 || newIndex === -1) return currentProjects;

            const reordered = arrayMove(active_, oldIndex, newIndex);

            // Update display_order
            const reorderedWithOrder = reordered.map((p, idx) => ({
                ...p,
                display_order: idx
            }));

            // Persist to backend
            const orderUpdate = reorderedWithOrder.map(p => ({
                id: p.id,
                display_order: p.display_order
            }));
            api.reorderProjects(orderUpdate)
                .then(() => generation?.refreshProjects?.())
                .catch(err => {
                    console.error("Failed to persist project order:", err);
                    fetchProjects();
                });

            return [
                ...(drafts ? [drafts] : []),
                ...reorderedWithOrder,
                ...archived,
            ];
        });
    };

    return (
        <div className="pt-4 pr-8 pb-8 pl-[83px] space-y-4 h-full overflow-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{labels.pageTitle.projects}</h1>
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
            <Dialog open={Boolean(managingProject)} onOpenChange={(open) => !open && setManagingProjectId(null)}>
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
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                                    onClick={async () => {
                                                        if (!managingProject) return;
                                                        if (!confirm(`Permanently delete all items in the trash for "${folder}"? This cannot be undone.`)) return;
                                                        setIsEmptyingTrash(folder);
                                                        try {
                                                            const result = await api.emptyFolderTrash(managingProject.id, folder);
                                                            if (result.deleted > 0) {
                                                                alert(`Deleted ${result.deleted} item(s) from trash`);
                                                            } else {
                                                                alert("Trash is already empty");
                                                            }
                                                        } catch (e) {
                                                            console.error("Failed to empty trash:", e);
                                                            alert((e as any).message || "Failed to empty trash");
                                                        } finally {
                                                            setIsEmptyingTrash(null);
                                                        }
                                                    }}
                                                    disabled={isEmptyingTrash === folder}
                                                    title="Empty trash"
                                                >
                                                    <Trash2 size={12} />
                                                </Button>
                                                {!reservedFolders.has(folder) && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                                        onClick={async () => {
                                                            if (!managingProject) return;
                                                            if (!confirm(`Delete folder "${folder}"? This only works if the folder is empty.`)) return;
                                                            setIsDeletingFolder(folder);
                                                            try {
                                                                const updated = await api.deleteProjectFolder(managingProject.id, folder);
                                                                setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
                                                                setManagingProjectId(updated.id);
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
                                                        title="Delete folder"
                                                    >
                                                        <Trash2 size={12} className="text-destructive" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>

                        <div className="flex items-center gap-2">
                            <Input
                                placeholder="new folder name..."
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        handleAddFolder();
                                    }
                                }}
                            />
                            <Button
                                type="button"
                                size="icon"
                                onClick={handleAddFolder}
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
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleProjectDragEnd}
                    >
                        <SortableContext items={activeProjectIds} strategy={rectSortingStrategy}>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {activeProjects.map((project) => (
                                    <SortableProjectCard
                                        key={project.id}
                                        project={project}
                                        formatDate={formatDate}
                                        onManage={(p) => setManagingProjectId(p.id)}
                                        onArchive={handleArchiveProject}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
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
                                onManage={(p) => setManagingProjectId(p.id)}
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

interface SortableProjectCardProps {
    project: Project;
    formatDate: (d?: string | null) => string;
    onManage: (p: Project) => void;
    onArchive?: (id: number) => void;
}

function SortableProjectCard({ project, formatDate, onManage, onArchive }: SortableProjectCardProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 1000 : undefined,
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <ProjectCard
                project={project}
                formatDate={formatDate}
                onManage={onManage}
                onArchive={onArchive}
            />
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
                                className="h-8 w-8 text-muted-foreground hover:text-success"
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

