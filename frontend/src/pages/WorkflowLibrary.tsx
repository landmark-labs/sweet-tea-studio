import React, { useState, useEffect, useRef } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FileJson, AlertTriangle, GitBranch, Edit2, Trash2, Save, RotateCw, CheckCircle2, XCircle, GripVertical, ChevronDown, ChevronUp } from "lucide-react";
import { api, WorkflowTemplate } from "@/lib/api";
import { WorkflowGraphViewer } from "@/components/WorkflowGraphViewer";
import { cn } from "@/lib/utils";
import { labels } from "@/ui/labels";
import { stripSchemaMeta } from "@/lib/schema";
import { useGeneration } from "@/lib/GenerationContext";

const arraysEqual = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => val === b[idx]);
};

// --- Types ---
type RenderNode = {
    id: string;
    title: string;
    type: string;
    active: [string, any][];
    hidden: [string, any][];
    hiddenInControls?: boolean;
};

// --- Components ---
interface NodeCardProps {
    node: RenderNode;
    schemaEdits: any;
    setSchemaEdits: (edits: any) => void;
}

const NodeCard = ({ node, schemaEdits, setSchemaEdits }: NodeCardProps) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: node.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 5 : "auto",
    };

    const isCore = node.active.some(([_, f]: [string, any]) => f.x_core === true) ||
        node.hidden.some(([_, f]: [string, any]) => f.x_core === true);

    // Get current alias from any field in this node (they should all have the same alias)
    const currentAlias = [...node.active, ...node.hidden]
        .find(([_, f]: [string, any]) => f.x_node_alias)?.[1]?.x_node_alias || "";

    const setNodeAlias = (alias: string) => {
        const s = { ...schemaEdits };
        [...node.active, ...node.hidden].forEach(([key]: [string, any]) => {
            if (alias.trim()) {
                s[key].x_node_alias = alias;
            } else {
                delete s[key].x_node_alias;
            }
        });
        setSchemaEdits(s);
    };

    const toggleCore = () => {
        const s = { ...schemaEdits };
        [...node.active, ...node.hidden].forEach(([key]: [string, any]) => {
            s[key].x_core = !isCore;
        });
        setSchemaEdits(s);
    };

    const paramCount = node.active.length + node.hidden.length;

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "bg-white border rounded-lg overflow-hidden shadow-sm",
                isDragging && "ring-2 ring-blue-200 shadow-lg"
            )}
        >
            <div
                className="px-4 py-2 bg-slate-100 border-b flex justify-between items-center cursor-pointer hover:bg-slate-150 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-white"
                        aria-label="Reorder node"
                        onClick={(e) => e.stopPropagation()}
                        {...attributes}
                        {...listeners}
                    >
                        <GripVertical className="w-4 h-4" />
                    </button>
                    <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-xs font-mono text-slate-500">{node.id}</div>
                    {/* Alias or Title display */}
                    {currentAlias ? (
                        <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm text-blue-700">{currentAlias}</span>
                            <span className="text-[10px] text-slate-400">({node.title})</span>
                        </div>
                    ) : (
                        <span className="font-medium text-sm">{node.title}</span>
                    )}
                    {!isExpanded && (
                        <span className="text-[10px] text-slate-400 ml-1">({paramCount} params)</span>
                    )}
                    {node.hiddenInControls && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-700">
                            Hidden
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[10px] text-slate-400 uppercase">
                            {isCore ? "Core" : "Expanded"}
                        </span>
                        <Switch
                            checked={isCore}
                            onCheckedChange={toggleCore}
                            className={cn(
                                "h-4 w-7",
                                isCore ? "bg-blue-500" : "bg-slate-200"
                            )}
                        />
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">{node.type}</span>
                    {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                </div>
            </div>

            {/* Alias Editor - shown when expanded */}
            {isExpanded && (
                <div className="px-4 py-2 bg-slate-50 border-b flex items-center gap-2">
                    <Label htmlFor={`alias-${node.id}`} className="text-xs text-slate-500 flex-shrink-0">Display Name:</Label>
                    <Input
                        id={`alias-${node.id}`}
                        className="h-7 text-xs flex-1 max-w-[200px]"
                        value={currentAlias}
                        placeholder={node.title}
                        onChange={(e) => setNodeAlias(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                    />
                    {currentAlias && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs text-slate-400 hover:text-slate-600 px-1"
                            onClick={(e) => { e.stopPropagation(); setNodeAlias(""); }}
                        >
                            Clear
                        </Button>
                    )}
                </div>
            )}

            {isExpanded && (
                <>
                    {node.active.length > 0 && (
                        <Table>
                            <TableHeader>
                                <TableRow className="border-b-0 hover:bg-transparent">
                                    <TableHead className="h-8 text-xs w-[30%]">Label</TableHead>
                                    <TableHead className="h-8 text-xs w-[20%]">Field ID</TableHead>
                                    <TableHead className="h-8 text-xs w-[15%]">Type</TableHead>
                                    <TableHead className="h-8 text-xs w-[25%]">Default Value</TableHead>
                                    <TableHead className="h-8 text-xs text-right w-[10%]">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {node.active.map(([key, field]: [string, any]) => (
                                    <TableRow key={key} className="hover:bg-slate-50/50">
                                        <TableCell className="py-2">
                                            <Input
                                                className="h-7 text-xs"
                                                value={field.title || key}
                                                onChange={(e) => {
                                                    const s = { ...schemaEdits };
                                                    s[key].title = e.target.value;
                                                    setSchemaEdits(s);
                                                }}
                                            />
                                        </TableCell>
                                        <TableCell className="font-mono text-[10px] text-slate-500 py-2">{key}</TableCell>
                                        <TableCell className="text-xs text-slate-500 py-2">{field.type}</TableCell>
                                        <TableCell className="py-2">
                                            {field.widget === "toggle" || field.type === "boolean" ? (
                                                <Switch
                                                    checked={Boolean(field.default)}
                                                    onCheckedChange={(checked) => {
                                                        const s = { ...schemaEdits };
                                                        s[key].default = checked;
                                                        setSchemaEdits(s);
                                                    }}
                                                />
                                            ) : (
                                                <Input
                                                    className="h-7 text-xs"
                                                    value={field.default === undefined || field.default === null || (typeof field.default === 'number' && isNaN(field.default)) ? "" : String(field.default)}
                                                    onChange={(e) => {
                                                        const s = { ...schemaEdits };
                                                        // Store raw value while typing to allow natural input of "-", ".", etc.
                                                        s[key].default = e.target.value;
                                                        setSchemaEdits(s);
                                                    }}
                                                    onBlur={(e) => {
                                                        const s = { ...schemaEdits };
                                                        const val = e.target.value;
                                                        const type = key.toLowerCase() === 'cfg' ? 'float' : field.type;

                                                        // Parse on blur for number types
                                                        if (type === "number" || type === "float") {
                                                            if (val === "" || val === "-" || val === "." || val === "-.") {
                                                                s[key].default = val === "" ? undefined : val;
                                                            } else {
                                                                const parsed = parseFloat(val);
                                                                if (!isNaN(parsed)) {
                                                                    s[key].default = parsed;
                                                                    setSchemaEdits(s);
                                                                }
                                                            }
                                                        } else if (type === "integer") {
                                                            if (val === "" || val === "-") {
                                                                s[key].default = val === "" ? undefined : val;
                                                            } else {
                                                                const parsed = parseInt(val);
                                                                if (!isNaN(parsed)) {
                                                                    s[key].default = parsed;
                                                                    setSchemaEdits(s);
                                                                }
                                                            }
                                                        }
                                                    }}
                                                />
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right py-2">
                                            <Button variant="ghost" size="sm" className="h-6 text-xs text-red-500 hover:text-red-700" onClick={() => {
                                                const s = { ...schemaEdits };
                                                s[key].__hidden = true;
                                                setSchemaEdits(s);
                                            }}>Hide</Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}

                    {node.hidden.length > 0 && (
                        <div className="bg-slate-50 border-t border-slate-200">
                            <div className="px-4 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Hidden Parameters</div>
                            <Table>
                                <TableBody>
                                    {node.hidden.map(([key, field]: [string, any]) => (
                                        <TableRow key={key} className="hover:bg-slate-100/50 opacity-60">
                                            <TableCell className="py-2 text-xs text-slate-500 w-[30%]">{field.title || key}</TableCell>
                                            <TableCell className="font-mono text-[10px] text-slate-400 py-2 w-[20%] break-all">{key}</TableCell>
                                            <TableCell className="text-xs py-2 text-slate-400 w-[15%]">{field.type}</TableCell>
                                            <TableCell className="py-2 text-xs text-slate-400 w-[25%]">{String(field.default ?? "-")}</TableCell>
                                            <TableCell className="text-right py-2 w-[10%]">
                                                <Button variant="ghost" size="sm" className="h-6 text-xs text-blue-500 hover:text-blue-700" onClick={() => {
                                                    const s = { ...schemaEdits };
                                                    delete s[key].__hidden;
                                                    setSchemaEdits(s);
                                                }}>
                                                    Restore
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getNodeDisplayOrder = (graph: any, schema: any) => {
    const ids = Object.keys(graph);
    const storedOrder: string[] = Array.isArray(schema?.__node_order) ? schema.__node_order.map(String) : [];
    const validStored = storedOrder.filter((id: string) => ids.includes(id));
    const remaining = ids.filter((id: string) => !validStored.includes(id)).sort((a, b) => parseInt(a) - parseInt(b));
    return [...validStored, ...remaining];
};

// --- Sortable Workflow Card Component ---
interface SortableWorkflowCardProps {
    workflow: WorkflowTemplate;
    missing: string[];
    onViewGraph: (w: WorkflowTemplate) => void;
    onExport: (w: WorkflowTemplate) => void;
    onEdit: (w: WorkflowTemplate) => void;
    onDelete: (id: number) => void;
    onStartInstall: (nodes: string[]) => void;
}

const SortableWorkflowCard = ({
    workflow: w,
    missing,
    onViewGraph,
    onExport,
    onEdit,
    onDelete,
    onStartInstall
}: SortableWorkflowCardProps) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: w.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : "auto",
        opacity: isDragging ? 0.8 : 1,
    };

    return (
        <Card
            ref={setNodeRef}
            style={style}
            className={cn(
                "relative group hover:shadow-lg transition-shadow",
                isDragging && "ring-2 ring-blue-300 shadow-xl"
            )}
            title={w.description || undefined}
        >
            {/* Drag Handle */}
            <div
                {...attributes}
                {...listeners}
                className="absolute top-2 left-2 p-1.5 rounded bg-slate-100 hover:bg-slate-200 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 transition-colors z-10"
                title="Drag to reorder"
            >
                <GripVertical className="w-4 h-4" />
            </div>

            <CardHeader className="pl-10">
                <div className="flex justify-between items-start">
                    <CardTitle className="truncate pr-4" title={w.name}>{w.name}</CardTitle>
                    <FileJson className="w-5 h-5 text-slate-400" />
                </div>
                <CardDescription className="line-clamp-2 h-10" title={w.description || undefined}>
                    {w.description?.split("[Missing")[0] || "No description"}
                </CardDescription>
            </CardHeader>
            <CardContent>
                {missing.length > 0 && (
                    <div className="bg-amber-50 rounded-md p-3 border border-amber-200 text-xs">
                        <div className="flex items-center justify-between text-amber-600 font-semibold mb-1">
                            <div className="flex items-center">
                                <AlertTriangle className="w-3 h-3 mr-1" /> missing nodes
                            </div>
                            <Button variant="ghost" size="sm" className="text-amber-700 hover:bg-amber-100" onClick={() => onStartInstall(missing)}>
                                install all
                            </Button>
                        </div>
                        <ul className="list-disc list-inside text-amber-800 space-y-0.5">
                            {missing.map((node, i) => <li key={i}>{node}</li>)}
                        </ul>
                    </div>
                )}
                <div className="mt-4 flex gap-2 text-xs text-slate-500">
                    <span className="bg-slate-100 px-2 py-1 rounded">{Object.keys(w.graph_json).length} nodes</span>
                    <span className="bg-slate-100 px-2 py-1 rounded">{Object.keys(stripSchemaMeta(w.input_schema)).length} params</span>
                </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2 text-slate-400">
                <Button variant="ghost" size="sm" onClick={() => onViewGraph(w)}>
                    <GitBranch className="w-4 h-4 mr-1" /> view graph
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onExport(w)}>
                    <Save className="w-4 h-4 mr-1" /> export
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onEdit(w)}>
                    <Edit2 className="w-4 h-4 mr-1" /> edit
                </Button>
                <Button variant="ghost" size="sm" className="hover:text-red-500" onClick={() => onDelete(w.id)}>
                    <Trash2 className="w-4 h-4" />
                </Button>
            </CardFooter>
        </Card>
    );
};


export default function WorkflowLibrary() {
    const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importName, setImportName] = useState("");
    const [importDescription, setImportDescription] = useState("");
    const [isImporting, setIsImporting] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    // Edit State
    const [editingWorkflow, setEditingWorkflow] = useState<WorkflowTemplate | null>(null);
    const [schemaEdits, setSchemaEdits] = useState<any>(null);
    const [editName, setEditName] = useState("");
    const [nameError, setNameError] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const generation = useGeneration();

    // Install State
    const [installOpen, setInstallOpen] = useState(false);
    const [installStatus, setInstallStatus] = useState<any>(null);
    const [allowManualClone, setAllowManualClone] = useState(true);
    // eslint-disable-line @typescript-eslint/no-unused-vars
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Visibility Dialog
    const [visibilityDialogOpen, setVisibilityDialogOpen] = useState(false);

    // Graph Viewer State
    const [viewGraphOpen, setViewGraphOpen] = useState(false);
    const [selectedWorkflowForGraph, setSelectedWorkflowForGraph] = useState<WorkflowTemplate | null>(null);

    // Composition State
    const [composeOpen, setComposeOpen] = useState(false);
    const [composeSource, setComposeSource] = useState<string>("");
    const [composeTarget, setComposeTarget] = useState<string>("");
    const [composeName, setComposeName] = useState("");
    const [nodeOrder, setNodeOrder] = useState<string[]>([]);
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 6 }
        })
    );
    const [composeDescription, setComposeDescription] = useState("");

    // --- Polling & Install Logic (Moved up to avoid initialization errors) ---
    const stopPolling = () => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
    };

    const startPolling = (jobId: string) => {
        stopPolling();
        pollIntervalRef.current = setInterval(async () => {
            try {
                const status = await api.getInstallStatus(jobId);
                setInstallStatus(status);
                if (status.status === "completed" || status.status === "failed") {
                    stopPolling();
                }
            } catch (err) {
                console.error("Poll error", err);
            }
        }, 1000);
    };

    const startInstall = async (missing: string[]) => {
        setInstallOpen(true);
        setInstallStatus({ status: "pending", progress_text: "Initializing..." });
        try {
            const res = await api.installMissingNodes(missing, allowManualClone);
            startPolling(res.job_id);
        } catch (err) {
            setInstallStatus({ status: "failed", error: `Start failed: ${(err as Error).message}`, progress_text: "" });
        }
    };

    const handleReboot = async () => {
        if (!confirm("Reboot ComfyUI now? This will disconnect the interface momentarily.")) return;
        await api.rebootComfyUI();
        alert("Reboot triggered. Please wait a few moments for ComfyUI to restart.");
        setInstallOpen(false);
    };

    // Use workflows from context if available (faster on navigation)
    const contextWorkflows = generation?.workflows;

    const loadWorkflows = async () => {
        try {
            const data = await api.getWorkflows();
            setWorkflows(data);
        } catch (err) {
            setError("Failed to load workflows");
        }
    };

    useEffect(() => {
        // If context already has workflows, use them initially
        if (contextWorkflows && contextWorkflows.length > 0) {
            setWorkflows(contextWorkflows);
        } else {
            loadWorkflows();
        }
        return () => stopPolling();
    }, [contextWorkflows]);



    const getMissingNodes = (workflow: WorkflowTemplate): string[] => {
        if (workflow.description && workflow.description.includes("[Missing Nodes:")) {
            const parts = workflow.description.split("[Missing Nodes: ");
            if (parts.length > 1) {
                return parts[1].replace("]", "").split(", ");
            }
        }
        return [];
    };

    // --- Import Logic ---
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setImportFile(file);
            setImportName(file.name.replace(".json", ""));

            file.text().then(text => {
                try {
                    const parsed = JSON.parse(text);
                    if (parsed?._sweet_tea?.name) {
                        setImportName(parsed._sweet_tea.name);
                    }
                } catch (err) {
                    console.debug("Ignoring filename inference error", err);
                }
            }).catch(() => {
                // ignore background parse errors; manual name entry still works
            });
        }
    };

    const handleImport = async () => {
        if (!importFile) return;
        setIsImporting(true);
        try {
            const text = await importFile.text();
            const graph = JSON.parse(text);

            const cleanedDescription = importDescription.trim().slice(0, 500);

            if (graph.nodes && Array.isArray(graph.nodes)) {
                alert("It looks like you uploaded a 'Saved' workflow. Please use 'Save (API Format)' in ComfyUI.");
                setIsImporting(false);
                return;
            }

            const bundleName = importName || graph?._sweet_tea?.name || importFile.name.replace(".json", "");

            await api.importWorkflow({
                data: graph,
                name: bundleName,
                description: cleanedDescription || graph?._sweet_tea?.description,
            });

            setImportFile(null);
            setImportName("");
            setImportDescription("");
            setIsDialogOpen(false);
            loadWorkflows();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Import failed");
        } finally {
            setIsImporting(false);
        }
    };

    const handleExport = async (workflow: WorkflowTemplate) => {
        try {
            const bundle = await api.exportWorkflow(workflow.id);
            const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            const safeName = (workflow.name || `workflow_${workflow.id}`).replace(/[^a-z0-9-_]+/gi, "_").toLowerCase();
            link.download = `${safeName}_pipe.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to export workflow");
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm("Are you sure?")) return;
        try {
            await fetch(`/api/v1/workflows/${id}`, { method: "DELETE" });
            setWorkflows(workflows.filter(w => w.id !== id));
        } catch (err) {
            setError("Failed to delete");
        }
    };

    // --- Compose Logic ---
    const handleCompose = async () => {
        if (!composeSource || !composeTarget || !composeName) return;
        try {
            const cleanedDescription = composeDescription.trim().slice(0, 500);
            const res = await fetch("/api/v1/workflows/compose", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    source_id: parseInt(composeSource),
                    target_id: parseInt(composeTarget),
                    name: composeName,
                    description: cleanedDescription || undefined
                })
            });

            if (!res.ok) {
                const body = await res.json();
                throw new Error(body.detail || "Composition failed");
            }

            setComposeOpen(false);
            setComposeName("");
            setComposeSource("");
            setComposeTarget("");
            setComposeDescription("");
            loadWorkflows();
            alert("pipe created successfully!");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Composition failed");
        }
    };

    // --- Edit Logic ---
    const handleEdit = (w: WorkflowTemplate) => {
        const edits = JSON.parse(JSON.stringify(w.input_schema));
        const orderedIds = getNodeDisplayOrder(w.graph_json, edits);
        edits.__node_order = orderedIds;
        setEditingWorkflow(w);
        setSchemaEdits(edits);
        setNodeOrder(orderedIds);
        setEditName(w.name);
        setNameError("");
    };

    const validateName = (value: string, currentId?: number) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) return "name is required";

        const duplicate = workflows.some(w => w.id !== currentId && w.name.toLowerCase() === trimmed.toLowerCase());
        if (duplicate) return "name must be unique";

        return "";
    };

    const handleSaveSchema = async () => {
        if (!editingWorkflow || !schemaEdits) return;

        const validationError = validateName(editName, editingWorkflow.id);
        if (validationError) {
            setNameError(validationError);
            return;
        }

        const payload: WorkflowTemplate = {
            ...editingWorkflow,
            name: editName.trim(),
            input_schema: schemaEdits
        };

        setIsSaving(true);
        setWorkflows(prev => prev.map(w => w.id === payload.id ? payload : w));
        try {
            await api.updateWorkflow(payload.id, payload);
            setEditingWorkflow(null);
            setNodeOrder([]);
            setSchemaEdits(null);
            await loadWorkflows();
            await generation?.refreshWorkflows();
        } catch (err) {
            setError("Failed to save schema");
            await loadWorkflows();
        } finally {
            setIsSaving(false);
        }
    };

    useEffect(() => {
        if (!editingWorkflow || !schemaEdits) return;
        const desiredOrder = getNodeDisplayOrder(editingWorkflow.graph_json, schemaEdits);
        if (!arraysEqual(nodeOrder, desiredOrder)) {
            setNodeOrder(desiredOrder);
            setSchemaEdits((prev: any) => ({ ...prev, __node_order: desiredOrder }));
        }
    }, [editingWorkflow, nodeOrder, schemaEdits]);

    if (editingWorkflow) {
        const displayOrder = nodeOrder.length > 0 ? nodeOrder : getNodeDisplayOrder(editingWorkflow.graph_json, schemaEdits);
        const sortedNodeIds = displayOrder;



        const buildNodeRenderData = (nodeId: string): RenderNode | null => {
            const node = editingWorkflow.graph_json[nodeId];
            if (!node) return null;

            const allParams = Object.entries(schemaEdits)
                .filter(([_, val]: [string, any]) => String(val.x_node_id) === String(nodeId));

            const active = allParams.filter(([_, val]: [string, any]) => !val.__hidden);
            const hidden = allParams.filter(([_, val]: [string, any]) => val.__hidden);

            if (active.length === 0 && hidden.length === 0) return null;
            const hiddenInControls = Boolean(node._meta?.hiddenInControls);

            return {
                id: nodeId,
                title: node._meta?.title || node.title || `Node ${nodeId}`,
                type: node.class_type,
                active,
                hidden,
                hiddenInControls
            };
        };

        const nodesRenderData = displayOrder
            .map(nodeId => buildNodeRenderData(nodeId))
            .filter((n): n is RenderNode => Boolean(n));

        const handleDragEnd = (event: any) => {
            const { active, over } = event;
            if (!over || active.id === over.id) return;
            const oldIndex = displayOrder.indexOf(String(active.id));
            const newIndex = displayOrder.indexOf(String(over.id));
            if (oldIndex === -1 || newIndex === -1) return;
            const updated = arrayMove(displayOrder, oldIndex, newIndex);
            setNodeOrder(updated);
            setSchemaEdits((prev: any) => ({ ...prev, __node_order: updated }));
        };



        const toggleHidden = (nodeId: string, hidden: boolean) => {
            const updatedGraph = { ...editingWorkflow.graph_json };
            const targetNode = updatedGraph[nodeId];
            if (!targetNode) return;

            updatedGraph[nodeId] = {
                ...targetNode,
                _meta: { ...(targetNode._meta || {}), hiddenInControls: hidden }
            };

            setEditingWorkflow({ ...editingWorkflow, graph_json: updatedGraph });
        };

        return (
            <div className="container mx-auto p-4 h-[calc(100vh-4rem)] flex flex-row gap-4">
                {/* Left Sidebar */}
                <div className="w-72 flex-shrink-0 flex flex-col bg-white border rounded-lg p-4">
                    <h1 className="text-xl font-bold mb-4">edit pipe</h1>

                    {/* Pipe Name */}
                    <div className="space-y-1 mb-4">
                        <Label htmlFor="pipe-name" className="text-sm">pipe name</Label>
                        <Input
                            id="pipe-name"
                            value={editName}
                            onChange={(e) => {
                                setEditName(e.target.value);
                                if (nameError) setNameError(validateName(e.target.value, editingWorkflow.id));
                            }}
                            onBlur={() => setNameError(validateName(editName, editingWorkflow.id))}
                            placeholder="enter a unique name"
                            className="text-sm"
                        />
                        {nameError && <span className="text-xs text-red-600">{nameError}</span>}
                    </div>

                    {/* Description */}
                    <div className="space-y-1 mb-4">
                        <Label htmlFor="edit-description" className="text-sm">description</Label>
                        <Textarea
                            id="edit-description"
                            value={editingWorkflow.description || ""}
                            onChange={(e) => setEditingWorkflow({ ...editingWorkflow, description: e.target.value.slice(0, 500) })}
                            placeholder="summarize what this pipe generates"
                            maxLength={500}
                            rows={6}
                            className="text-sm resize-none"
                        />
                        <div className="text-[10px] text-slate-400 text-right">{(editingWorkflow.description || "").length}/500</div>
                    </div>

                    {/* Spacer to push buttons to bottom */}
                    <div className="flex-1" />

                    {/* Action Buttons */}
                    <div className="space-y-2 pt-4 border-t">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="secondary" size="sm" className="w-full justify-start">
                                    <AlertTriangle className="w-4 h-4 mr-2" />
                                    manage bypasses
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>add node bypass toggle</DialogTitle>
                                    <DialogDescription>
                                        Select a node to allow bypassing.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                                    {Object.entries(editingWorkflow.graph_json)
                                        .map(([id, node]: [string, any]) => {
                                            const bypassKey = `__bypass_${id}`;
                                            const hasBypass = !!schemaEdits[bypassKey];
                                            const isBypassedByDefault = hasBypass && schemaEdits[bypassKey]?.default === true;

                                            return (
                                                <div key={id} className={cn("flex justify-between items-center p-2 border rounded hover:bg-slate-50 transition-colors", hasBypass && "bg-blue-50 border-blue-200")}>
                                                    <div>
                                                        <div className="font-bold text-sm flex items-center gap-2">
                                                            {node._meta?.title || node.title || `Node ${id}`}
                                                            {hasBypass && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-mono">BYPASSABLE</span>}
                                                            {isBypassedByDefault && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-mono">DEFAULT OFF</span>}
                                                        </div>
                                                        <div className="text-xs text-slate-500">{node.class_type}</div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {hasBypass && (
                                                            <div className="flex items-center gap-2 mr-2">
                                                                <span className="text-[10px] text-slate-500">
                                                                    {isBypassedByDefault ? "off by default" : "on by default"}
                                                                </span>
                                                                <Switch
                                                                    checked={isBypassedByDefault}
                                                                    onCheckedChange={(checked) => {
                                                                        const s = { ...schemaEdits };
                                                                        s[bypassKey] = {
                                                                            ...s[bypassKey],
                                                                            default: checked
                                                                        };
                                                                        setSchemaEdits(s);
                                                                    }}
                                                                    className={cn("h-4 w-7", isBypassedByDefault ? "bg-amber-500" : "bg-slate-200")}
                                                                />
                                                            </div>
                                                        )}
                                                        <Button
                                                            size="sm"
                                                            variant={hasBypass ? "destructive" : "outline"}
                                                            onClick={() => {
                                                                const s = { ...schemaEdits };
                                                                if (hasBypass) {
                                                                    delete s[bypassKey];
                                                                } else {
                                                                    s[bypassKey] = {
                                                                        title: `Bypass ${node._meta?.title || node.title || id}`,
                                                                        widget: "toggle",
                                                                        x_node_id: id,
                                                                        type: "boolean",
                                                                        default: false
                                                                    };
                                                                }
                                                                setSchemaEdits(s);
                                                            }}
                                                        >
                                                            {hasBypass ? "Remove" : "Enable"}
                                                        </Button>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    }
                                </div>
                            </DialogContent>
                        </Dialog>

                        <Dialog open={visibilityDialogOpen} onOpenChange={setVisibilityDialogOpen}>
                            <DialogTrigger asChild>
                                <Button variant="secondary" size="sm" className="w-full justify-start">
                                    <GitBranch className="w-4 h-4 mr-2" />
                                    manage visibility
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-xl">
                                <DialogHeader>
                                    <DialogTitle>Hide nodes from configurator</DialogTitle>
                                    <DialogDescription>
                                        Hidden nodes stay in the execution graph with their defaults intact; they just don't show up in the configurator UI.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="space-y-3 max-h-[60vh] overflow-y-auto pt-2">
                                    {sortedNodeIds.map((id) => {
                                        const node = editingWorkflow.graph_json[id];
                                        if (!node) return null;
                                        const hidden = Boolean(node._meta?.hiddenInControls);
                                        return (
                                            <div
                                                key={id}
                                                className={cn(
                                                    "flex items-center justify-between rounded border bg-white px-3 py-2 shadow-sm",
                                                    hidden && "border-amber-200 bg-amber-50"
                                                )}
                                            >
                                                <div className="flex flex-col gap-0.5">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-mono text-slate-500">#{id}</span>
                                                        <span className="text-sm font-semibold text-slate-800">{node._meta?.title || node.title || `Node ${id}`}</span>
                                                        {hidden && (
                                                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-700">
                                                                Hidden in controls
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-[11px] text-slate-500">{node.class_type}</span>
                                                </div>

                                                <Switch
                                                    checked={hidden}
                                                    onCheckedChange={(checked) => toggleHidden(String(id), checked)}
                                                    className={cn("h-5 w-9", hidden ? "bg-amber-500" : "bg-slate-200")}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>

                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setVisibilityDialogOpen(false)}>Close</Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>

                        <div className="flex gap-2 pt-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="flex-1"
                                onClick={() => { setEditingWorkflow(null); setNodeOrder([]); }}
                                disabled={isSaving}
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                className="flex-1"
                                onClick={handleSaveSchema}
                                disabled={Boolean(nameError) || isSaving}
                            >
                                <Save className="w-4 h-4 mr-1" /> {isSaving ? "Saving..." : "Save"}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Right Content - Pipe Parameters */}
                <Card className="flex-1 overflow-auto bg-slate-50/50">
                    <CardHeader className="pb-4">
                        <CardTitle>Pipe Parameters</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {nodesRenderData.length === 0 && <div className="text-center text-slate-400 py-8">No parameters exposed.</div>}

                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <SortableContext items={nodesRenderData.map(node => node.id)} strategy={verticalListSortingStrategy}>
                                {nodesRenderData.map(node => (
                                    <NodeCard key={node.id} node={node} schemaEdits={schemaEdits} setSchemaEdits={setSchemaEdits} />
                                ))}
                            </SortableContext>
                        </DndContext>
                    </CardContent>
                </Card>
            </div>
        );
    }


    // --- Graph Viewer Logic ---
    const handleViewGraph = (w: WorkflowTemplate) => {
        setSelectedWorkflowForGraph(w);
        setViewGraphOpen(true);
    };

    // --- Workflow Card Drag-to-Reorder ---
    const handleWorkflowDragEnd = async (event: any) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = workflows.findIndex(w => w.id === active.id);
        const newIndex = workflows.findIndex(w => w.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return;

        const reordered = arrayMove(workflows, oldIndex, newIndex);

        // Optimistically update UI
        setWorkflows(reordered);

        // Calculate new display_order values (index-based)
        const orderUpdate = reordered.map((w, idx) => ({
            id: w.id,
            display_order: idx
        }));

        try {
            await api.reorderWorkflows(orderUpdate);
            // Refresh context so dropdown gets updated order
            await generation?.refreshWorkflows();
        } catch (err) {
            console.error("Failed to persist workflow order:", err);
            // Revert on error
            loadWorkflows();
        }
    };



    return (
        <div className="container mx-auto p-4 overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">{labels.pageTitle.pipes}</h1>
                <div className="flex gap-2">
                    <Dialog open={composeOpen} onOpenChange={(open) => {
                        setComposeOpen(open);
                        if (!open) {
                            setComposeName("");
                            setComposeSource("");
                            setComposeTarget("");
                            setComposeDescription("");
                        }
                    }}>
                        <DialogTrigger asChild>
                            <Button variant="outline">compose</Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>compose pipes</DialogTitle>
                                <DialogDescription>merge two pipes by piping the output of one into the other.</DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="source" className="text-right">source pipe (image)</Label>
                                    <select
                                        id="source"
                                        className="col-span-3 flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        value={composeSource}
                                        onChange={(e) => setComposeSource(e.target.value)}
                                    >
                                        <option value="">select source pipe...</option>
                                        {workflows.map(w => (
                                            <option key={w.id} value={w.id}>{w.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="target" className="text-right">target pipe (loadimage)</Label>
                                    <select
                                        id="target"
                                        className="col-span-3 flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        value={composeTarget}
                                        onChange={(e) => setComposeTarget(e.target.value)}
                                    >
                                        <option value="">select target pipe...</option>
                                        {workflows.map(w => (
                                            <option key={w.id} value={w.id}>{w.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="compose-name" className="text-right">new pipe name</Label>
                                    <Input id="compose-name" value={composeName} onChange={(e) => setComposeName(e.target.value)} className="col-span-3" />
                                </div>
                                <div className="grid grid-cols-4 items-start gap-4">
                                    <Label htmlFor="compose-description" className="text-right mt-2">description</Label>
                                    <div className="col-span-3 space-y-1">
                                        <Textarea
                                            id="compose-description"
                                            value={composeDescription}
                                            onChange={(e) => setComposeDescription(e.target.value.slice(0, 500))}
                                            placeholder="how should this composed pipe be used?"
                                            maxLength={500}
                                        />
                                        <div className="text-[11px] text-slate-500 text-right">{composeDescription.length}/500</div>
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleCompose} disabled={!composeSource || !composeTarget || !composeName}>
                                    create composition
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <Dialog open={isDialogOpen} onOpenChange={(open) => {
                        setIsDialogOpen(open);
                        if (!open) {
                            setImportFile(null);
                            setImportName("");
                            setImportDescription("");
                        }
                    }}>
                        <DialogTrigger asChild>
                            <Button>import pipe</Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>import pipe from comfyui</DialogTitle>
                                <DialogDescription>
                                    Upload a Sweet Tea export bundle (includes integrity metadata) or a ComfyUI <b>Save (API Format)</b> JSON.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="name" className="text-right">pipe name</Label>
                                    <Input id="name" value={importName} onChange={(e) => setImportName(e.target.value)} className="col-span-3" />
                                </div>
                                <div className="grid grid-cols-4 items-start gap-4">
                                    <Label htmlFor="description" className="text-right mt-2">description</Label>
                                    <div className="col-span-3 space-y-1">
                                        <Textarea
                                            id="description"
                                            value={importDescription}
                                            onChange={(e) => setImportDescription(e.target.value.slice(0, 500))}
                                            placeholder="what does this pipe do?"
                                            maxLength={500}
                                        />
                                        <div className="text-[11px] text-slate-500 text-right">{importDescription.length}/500</div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="file" className="text-right">file</Label>
                                    <Input id="file" type="file" accept=".json" onChange={handleFileChange} className="col-span-3" />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button disabled={!importFile || isImporting} onClick={handleImport}>
                                    {isImporting ? "importing..." : "import"}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {error && (
                <Alert variant="destructive" className="mb-6">
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleWorkflowDragEnd}>
                <SortableContext items={workflows.map(w => w.id)} strategy={rectSortingStrategy}>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {workflows.map((w) => {
                            const missing = getMissingNodes(w);
                            return (
                                <SortableWorkflowCard
                                    key={w.id}
                                    workflow={w}
                                    missing={missing}
                                    onViewGraph={handleViewGraph}
                                    onExport={handleExport}
                                    onEdit={handleEdit}
                                    onDelete={handleDelete}
                                    onStartInstall={startInstall}
                                />
                            );
                        })}
                    </div>
                </SortableContext>
            </DndContext>

            {/* Graph Viewer Dialog */}
            <Dialog open={viewGraphOpen} onOpenChange={setViewGraphOpen}>
                <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>pipe graph: {selectedWorkflowForGraph?.name}</DialogTitle>
                        <DialogDescription>
                            visual topology of the pipe
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 min-h-0 bg-slate-50 border rounded-md">
                        {selectedWorkflowForGraph && (
                            <WorkflowGraphViewer graph={selectedWorkflowForGraph.graph_json} />
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Install Dialog */}
            <Dialog open={installOpen} onOpenChange={(open) => {
                // Prevent closing if running?
                if (!open && installStatus?.status === "running") return;
                setInstallOpen(open);
                if (!open) stopPolling();
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>install missing nodes</DialogTitle>
                        <DialogDescription>
                            using comfyui manager to install nodes.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-4 space-y-4">
                        <div className="flex items-center justify-between rounded-md border p-3 bg-slate-50">
                            <div>
                                <div className="text-sm font-semibold">allow manual git clone fallback</div>
                                <p className="text-xs text-slate-600">if comfyui manager fails, opt into raw git clone/install to continue.</p>
                            </div>
                            <Switch checked={allowManualClone} onCheckedChange={setAllowManualClone} />
                        </div>

                        {!installStatus ? (
                            <div className="text-center text-slate-500">Starting...</div>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <span className="font-semibold capitalize text-sm">Status: {installStatus.status}</span>
                                    {installStatus.status === "running" && <RotateCw className="w-4 h-4 animate-spin text-blue-500" />}
                                    {installStatus.status === "completed" && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                                    {installStatus.status === "failed" && <XCircle className="w-5 h-5 text-red-500" />}
                                </div>

                                <div className="text-sm text-slate-600 bg-slate-50 p-2 rounded">
                                    {installStatus.progress_text}
                                </div>

                                {installStatus.installed && installStatus.installed.length > 0 && (
                                    <div>
                                        <div className="text-xs font-semibold mb-1 text-green-700">successfully installed:</div>
                                        <div className="text-xs space-y-1">
                                            {installStatus.installed.map((item: string, i: number) => (
                                                <div key={i} className="flex items-center"><CheckCircle2 className="w-3 h-3 mr-1 text-green-500" /> {item}</div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {installStatus.failed && installStatus.failed.length > 0 && (
                                    <div>
                                        <div className="text-xs font-semibold mb-1 text-red-700">failed to install:</div>
                                        <div className="text-xs space-y-1 text-red-600">
                                            {installStatus.failed.map((item: string, i: number) => (
                                                <div key={i} className="flex items-center"><XCircle className="w-3 h-3 mr-1" /> {item}</div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {installStatus.unknown && installStatus.unknown.length > 0 && (
                                    <div>
                                        <div className="text-xs font-semibold mb-1 text-amber-700">unknown nodes (no repo found):</div>
                                        <div className="text-xs space-y-1 text-amber-600">
                                            {installStatus.unknown.map((item: string, i: number) => (
                                                <div key={i}>• {item}</div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {installStatus.error && (
                                    <div className="text-sm text-red-600 bg-red-50 p-2 rounded border border-red-200">
                                        Error: {installStatus.error}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        {installStatus?.status === "completed" ? (
                            <div className="flex w-full justify-between items-center">
                                <div className="text-xs text-slate-500">reboot required to apply changes.</div>
                                <div className="flex gap-2">
                                    <Button variant="ghost" onClick={() => setInstallOpen(false)}>close</Button>
                                    <Button variant="default" onClick={handleReboot}>reboot now</Button>
                                </div>
                            </div>
                        ) : (
                            <Button variant="outline" onClick={() => setInstallOpen(false)} disabled={installStatus?.status === "running"}>
                                close
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
