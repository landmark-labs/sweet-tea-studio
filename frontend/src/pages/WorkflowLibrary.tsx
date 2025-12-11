import React, { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { FileJson, AlertTriangle, GitBranch, Edit2, Trash2, Save, RotateCw, CheckCircle2, XCircle } from "lucide-react";
import { api, WorkflowTemplate } from "@/lib/api";
import { WorkflowGraphViewer } from "@/components/WorkflowGraphViewer";
import { cn } from "@/lib/utils";
import { labels } from "@/ui/labels";

export default function WorkflowLibrary() {
    const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importName, setImportName] = useState("");
    const [isImporting, setIsImporting] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    // Edit State
    const [editingWorkflow, setEditingWorkflow] = useState<WorkflowTemplate | null>(null);
    const [schemaEdits, setSchemaEdits] = useState<any>(null);

    // Install State
    const [installOpen, setInstallOpen] = useState(false);
    const [installStatus, setInstallStatus] = useState<any>(null);
    const [allowManualClone, setAllowManualClone] = useState(false);
    // eslint-disable-line @typescript-eslint/no-unused-vars
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Graph Viewer State
    const [viewGraphOpen, setViewGraphOpen] = useState(false);
    const [selectedWorkflowForGraph, setSelectedWorkflowForGraph] = useState<WorkflowTemplate | null>(null);

    // Composition State
    const [composeOpen, setComposeOpen] = useState(false);
    const [composeSource, setComposeSource] = useState<string>("");
    const [composeTarget, setComposeTarget] = useState<string>("");
    const [composeName, setComposeName] = useState("");

    useEffect(() => {
        loadWorkflows();
        return () => stopPolling();
    }, []);

    const loadWorkflows = async () => {
        try {
            const data = await api.getWorkflows();
            setWorkflows(data);
        } catch (err) {
            setError("Failed to load workflows");
        }
    };

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

            if (graph.nodes && Array.isArray(graph.nodes)) {
                alert("It looks like you uploaded a 'Saved' workflow. Please use 'Save (API Format)' in ComfyUI.");
                setIsImporting(false);
                return;
            }

            const bundleName = importName || graph?._sweet_tea?.name || importFile.name.replace(".json", "");
            await api.importWorkflow({
                data: graph,
                name: bundleName,
                description: graph?._sweet_tea?.description,
            });

            setImportFile(null);
            setImportName("");
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
            const res = await fetch("/api/v1/workflows/compose", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    source_id: parseInt(composeSource),
                    target_id: parseInt(composeTarget),
                    name: composeName
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
            loadWorkflows();
            alert("pipe created successfully!");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Composition failed");
        }
    };

    // --- Edit Logic ---
    const handleEdit = (w: WorkflowTemplate) => {
        setEditingWorkflow(w);
        setSchemaEdits(JSON.parse(JSON.stringify(w.input_schema)));
    };

    const handleSaveSchema = async () => {
        if (!editingWorkflow || !schemaEdits) return;
        try {
            const res = await fetch(`/api/v1/workflows/${editingWorkflow.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...editingWorkflow, input_schema: schemaEdits })
            });
            if (!res.ok) throw new Error("Failed to update");
            setEditingWorkflow(null);
            loadWorkflows();
        } catch (err) {
            setError("Failed to save schema");
        }
    };

    // Helper: Sort nodes by execution order (simple upstream-first BFS/Topological approximation)
    const getSortedNodeIds = (graph: any) => {
        const ids = Object.keys(graph);
        // This is a naive sort: usually ID order in ComfyUI is creation order, roughly execution order. 
        // A true topological sort requires parsing links, which is heavy here. 
        // We will stick to numeric sort of IDs for stability, as Comfy executes roughly in ID order or link order.
        return ids.sort((a, b) => parseInt(a) - parseInt(b));
    };

    if (editingWorkflow) {
        const sortedNodeIds = getSortedNodeIds(editingWorkflow.graph_json);

        // Group parameters (Exposed vs Hidden) per Node
        // Exposed: keys in schemaEdits where x_node_id matches
        // Hidden: widgets in graph_json NOT in schemaEdits

        const nodesRenderData = sortedNodeIds.map(nodeId => {
            const node = editingWorkflow.graph_json[nodeId];
            if (!node) return null;

            // 1. Get all params associated with this node from the schema
            const allParams = Object.entries(schemaEdits).filter(([_, val]: [string, any]) => String(val.x_node_id) === String(nodeId));

            // 2. Split into Active and Hidden
            // We treat "Hidden" as having the __hidden flag.
            const active = allParams.filter(([_, val]: [string, any]) => !val.__hidden);
            const hidden = allParams.filter(([_, val]: [string, any]) => val.__hidden);

            return {
                id: nodeId,
                title: node._meta?.title || node.title || `Node ${nodeId}`,
                type: node.class_type,
                active,
                hidden
            };
        }).filter(n => n && (n.active.length > 0 || n.hidden.length > 0));

        return (
            <div className="container mx-auto p-4 h-[calc(100vh-4rem)] flex flex-col">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold">edit pipe: {editingWorkflow.name}</h1>
                    <div className="flex gap-2">
                        {/* We reuse the Bypass dialog as a generic "Add stuff" entry point for now */}
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="secondary" size="sm">
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

                                            return (
                                                <div key={id} className={cn("flex justify-between items-center p-2 border rounded hover:bg-slate-50 transition-colors", hasBypass && "bg-blue-50 border-blue-200")}>
                                                    <div>
                                                        <div className="font-bold text-sm flex items-center gap-2">
                                                            {node._meta?.title || node.title || `Node ${id}`}
                                                            {hasBypass && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-mono">BYPASSABLE</span>}
                                                        </div>
                                                        <div className="text-xs text-slate-500">{node.class_type}</div>
                                                    </div>
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
                                            );
                                        })
                                    }
                                </div>
                            </DialogContent>
                        </Dialog>
                        <Button variant="outline" onClick={() => setEditingWorkflow(null)}>Cancel</Button>
                        <Button onClick={handleSaveSchema}><Save className="w-4 h-4 mr-2" /> Save Changes</Button>
                    </div>
                </div>
                <Card className="flex-1 overflow-auto bg-slate-50/50">
                    <CardHeader><CardTitle>Pipe Parameters</CardTitle></CardHeader>
                    <CardContent className="space-y-6">
                        {nodesRenderData.length === 0 && <div className="text-center text-slate-400 py-8">No parameters exposed.</div>}

                        {nodesRenderData.map(node => {
                            // Check if any field in this node is marked as core
                            const isCore = node!.active.some(([_, f]: [string, any]) => f.x_core === true) ||
                                node!.hidden.some(([_, f]: [string, any]) => f.x_core === true);

                            const toggleCore = () => {
                                const s = { ...schemaEdits };
                                // Toggle x_core for all fields belonging to this node
                                [...node!.active, ...node!.hidden].forEach(([key]: [string, any]) => {
                                    s[key].x_core = !isCore;
                                });
                                setSchemaEdits(s);
                            };

                            return (
                                <div key={node!.id} className="bg-white border rounded-lg overflow-hidden shadow-sm">
                                    <div className="px-4 py-2 bg-slate-100 border-b flex justify-between items-center">
                                        <div className="font-semibold text-sm text-slate-700 flex items-center gap-2">
                                            <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-xs font-mono text-slate-500">{node!.id}</div>
                                            {node!.title}
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-2">
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
                                            <span className="text-[10px] font-mono text-slate-400">{node!.type}</span>
                                        </div>
                                    </div>

                                    {/* Active Parameters */}
                                    {node!.active.length > 0 && (
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
                                                {node!.active.map(([key, field]: [string, any]) => (
                                                    <TableRow key={key} className="hover:bg-slate-50/50">
                                                        <TableCell className="py-2">
                                                            <Input
                                                                className="h-7 text-xs"
                                                                value={field.title || ""}
                                                                onChange={(e) => {
                                                                    const s = { ...schemaEdits };
                                                                    s[key].title = e.target.value;
                                                                    setSchemaEdits(s);
                                                                }}
                                                            />
                                                        </TableCell>
                                                        <TableCell className="font-mono text-[10px] text-slate-500 py-2 break-all">{key}</TableCell>
                                                        <TableCell className="text-xs py-2">{field.type}</TableCell>
                                                        <TableCell className="py-2">
                                                            {field.widget === "toggle" || field.type === "boolean" ? (
                                                                <Switch
                                                                    checked={field.default}
                                                                    onCheckedChange={(checked) => {
                                                                        const s = { ...schemaEdits };
                                                                        s[key].default = checked;
                                                                        setSchemaEdits(s);
                                                                    }}
                                                                />
                                                            ) : (
                                                                <Input
                                                                    className="h-7 text-xs"
                                                                    value={String(field.default ?? "")}
                                                                    onChange={(e) => {
                                                                        const s = { ...schemaEdits };
                                                                        // Store raw value - let backend handle type conversion
                                                                        // This allows typing -1, decimals, etc without interference
                                                                        s[key].default = e.target.value;
                                                                        setSchemaEdits(s);
                                                                    }}
                                                                />

                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right py-2">
                                                            <Button variant="ghost" size="sm" className="h-6 text-xs text-slate-500 hover:text-amber-600" onClick={() => {
                                                                // Soft Hide
                                                                const s = { ...schemaEdits };
                                                                s[key].__hidden = true;
                                                                setSchemaEdits(s);
                                                            }}>
                                                                Hide
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}

                                    {/* Hidden Parameters (if any) */}
                                    {node!.hidden.length > 0 && (
                                        <div className="bg-slate-50/50 border-t">
                                            <div className="px-4 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Hidden Parameters</div>
                                            <Table>
                                                <TableBody>
                                                    {node!.hidden.map(([key, field]: [string, any]) => (
                                                        <TableRow key={key} className="hover:bg-slate-100/50 opacity-60">
                                                            <TableCell className="py-2 text-xs text-slate-500 w-[30%]">{field.title || key}</TableCell>
                                                            <TableCell className="font-mono text-[10px] text-slate-400 py-2 w-[20%] break-all">{key}</TableCell>
                                                            <TableCell className="text-xs py-2 text-slate-400 w-[15%]">{field.type}</TableCell>
                                                            <TableCell className="py-2 text-xs text-slate-400 w-[25%]">{String(field.default ?? "-")}</TableCell>
                                                            <TableCell className="text-right py-2 w-[10%]">
                                                                <Button variant="ghost" size="sm" className="h-6 text-xs text-blue-500 hover:text-blue-700" onClick={() => {
                                                                    // Restore
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
                                </div>
                            );
                        })}
                    </CardContent>
                </Card>
            </div>
        );
    }
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

    const stopPolling = () => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
    };

    const handleReboot = async () => {
        if (!confirm("Reboot ComfyUI now? This will disconnect the interface momentarily.")) return;
        await api.rebootComfyUI();
        alert("Reboot triggered. Please wait a few moments for ComfyUI to restart.");
        setInstallOpen(false);
    };

    // --- Graph Viewer Logic ---
    const handleViewGraph = (w: WorkflowTemplate) => {
        setSelectedWorkflowForGraph(w);
        setViewGraphOpen(true);
    };

    if (editingWorkflow) {
        return (
            <div className="container mx-auto p-4 h-[calc(100vh-4rem)] flex flex-col">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold">edit pipe: {editingWorkflow.name}</h1>
                    <div className="flex gap-2">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="secondary" size="sm">
                                    <AlertTriangle className="w-4 h-4 mr-2" />
                                    add bypass
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>add node bypass toggle</DialogTitle>
                                    <DialogDescription>
                                        Select a node to allow bypassing (disabling) in the configurator.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                                    {Object.entries(editingWorkflow.graph_json)
                                        .map(([id, node]: [string, any]) => {
                                            const bypassKey = `__bypass_${id}`;
                                            const hasBypass = !!schemaEdits[bypassKey];

                                            return (
                                                <div key={id} className={cn("flex justify-between items-center p-2 border rounded hover:bg-slate-50 transition-colors", hasBypass && "bg-blue-50 border-blue-200")}>
                                                    <div>
                                                        <div className="font-bold text-sm flex items-center gap-2">
                                                            {node._meta?.title || node.title || `Node ${id}`}
                                                            {hasBypass && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-mono">BYPASSABLE</span>}
                                                        </div>
                                                        <div className="text-xs text-slate-500">{node.class_type}</div>
                                                    </div>
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
                                            );
                                        })
                                    }
                                </div>
                            </DialogContent>
                        </Dialog>
                        <Button variant="outline" onClick={() => setEditingWorkflow(null)}>Cancel</Button>
                        <Button onClick={handleSaveSchema}><Save className="w-4 h-4 mr-2" /> Save Changes</Button>
                    </div>
                </div>
                <Card className="flex-1 overflow-auto">
                    <CardHeader><CardTitle>exposed parameters</CardTitle></CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Field ID</TableHead>
                                    <TableHead>Label</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Default</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {Object.entries(schemaEdits).map(([key, field]: [string, any]) => (
                                    <TableRow key={key}>
                                        <TableCell className="font-mono text-xs">{key}</TableCell>
                                        <TableCell>
                                            <Input
                                                value={field.title || ""}
                                                onChange={(e) => {
                                                    const s = { ...schemaEdits };
                                                    s[key].title = e.target.value;
                                                    setSchemaEdits(s);
                                                }}
                                            />
                                        </TableCell>
                                        <TableCell>{field.type}</TableCell>
                                        <TableCell>{String(field.default)}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" className="text-red-500" onClick={() => {
                                                const s = { ...schemaEdits };
                                                delete s[key];
                                                setSchemaEdits(s);
                                            }}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-4">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">{labels.pageTitle.pipes}</h1>
                <div className="flex gap-2">
                    <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
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
                            </div>
                            <DialogFooter>
                                <Button onClick={handleCompose} disabled={!composeSource || !composeTarget || !composeName}>
                                    Create Composition
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
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
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="file" className="text-right">file</Label>
                                    <Input id="file" type="file" accept=".json" onChange={handleFileChange} className="col-span-3" />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button disabled={!importFile || isImporting} onClick={handleImport}>
                                    {isImporting ? "Importing..." : "Import"}
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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {workflows.map((w) => {
                    const missing = getMissingNodes(w);
                    return (
                        <Card key={w.id} className="relative group hover:shadow-lg transition-shadow">
                            <CardHeader>
                                <div className="flex justify-between items-start">
                                    <CardTitle className="truncate pr-4">{w.name}</CardTitle>
                                    <FileJson className="w-5 h-5 text-slate-400" />
                                </div>
                                <CardDescription className="line-clamp-2 h-10">
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
                                            <Button variant="ghost" size="sm" className="text-amber-700 hover:bg-amber-100" onClick={() => startInstall(missing)}>
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
                                    <span className="bg-slate-100 px-2 py-1 rounded">{Object.keys(w.input_schema).length} params</span>
                                </div>
                            </CardContent>
                            <CardFooter className="flex justify-end gap-2 text-slate-400">
                                <Button variant="ghost" size="sm" onClick={() => handleViewGraph(w)}>
                                    <GitBranch className="w-4 h-4 mr-1" /> View Graph
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleExport(w)}>
                                    <Save className="w-4 h-4 mr-1" /> Export
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleEdit(w)}>
                                    <Edit2 className="w-4 h-4 mr-1" /> Edit
                                </Button>
                                <Button variant="ghost" size="sm" className="hover:text-red-500" onClick={() => handleDelete(w.id)}>
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </CardFooter>
                        </Card>
                    );
                })}
            </div>

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
                        <DialogTitle>Install Missing Nodes</DialogTitle>
                        <DialogDescription>
                            Using ComfyUI Manager to install nodes.
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
                                        <div className="text-xs font-semibold mb-1 text-green-700">Successfully Installed:</div>
                                        <div className="text-xs space-y-1">
                                            {installStatus.installed.map((item: string, i: number) => (
                                                <div key={i} className="flex items-center"><CheckCircle2 className="w-3 h-3 mr-1 text-green-500" /> {item}</div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {installStatus.failed && installStatus.failed.length > 0 && (
                                    <div>
                                        <div className="text-xs font-semibold mb-1 text-red-700">Failed to Install:</div>
                                        <div className="text-xs space-y-1 text-red-600">
                                            {installStatus.failed.map((item: string, i: number) => (
                                                <div key={i} className="flex items-center"><XCircle className="w-3 h-3 mr-1" /> {item}</div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {installStatus.unknown && installStatus.unknown.length > 0 && (
                                    <div>
                                        <div className="text-xs font-semibold mb-1 text-amber-700">Unknown Nodes (No Repo Found):</div>
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
                                <div className="text-xs text-slate-500">Reboot required to apply changes.</div>
                                <div className="flex gap-2">
                                    <Button variant="ghost" onClick={() => setInstallOpen(false)}>Close</Button>
                                    <Button variant="default" onClick={handleReboot}>Reboot Now</Button>
                                </div>
                            </div>
                        ) : (
                            <Button variant="outline" onClick={() => setInstallOpen(false)} disabled={installStatus?.status === "running"}>
                                Close
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
