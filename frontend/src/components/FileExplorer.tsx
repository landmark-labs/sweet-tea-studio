import React, { useEffect, useMemo, useState } from "react";
import { api, FileItem } from "@/lib/api";
import { Folder, FolderOpen, FileImage, File as FileIcon, ChevronRight, ChevronDown, Home, ArrowRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface FileExplorerProps {
    engineId?: string;
    projectId?: string;
    projectName?: string;
    onFileSelect: (file: FileItem) => void;
}

const FileNode = ({
    item,
    level,
    engineId,
    projectId,
    onSelect
}: {
    item: FileItem,
    level: number,
    engineId?: string,
    projectId?: string,
    onSelect: (f: FileItem) => void
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [children, setChildren] = useState<FileItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const handleToggle = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (item.type === "file") {
            onSelect(item);
            return;
        }

        if (!isOpen) {
            setIsLoading(true);
            try {
                const id = engineId ? parseInt(engineId) : undefined;
                const pid = projectId ? parseInt(projectId) : undefined;
                const data = await api.getFileTree(id, item.path, pid);
                setChildren(data);
            } catch (e) {
                console.error("Failed to load directory", e);
            } finally {
                setIsLoading(false);
            }
        }
        setIsOpen(!isOpen);
    };

    const isImage = item.name.match(/\.(png|jpg|jpeg|webp)$/i);

    return (
        <div>
            <div
                className={cn(
                    "flex items-center gap-1 py-1 px-2 cursor-pointer hover:bg-slate-100 text-sm select-none truncate",
                    level > 0 && "ml-4"
                )}
                onClick={handleToggle}
                draggable={!!isImage}
                onDragStart={(e) => {
                    if (isImage) {
                        const url = `/api/v1/gallery/image/path?path=${encodeURIComponent(item.path)}`;
                        e.dataTransfer.setData("text/plain", url);
                        e.dataTransfer.effectAllowed = "copy";
                    }
                }}
            >
                {item.type === "directory" && (
                    <span className="text-slate-400">
                        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </span>
                )}

                {item.type === "directory" ? (
                    isOpen ? <FolderOpen className="w-4 h-4 text-blue-500" /> : <Folder className="w-4 h-4 text-blue-500" />
                ) : isImage ? (
                    <FileImage className="w-4 h-4 text-purple-500" />
                ) : (
                    <FileIcon className="w-4 h-4 text-slate-400" />
                )}

                <span className="truncate">{item.name}</span>
            </div>

            {isOpen && (
                <div>
                    {isLoading ? (
                        <div className="pl-8 text-xs text-slate-400 py-1">Loading...</div>
                    ) : (
                        children.map((child) => (
                            <FileNode
                                key={child.path}
                                item={child}
                                level={level + 1}
                                engineId={engineId}
                                projectId={projectId}
                                onSelect={onSelect}
                            />
                        ))
                    )}
                    {children.length === 0 && !isLoading && (
                        <div className="pl-8 text-xs text-slate-400 py-1">Empty</div>
                    )}
                </div>
            )}
        </div>
    );
};

export function FileExplorer({ engineId, projectId, projectName, onFileSelect }: FileExplorerProps) {
    const [roots, setRoots] = useState<FileItem[]>([]);
    const [customPath, setCustomPath] = useState("");
    const [currentPath, setCurrentPath] = useState(""); // "" means default view (Inputs/Outputs)

    const setPath = (nextPath: string) => {
        setCurrentPath(nextPath);
        setCustomPath(nextPath);
    };

    useEffect(() => {
        const loadRoots = async () => {
            try {
                const id = engineId ? parseInt(engineId) : undefined;
                const pid = projectId ? parseInt(projectId) : undefined;
                // If currentPath is empty, it loads the default roots.
                // With projectId, it will show project folders instead of engine input/output.
                const data = await api.getFileTree(id, currentPath, pid);
                setRoots(data);
            } catch (e) {
                console.error("Failed to load roots", e);
                // Fallback to default if custom path fails
                if (currentPath) setPath("");
            }
        };
        loadRoots();
    }, [engineId, projectId, currentPath]);

    const handleNavigate = (e: React.FormEvent) => {
        e.preventDefault();
        setPath(customPath.trim());
    };

    const goHome = () => {
        setPath("");
    };

    const goUp = () => {
        if (!currentPath) return;
        // Get parent directory by splitting path and removing last segment
        const segments = currentPath.replace(/[/\\]+$/, "").split(/[/\\]/).filter(Boolean);
        if (segments.length === 0) {
            setPath("");
        } else {
            segments.pop();
            const parentPath = segments.join("/");
            setPath(parentPath);
        }
    };

    const pathSegments = useMemo(() => currentPath.split(/[/\\]/).filter(Boolean), [currentPath]);
    const isRoot = pathSegments.length === 0;

    return (
        <div className="h-full flex flex-col border-r bg-slate-50/50">
            <div className="p-2 border-b space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <div className="flex items-center gap-2">
                        <span>Explorer</span>
                        {projectName && (
                            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-semibold lowercase normal-case">
                                {projectName}
                            </span>
                        )}
                    </div>
                    <div className="flex gap-1">
                        <Button
                            variant={isRoot ? "ghost" : "outline"}
                            size="icon"
                            className={`h-6 w-6 ${isRoot ? "text-slate-300" : "text-blue-600 hover:bg-blue-50 border-blue-200"}`}
                            onClick={goUp}
                            title={isRoot ? "Already at root" : "Go Up One Level"}
                            disabled={isRoot}
                        >
                            <ChevronRight className="w-4 h-4 rotate-180" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={goHome} title="Reset to Defaults">
                            <Home className="w-3 h-3" />
                        </Button>
                    </div>
                </div>
                <div
                    className="flex items-center gap-1 text-[10px] text-slate-600 px-1 py-0.5 bg-slate-100 rounded border border-slate-200"
                    title={currentPath || "root"}
                >
                    <button
                        type="button"
                        className="hover:underline text-blue-600 disabled:text-slate-500 disabled:no-underline"
                        onClick={goHome}
                        disabled={isRoot}
                    >
                        root
                    </button>
                    {pathSegments.map((segment, idx) => {
                        const pathUpToHere = pathSegments.slice(0, idx + 1).join("/");
                        const isLast = idx === pathSegments.length - 1;
                        return (
                            <React.Fragment key={`${segment}-${idx}`}>
                                <ChevronRight className="w-3 h-3 text-slate-400" />
                                <button
                                    type="button"
                                    className={cn(
                                        "truncate text-left",
                                        isLast ? "font-semibold text-slate-700" : "text-blue-600 hover:underline"
                                    )}
                                    onClick={() => setPath(pathUpToHere)}
                                >
                                    {segment || "(root)"}
                                </button>
                            </React.Fragment>
                        );
                    })}
                </div>
                <form onSubmit={handleNavigate} className="flex gap-1">
                    <Input
                        value={customPath}
                        onChange={(e) => setCustomPath(e.target.value)}
                        placeholder="Path..."
                        className="h-6 text-xs px-2"
                    />
                    <Button type="submit" variant="outline" size="icon" className="h-6 w-6">
                        <ArrowRight className="w-3 h-3" />
                    </Button>
                </form>
            </div>
            <ScrollArea className="flex-1">
                <div className="p-2">
                    {roots.map((root) => (
                        <FileNode
                            key={root.path}
                            item={root}
                            level={0}
                            engineId={engineId}
                            projectId={projectId}
                            onSelect={onFileSelect}
                        />
                    ))}
                    {roots.length === 0 && (
                        <div className="text-xs text-slate-400 p-2 text-center">No files found</div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
