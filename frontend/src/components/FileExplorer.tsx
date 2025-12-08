import React, { useEffect, useState } from "react";
import { api, FileItem } from "@/lib/api";
import { Folder, FolderOpen, FileImage, File as FileIcon, ChevronRight, ChevronDown } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface FileExplorerProps {
    engineId?: string;
    onFileSelect: (file: FileItem) => void;
}

const FileNode = ({
    item,
    level,
    engineId,
    onSelect
}: {
    item: FileItem,
    level: number,
    engineId?: string,
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
                const data = await api.getFileTree(id, item.path);
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

export function FileExplorer({ engineId, onFileSelect }: FileExplorerProps) {
    const [roots, setRoots] = useState<FileItem[]>([]);

    useEffect(() => {
        const loadRoots = async () => {
            try {
                const id = engineId ? parseInt(engineId) : undefined;
                const data = await api.getFileTree(id, "");
                setRoots(data);
            } catch (e) {
                console.error("Failed to load roots", e);
            }
        };
        loadRoots();
    }, [engineId]);

    return (
        <div className="h-full flex flex-col border-r bg-slate-50/50">
            <div className="p-2 border-b text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Explorer
            </div>
            <ScrollArea className="flex-1">
                <div className="p-2">
                    {roots.map((root) => (
                        <FileNode
                            key={root.path}
                            item={root}
                            level={0}
                            engineId={engineId}
                            onSelect={onFileSelect}
                        />
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}
