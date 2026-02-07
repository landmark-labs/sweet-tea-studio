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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileJson, AlertTriangle, GitBranch, Edit2, Trash2, ArrowUpRight, Save, RotateCw, CheckCircle2, XCircle, GripVertical, ChevronDown, ChevronUp, Archive } from "lucide-react";
import { api, WorkflowTemplate, getApiBase } from "@/lib/api";
import { WorkflowGraphViewer } from "@/components/WorkflowGraphViewer";
import { cn } from "@/lib/utils";
import { labels } from "@/ui/labels";
import { stripSchemaMeta } from "@/lib/schema";
import { useGeneration } from "@/lib/GenerationContext";
import { resolveParamTooltip } from "@/components/dynamic-form/fieldUtils";

const arraysEqual = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => val === b[idx]);
};

const isSchemaTextField = (field: any): boolean => {
    if (!field || typeof field !== "object") return false;
    const widget = String(field.widget || "").toLowerCase();
    const type = String(field.type || "").toLowerCase();
    const hasStringEnum = Array.isArray(field.enum) && field.enum.length > 0;
    const hasDynamicOptions =
        Array.isArray(field.options) ||
        Array.isArray(field.x_options) ||
        Boolean(field.x_dynamic_options);
    const isDropdownWidget =
        widget === "select" ||
        widget === "dropdown" ||
        widget === "combo" ||
        widget === "multiselect";
    const isTextWidget = widget === "text" || widget === "textarea";
    const isStringType = type === "string" || type === "string_literal";

    // Caption targets must be free-text fields only.
    return (
        (isTextWidget || (isStringType && !widget)) &&
        !hasStringEnum &&
        !hasDynamicOptions &&
        !isDropdownWidget
    );
};

const normalizeCaptionSourceSelection = (schema: any) => {
    if (!schema || typeof schema !== "object") return schema;
    const next = { ...schema };
    Object.entries(next).forEach(([key, field]) => {
        if (key.startsWith("__")) return;
        if (!field || typeof field !== "object") return;
        if ((field as any)?.x_use_media_caption && !isSchemaTextField(field)) {
            delete (next[key] as any).x_use_media_caption;
        }
    });
    const selected = Object.entries(next)
        .filter(([key, field]) => {
            if (key.startsWith("__")) return false;
            if (!isSchemaTextField(field)) return false;
            return (field as any)?.x_use_media_caption === true;
        })
        .map(([key]) => key);

    if (selected.length <= 1) return next;
    const keep = selected[0];
    for (const key of selected.slice(1)) {
        if (next[key] && typeof next[key] === "object") {
            delete next[key].x_use_media_caption;
        }
    }
    if (keep && next[keep] && typeof next[keep] === "object") {
        next[keep].x_use_media_caption = true;
    }
    return next;
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
    const wrapWithTooltip = (content: React.ReactElement, tooltip?: string) => {
        if (!tooltip) return content;
        return (
            <TooltipProvider delayDuration={200}>
                <Tooltip>
                    <TooltipTrigger asChild>{content}</TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                        <p className="whitespace-pre-wrap">{tooltip}</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "bg-card border border-border rounded-lg overflow-hidden shadow-sm",
                isDragging && "ring-2 ring-ring shadow-lg"
            )}
        >
            <div
                className="px-4 py-2 bg-muted/40 border-b border-border flex justify-between items-center cursor-pointer hover:bg-muted/60 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-card"
                        aria-label="Reorder node"
                        onClick={(e) => e.stopPropagation()}
                        {...attributes}
                        {...listeners}
                    >
                        <GripVertical className="w-4 h-4" />
                    </button>
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-mono text-muted-foreground">{node.id}</div>
                    {/* Alias or Title display */}
                    {currentAlias ? (
                        <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm text-foreground">{currentAlias}</span>
                            <span className="text-[10px] text-muted-foreground">({node.title})</span>
                        </div>
                    ) : (
                        <span className="font-medium text-sm">{node.title}</span>
                    )}
                    {!isExpanded && (
                        <span className="text-[10px] text-muted-foreground ml-1">({paramCount} params)</span>
                    )}
                    {node.hiddenInControls && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                            Hidden
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[10px] text-muted-foreground uppercase">
                            {isCore ? "Core" : "Expanded"}
                        </span>
                        <Switch
                            checked={isCore}
                            onCheckedChange={toggleCore}
                            className={cn(
                                "h-4 w-7",
                                isCore ? "bg-primary" : "bg-muted"
                            )}
                        />
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">{node.type}</span>
                    {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    )}
                </div>
            </div>

            {/* Alias Editor - shown when expanded */}
            {isExpanded && (
                <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center gap-2">
                    <Label htmlFor={`alias-${node.id}`} className="text-xs text-muted-foreground flex-shrink-0">Display Name:</Label>
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
                            className="h-6 text-xs text-muted-foreground hover:text-foreground px-1"
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
                                {node.active.map(([key, field]: [string, any]) => {
                                    const tooltip = resolveParamTooltip(field);
                                    return (
                                        <TableRow key={key} className="hover:bg-muted/30">
                                            <TableCell className="py-2">
                                                {wrapWithTooltip(
                                                    <Input
                                                        className="h-7 text-xs"
                                                        value={field.title || key}
                                                        onChange={(e) => {
                                                            const s = { ...schemaEdits };
                                                            s[key].title = e.target.value;
                                                            setSchemaEdits(s);
                                                        }}
                                                    />,
                                                    tooltip
                                                )}
                                            </TableCell>
                                            <TableCell className="font-mono text-[10px] text-muted-foreground py-2">{key}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground py-2">{field.type}</TableCell>
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
                                            <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive hover:text-destructive" onClick={() => {
                                                const s = { ...schemaEdits };
                                                s[key].__hidden = true;
                                                setSchemaEdits(s);
                                            }}>Hide</Button>
                                        </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}

                    {node.hidden.length > 0 && (
                        <div className="bg-muted/20 border-t border-border">
                            <div className="px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Hidden Parameters</div>
                            <Table>
                                <TableBody>
                                    {node.hidden.map(([key, field]: [string, any]) => {
                                        const tooltip = resolveParamTooltip(field);
                                        const label = field.title || key;
                                        return (
                                            <TableRow key={key} className="hover:bg-muted/30 opacity-60">
                                                <TableCell className="py-2 text-xs text-muted-foreground w-[30%]">
                                                    {wrapWithTooltip(
                                                        <span className={tooltip ? "cursor-help" : undefined}>{label}</span>,
                                                        tooltip
                                                    )}
                                                </TableCell>
                                            <TableCell className="font-mono text-[10px] text-muted-foreground py-2 w-[20%] break-all">{key}</TableCell>
                                            <TableCell className="text-xs py-2 text-muted-foreground w-[15%]">{field.type}</TableCell>
                                            <TableCell className="py-2 text-xs text-muted-foreground w-[25%]">{String(field.default ?? "-")}</TableCell>
                                            <TableCell className="text-right py-2 w-[10%]">
                                                <Button variant="ghost" size="sm" className="h-6 text-xs text-foreground hover:text-foreground" onClick={() => {
                                                    const s = { ...schemaEdits };
                                                    delete s[key].__hidden;
                                                    setSchemaEdits(s);
                                                }}>
                                                    Restore
                                                </Button>
                                            </TableCell>
                                            </TableRow>
                                        );
                                    })}
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
    onArchive: (id: number) => void;
    onUnarchive: (id: number) => void;
    onStartInstall: (nodes: string[]) => void;
}

const SortableWorkflowCard = ({
    workflow: w,
    missing,
    onViewGraph,
    onExport,
    onEdit,
    onDelete,
    onArchive,
    onUnarchive,
    onStartInstall
}: SortableWorkflowCardProps) => {
    const isArchived = Boolean(w.archived_at);
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: w.id, disabled: isArchived });

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
                "relative group min-w-0 overflow-hidden hover:shadow-lg transition-shadow",
                isArchived && "opacity-65 border-dashed",
                isDragging && "ring-2 ring-ring shadow-xl"
            )}
            title={w.description || undefined}
        >
            {/* Drag Handle */}
            {!isArchived && (
                <div
                    {...attributes}
                    {...listeners}
                    className="absolute top-2 left-2 p-1.5 rounded bg-muted/40 hover:bg-muted/60 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors z-10"
                    title="Drag to reorder"
                >
                    <GripVertical className="w-4 h-4" />
                </div>
            )}

            <CardHeader className="pl-10 min-w-0">
                <div className="flex min-w-0 justify-between items-start gap-3">
                    <CardTitle className="min-w-0 truncate pr-1" title={w.name}>{w.name}</CardTitle>
                    <FileJson className="w-5 h-5 text-muted-foreground shrink-0" />
                </div>
                <CardDescription className="line-clamp-2 h-10 break-words" title={w.description || undefined}>
                    {w.description?.split("[Missing")[0] || "No description"}
                </CardDescription>
            </CardHeader>
            <CardContent>
                {missing.length > 0 && (
                    <div className="bg-muted rounded-md p-3 border border-border text-xs">
                        <div className="flex items-center justify-between text-muted-foreground font-semibold mb-1">
                            <div className="flex items-center">
                                <AlertTriangle className="w-3 h-3 mr-1" /> missing nodes
                            </div>
                            <Button variant="ghost" size="sm" className="text-muted-foreground hover:bg-muted" onClick={() => onStartInstall(missing)}>
                                install all
                            </Button>
                        </div>
                        <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                            {missing.map((node, i) => <li key={i} className="break-all">{node}</li>)}
                        </ul>
                    </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="bg-muted/40 px-2 py-1 rounded">{Object.keys(w.graph_json).length} nodes</span>
                    <span className="bg-muted/40 px-2 py-1 rounded">{Object.keys(stripSchemaMeta(w.input_schema)).length} params</span>
                </div>
            </CardContent>
            <CardFooter className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <div className="flex min-w-0 items-center gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-1.5 text-[11px]"
                        onClick={() => onViewGraph(w)}
                        title="view graph"
                        aria-label="view graph"
                    >
                        <GitBranch className="w-3.5 h-3.5 mr-1" />
                        graph
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-1.5 text-[11px]"
                        onClick={() => onEdit(w)}
                        title="edit pipe"
                        aria-label="edit pipe"
                    >
                        <Edit2 className="w-3.5 h-3.5 mr-1" />
                        edit
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-1.5 text-[11px]"
                        onClick={() => onExport(w)}
                        title="export pipe"
                        aria-label="export pipe"
                    >
                        <ArrowUpRight className="w-3.5 h-3.5 mr-1" />
                        export
                    </Button>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                    {isArchived ? (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onUnarchive(w.id)}
                            title="unarchive pipe"
                            aria-label="unarchive pipe"
                        >
                            <Archive className="w-3.5 h-3.5 rotate-180" />
                        </Button>
                    ) : (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onArchive(w.id)}
                            title="archive pipe"
                            aria-label="archive pipe"
                        >
                            <Archive className="w-3.5 h-3.5" />
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:text-destructive"
                        onClick={() => onDelete(w.id)}
                        title="delete pipe"
                        aria-label="delete pipe"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                </div>
            </CardFooter>
        </Card>
    );
};


export default function WorkflowLibrary() {
    const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
    const [showArchived, setShowArchived] = useState(false);
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
    const [isSyncingSchema, setIsSyncingSchema] = useState(false);
    const [showCaptionFieldPicker, setShowCaptionFieldPicker] = useState(false);

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
    const SHOW_PIPE_COMPOSE = false;
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
            const data = await api.getWorkflows(showArchived);
            setWorkflows(data);
        } catch (err) {
            setError("Failed to load workflows");
        }
    };

    useEffect(() => {
        // If context already has workflows, use them initially
        if (!showArchived && contextWorkflows && contextWorkflows.length > 0) {
            setWorkflows(contextWorkflows);
            void loadWorkflows();
        } else {
            void loadWorkflows();
        }
        return () => stopPolling();
    }, [contextWorkflows, showArchived]);



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
            await fetch(`${getApiBase()}/workflows/${id}`, { method: "DELETE" });
            setWorkflows(workflows.filter(w => w.id !== id));
        } catch (err) {
            setError("Failed to delete");
        }
    };

    const handleArchive = async (id: number) => {
        if (!confirm("Archive this pipe?")) return;
        try {
            await api.archiveWorkflow(id);
            await loadWorkflows();
            await generation?.refreshWorkflows?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to archive pipe");
        }
    };

    const handleUnarchive = async (id: number) => {
        try {
            await api.unarchiveWorkflow(id);
            await loadWorkflows();
            await generation?.refreshWorkflows?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to unarchive pipe");
        }
    };

    // --- Compose Logic ---
    const handleCompose = async () => {
        if (!composeSource || !composeTarget || !composeName) return;
        try {
            const cleanedDescription = composeDescription.trim().slice(0, 500);
            const res = await fetch(`${getApiBase()}/workflows/compose`, {
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
        const edits = normalizeCaptionSourceSelection(JSON.parse(JSON.stringify(w.input_schema)));
        const orderedIds = getNodeDisplayOrder(w.graph_json, edits);
        edits.__node_order = orderedIds;
        setEditingWorkflow(w);
        setSchemaEdits(edits);
        setNodeOrder(orderedIds);
        setEditName(w.name);
        setNameError("");
        setShowCaptionFieldPicker(false);
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

        const normalizedSchemaEdits = normalizeCaptionSourceSelection(schemaEdits);
        const payload: WorkflowTemplate = {
            ...editingWorkflow,
            name: editName.trim(),
            input_schema: normalizedSchemaEdits
        };

        setIsSaving(true);
        setWorkflows(prev => prev.map(w => w.id === payload.id ? payload : w));
        try {
            await api.updateWorkflow(payload.id, payload);
            setEditingWorkflow(null);
            setNodeOrder([]);
            setSchemaEdits(null);
            setShowCaptionFieldPicker(false);
            await loadWorkflows();
            await generation?.refreshWorkflows();
        } catch (err) {
            setError("Failed to save schema");
            await loadWorkflows();
        } finally {
            setIsSaving(false);
        }
    };

    const handleSyncSchema = async () => {
        if (!editingWorkflow) return;
        setIsSyncingSchema(true);
        setError(null);
        try {
            const updated = await api.syncWorkflowSchema(editingWorkflow.id);
            setWorkflows(prev => prev.map(w => w.id === updated.id ? updated : w));
            setEditingWorkflow(updated);

            const edits = normalizeCaptionSourceSelection(JSON.parse(JSON.stringify(updated.input_schema)));
            const orderedIds = getNodeDisplayOrder(updated.graph_json, edits);
            edits.__node_order = orderedIds;
            setSchemaEdits(edits);
            setNodeOrder(orderedIds);

            await generation?.refreshWorkflows();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to sync schema");
        } finally {
            setIsSyncingSchema(false);
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
        const activeCaptionFieldKey = Object.entries(schemaEdits || {}).find(
            ([key, field]) =>
                !key.startsWith("__") &&
                isSchemaTextField(field) &&
                (field as any)?.x_use_media_caption === true
        )?.[0] || null;
        const activeCaptionFieldTitle = activeCaptionFieldKey
            ? String(schemaEdits?.[activeCaptionFieldKey]?.title || activeCaptionFieldKey)
            : null;
        const nodeOrderIndex = new Map(displayOrder.map((id, idx) => [String(id), idx]));
        const captionFieldCandidates = Object.entries(schemaEdits || {})
            .filter(([key, field]) => !key.startsWith("__") && isSchemaTextField(field))
            .map(([key, field]) => {
                const nodeId = String((field as any)?.x_node_id ?? key.split(".")[0] ?? "");
                const graphNode = editingWorkflow.graph_json?.[nodeId];
                const nodeLabel =
                    String((field as any)?.x_node_alias || "").trim() ||
                    String(graphNode?._meta?.title || graphNode?.title || (field as any)?.x_title || `node ${nodeId}`);
                const fieldLabel = String((field as any)?.title || key.split(".").slice(-1)[0] || key);
                return { key, nodeId, label: `${nodeLabel} -> ${fieldLabel}` };
            })
            .sort((a, b) => {
                const aIndex = nodeOrderIndex.get(a.nodeId);
                const bIndex = nodeOrderIndex.get(b.nodeId);
                if (aIndex !== undefined && bIndex !== undefined && aIndex !== bIndex) {
                    return aIndex - bIndex;
                }
                if (aIndex !== undefined && bIndex === undefined) return -1;
                if (aIndex === undefined && bIndex !== undefined) return 1;
                return a.label.localeCompare(b.label);
            });

        const setCaptionTargetField = (targetKey: string | null) => {
            const s = { ...schemaEdits };
            Object.entries(s).forEach(([schemaKey, schemaField]) => {
                if (schemaKey.startsWith("__")) return;
                if (!schemaField || typeof schemaField !== "object") return;
                if ((schemaField as any)?.x_use_media_caption) {
                    delete (s[schemaKey] as any).x_use_media_caption;
                }
            });
            if (targetKey && s[targetKey] && isSchemaTextField(s[targetKey])) {
                s[targetKey].x_use_media_caption = true;
            }
            setSchemaEdits(s);
        };

        return (
            <div className="container mx-auto p-4 h-[calc(100vh-4rem)] flex flex-row gap-4">
                {/* Left Sidebar */}
                <div className="w-72 flex-shrink-0 flex flex-col bg-card border border-border rounded-lg p-4">
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
                        {nameError && <span className="text-xs text-destructive">{nameError}</span>}
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
                        <div className="text-[10px] text-muted-foreground text-right">{(editingWorkflow.description || "").length}/500</div>
                    </div>

                    <div className="space-y-2 mb-4 rounded-md border border-border bg-muted/20 p-2">
                        <div className="flex items-center justify-between gap-2">
                            <Label className="text-sm">use media caption</Label>
                            <Button
                                type="button"
                                variant={showCaptionFieldPicker ? "secondary" : "outline"}
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setShowCaptionFieldPicker((prev) => !prev)}
                                disabled={captionFieldCandidates.length === 0}
                            >
                                use media caption
                            </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            {activeCaptionFieldTitle
                                ? `target field: ${activeCaptionFieldTitle}`
                                : "no field selected"}
                        </p>
                        {captionFieldCandidates.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground">
                                no free text fields are available in this pipe
                            </p>
                        ) : showCaptionFieldPicker ? (
                            <div className="space-y-1">
                                <Label htmlFor="caption-target-field" className="text-[10px] text-muted-foreground uppercase">
                                    node to field
                                </Label>
                                <select
                                    id="caption-target-field"
                                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                                    value={activeCaptionFieldKey || ""}
                                    onChange={(e) => setCaptionTargetField(e.target.value || null)}
                                >
                                    <option value="">no field selected</option>
                                    {captionFieldCandidates.map((candidate) => (
                                        <option key={candidate.key} value={candidate.key}>
                                            {candidate.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <p className="text-[10px] text-muted-foreground">
                                press "use media caption" to select a node to field target
                            </p>
                        )}
                    </div>


                    {/* Spacer to push buttons to bottom */}
                    <div className="flex-1" />

                     {/* Action Buttons */}
                     <div className="space-y-2 pt-4 border-t">
                         <Dialog open={visibilityDialogOpen} onOpenChange={setVisibilityDialogOpen}>
                             <DialogTrigger asChild>
                                 <Button variant="secondary" size="sm" className="w-full justify-start">
                                    <GitBranch className="w-4 h-4 mr-2" />
                                    manage nodes
                                </Button>
                             </DialogTrigger>
                            <DialogContent className="max-w-xl">
                                <DialogHeader>
                                    <DialogTitle>Manage nodes</DialogTitle>
                                    <DialogDescription>
                                        Configure bypass toggles and visibility for each node in the configurator.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="space-y-3 max-h-[60vh] overflow-y-auto pt-2">
                                    {sortedNodeIds.map((id) => {
                                        const node = editingWorkflow.graph_json[id];
                                        if (!node) return null;

                                        // Get alias from schema fields for this node
                                        const nodeFields = Object.entries(schemaEdits)
                                            .filter(([_, val]: [string, any]) => String(val.x_node_id) === String(id));
                                        const alias = (nodeFields.find(([_, f]: [string, any]) => f.x_node_alias)?.[1] as any)?.x_node_alias || "";

                                        const hidden = Boolean(node._meta?.hiddenInControls);
                                        const bypassKey = `__bypass_${id}`;
                                        const hasBypass = !!schemaEdits[bypassKey];
                                        const isBypassedByDefault = hasBypass && schemaEdits[bypassKey]?.default === true;

                                        const nodeTitle = node._meta?.title || node.title || `Node ${id}`;

                                        return (
                                            <div
                                                key={id}
                                                className={cn(
                                                    "flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm",
                                                    (hidden || hasBypass) && "border-border bg-muted/30"
                                                )}
                                            >
                                                <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-3">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-xs font-mono text-muted-foreground">#{id}</span>
                                                        {alias ? (
                                                            <div className="flex items-center gap-1">
                                                                <span className="text-sm font-semibold text-foreground">{alias}</span>
                                                                <span className="text-xs text-muted-foreground">({nodeTitle})</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-sm font-semibold text-foreground">{nodeTitle}</span>
                                                        )}
                                                    </div>
                                                    <span className="text-[11px] text-muted-foreground">{node.class_type}</span>
                                                    {hasBypass && isBypassedByDefault && (
                                                        <span className="text-[10px] text-muted-foreground font-medium">
                                                            bypassed by default
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    {/* Bypass toggle button */}
                                                    <div className="flex flex-col items-center gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const s = { ...schemaEdits };
                                                                if (hasBypass) {
                                                                    delete s[bypassKey];
                                                                } else {
                                                                    s[bypassKey] = {
                                                                        title: `Bypass ${nodeTitle}`,
                                                                        widget: "toggle",
                                                                        x_node_id: id,
                                                                        type: "boolean",
                                                                        default: false
                                                                    };
                                                                }
                                                                setSchemaEdits(s);
                                                            }}
                                                            className={cn(
                                                                "w-9 h-9 rounded-lg flex items-center justify-center text-xs font-medium transition-all border",
                                                                hasBypass
                                                                    ? "bg-primary text-white border-primary hover:bg-primary/90"
                                                                    : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                                                            )}
                                                            title={hasBypass ? "Bypass enabled - click to disable" : "Click to enable bypass toggle"}
                                                        >
                                                            <AlertTriangle className="w-4 h-4" />
                                                        </button>
                                                        <span className="text-[9px] text-muted-foreground">bypass</span>
                                                    </div>


                                                    {/* Visibility toggle button */}
                                                    <div className="flex flex-col items-center gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleHidden(String(id), !hidden)}
                                                            className={cn(
                                                                "w-9 h-9 rounded-lg flex items-center justify-center text-xs font-medium transition-all border",
                                                                !hidden
                                                                    ? "bg-primary text-white border-primary hover:bg-primary/90"
                                                                    : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                                                            )}
                                                            title={hidden ? "Hidden in controls - click to show" : "Visible in controls - click to hide"}
                                                        >
                                                            {hidden ? (
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                                                </svg>
                                                            ) : (
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                                </svg>
                                                            )}
                                                        </button>
                                                        <span className="text-[9px] text-muted-foreground">visible</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setVisibilityDialogOpen(false)}>Close</Button>
                                </DialogFooter>
                            </DialogContent>
                         </Dialog>

                         <Button
                             variant="secondary"
                             size="sm"
                             className="w-full justify-start"
                             onClick={handleSyncSchema}
                             disabled={isSaving || isSyncingSchema}
                             title="Backfill schema from graph + current ComfyUI object_info"
                         >
                             <RotateCw className="w-4 h-4 mr-2" />
                             {isSyncingSchema ? "syncing schema..." : "sync schema"}
                         </Button>
 
                         <div className="flex gap-2 pt-2">
                             <Button
                                 variant="outline"
                                 size="sm"
                                 className="flex-1"
                                 onClick={() => { setEditingWorkflow(null); setNodeOrder([]); setShowCaptionFieldPicker(false); }}
                                 disabled={isSaving || isSyncingSchema}
                             >
                                 Cancel
                             </Button>
                             <Button
                                 size="sm"
                                 className="flex-1"
                                 onClick={handleSaveSchema}
                                 disabled={Boolean(nameError) || isSaving || isSyncingSchema}
                             >
                                 <Save className="w-4 h-4 mr-1" /> {isSaving ? "Saving..." : "Save"}
                             </Button>
                         </div>
                     </div>
                 </div>


                {/* Right Content - Pipe Parameters */}
                <Card className="flex-1 overflow-auto bg-muted/10">
                    <CardHeader className="pb-4">
                        <CardTitle>Pipe Parameters</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {nodesRenderData.length === 0 && <div className="text-center text-muted-foreground py-8">No parameters exposed.</div>}

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

        const activeWorkflow = workflows.find(w => w.id === active.id);
        const overWorkflow = workflows.find(w => w.id === over.id);
        if (activeWorkflow?.archived_at || overWorkflow?.archived_at) return;

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
        <div className="pt-4 pr-8 pb-8 pl-[83px] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold tracking-tight">{labels.pageTitle.pipes}</h1>
                <div className="flex gap-2">
                    <Button variant={showArchived ? "secondary" : "ghost"} onClick={() => setShowArchived(!showArchived)}>
                        {showArchived ? "hide archived" : "view archived"}
                    </Button>
                    {SHOW_PIPE_COMPOSE && (
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
                                        <div className="text-[11px] text-muted-foreground text-right">{composeDescription.length}/500</div>
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
                    )}

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
                                        <div className="text-[11px] text-muted-foreground text-right">{importDescription.length}/500</div>
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
                                    onArchive={handleArchive}
                                    onUnarchive={handleUnarchive}
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
                    <div className="flex-1 min-h-0 bg-muted/10 border border-border rounded-md">
                        {selectedWorkflowForGraph && (
                            <WorkflowGraphViewer
                                graph={selectedWorkflowForGraph.graph_json}
                                inputSchema={selectedWorkflowForGraph.input_schema}
                            />
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
                        <div className="flex items-center justify-between rounded-md border border-border p-3 bg-muted/20">
                            <div>
                                <div className="text-sm font-semibold">allow manual git clone fallback</div>
                                <p className="text-xs text-muted-foreground">if comfyui manager fails, opt into raw git clone/install to continue.</p>
                            </div>
                            <Switch checked={allowManualClone} onCheckedChange={setAllowManualClone} />
                        </div>

                        {!installStatus ? (
                            <div className="text-center text-muted-foreground">Starting...</div>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <span className="font-semibold capitalize text-sm">Status: {installStatus.status}</span>
                                    {installStatus.status === "running" && <RotateCw className="w-4 h-4 animate-spin text-primary" />}
                                    {installStatus.status === "completed" && <CheckCircle2 className="w-5 h-5 text-success" />}
                                    {installStatus.status === "failed" && <XCircle className="w-5 h-5 text-destructive" />}
                                </div>

                                <div className="text-sm text-muted-foreground bg-muted/20 p-2 rounded">
                                    {installStatus.progress_text}
                                </div>

                                {installStatus.installed && installStatus.installed.length > 0 && (
                                    <div>
                                        <div className="text-xs font-semibold mb-1 text-success">successfully installed:</div>
                                        <div className="text-xs space-y-1">
                                            {installStatus.installed.map((item: string, i: number) => (
                                                <div key={i} className="flex items-center"><CheckCircle2 className="w-3 h-3 mr-1 text-success" /> {item}</div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {installStatus.failed && installStatus.failed.length > 0 && (
                                    <div>
                                        <div className="text-xs font-semibold mb-1 text-destructive">failed to install:</div>
                                        <div className="text-xs space-y-1 text-destructive">
                                            {installStatus.failed.map((item: string, i: number) => (
                                                <div key={i} className="flex items-center"><XCircle className="w-3 h-3 mr-1" /> {item}</div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {installStatus.unknown && installStatus.unknown.length > 0 && (
                                    <div>
                                        <div className="text-xs font-semibold mb-1 text-muted-foreground">unknown nodes (no repo found):</div>
                                        <div className="text-xs space-y-1 text-muted-foreground">
                                            {installStatus.unknown.map((item: string, i: number) => (
                                                <div key={i}>• {item}</div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {installStatus.error && (
                                    <div className="text-sm text-destructive bg-destructive/10 p-2 rounded border border-destructive/20">
                                        Error: {installStatus.error}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        {installStatus?.status === "completed" ? (
                            <div className="flex w-full justify-between items-center">
                                <div className="text-xs text-muted-foreground">reboot required to apply changes.</div>
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


