import { useEffect, useMemo, useState } from 'react';
import ReactFlow, {
    Background,
    Controls,
    Node,
    Edge,
    useNodesState,
    useEdgesState,
    MarkerType,
    Handle,
    Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface WorkflowGraphViewerProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    graph: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputSchema?: any;
}

// Custom Node for ComfyUI Generic Nodes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ComfyNode = ({ data }: { data: any }) => {
    return (
        <div
            className={cn(
                "px-4 py-2 shadow-md rounded-md bg-white border-2 min-w-[150px] transition-all",
                data.isSelected
                    ? "border-ring ring-2 ring-ring"
                    : data.isConnected
                        ? "border-border"
                        : "border-border"
            )}
        >
            <div className="flex flex-col">
                <div className="mb-1 border-b pb-1 flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        #{data.nodeId}
                    </span>
                    <span className="font-bold text-xs text-black">{data.label}</span>
                </div>
                <div className="flex justify-between gap-4">
                    {/* Inputs - Left Side handles */}
                    <div className="flex flex-col gap-2 mt-1">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {data.inputs?.map((input: any, idx: number) => (
                            <div key={idx} className="relative flex items-center h-4">
                                <Handle
                                    type="target"
                                    position={Position.Left}
                                    id={input.name}
                                    style={{ left: -16, width: 8, height: 8, background: '#555' }}
                                />
                                <span className="text-[10px] text-muted-foreground">{input.name}</span>
                            </div>
                        ))}
                    </div>

                    {/* Outputs - Right Side handles */}
                    <div className="flex flex-col gap-2 mt-1 text-right">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {data.outputs?.map((output: any, idx: number) => (
                            <div key={idx} className="relative flex items-center justify-end h-4">
                                <span className="text-[10px] text-muted-foreground mr-1">{output.name}</span>
                                <Handle
                                    type="source"
                                    position={Position.Right}
                                    id={String(idx)} // ComfyUI links often use index for output
                                    style={{ right: -16, width: 8, height: 8, background: '#555' }}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div className="text-[9px] text-muted-foreground mt-2 text-center uppercase tracking-wider">
                {data.type}
            </div>
        </div>
    );
};

const nodeTypes = {
    comfyNode: ComfyNode,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buildNodeAliasMap = (schema: any): Record<string, string> => {
    if (!schema || typeof schema !== "object") return {};

    const aliasMap: Record<string, string> = {};
    for (const [key, field] of Object.entries(schema)) {
        if (key.startsWith("__")) continue;
        if (!field || typeof field !== "object") continue;

        const nodeId = (field as any).x_node_id;
        if (nodeId === undefined || nodeId === null) continue;

        const alias = typeof (field as any).x_node_alias === "string" ? (field as any).x_node_alias.trim() : "";
        if (!alias) continue;

        const id = String(nodeId);
        if (!aliasMap[id]) aliasMap[id] = alias;
    }

    return aliasMap;
};

const compareNodeIds = (a: string, b: string) => {
    const aNum = Number(a);
    const bNum = Number(b);
    const aIsNum = Number.isFinite(aNum);
    const bIsNum = Number.isFinite(bNum);

    if (aIsNum && bIsNum) return aNum - bNum;
    if (aIsNum && !bIsNum) return -1;
    if (!aIsNum && bIsNum) return 1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
};

export function WorkflowGraphViewer({ graph, inputSchema }: WorkflowGraphViewerProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

    useEffect(() => {
        if (!graph) return;

        const aliasMap = buildNodeAliasMap(inputSchema);

        let newNodes: Node[] = [];
        const newEdges: Edge[] = [];

        // CASE A: Standard UI Format (has "nodes" and "links" arrays)
        if (Array.isArray(graph.nodes) && Array.isArray(graph.links)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            graph.nodes.forEach((node: any) => {
                const nodeId = String(node.id);
                newNodes.push({
                    id: nodeId,
                    type: 'comfyNode',
                    position: { x: node.pos?.[0] || 0, y: node.pos?.[1] || 0 },
                    data: {
                        nodeId,
                        label: aliasMap[nodeId] || node.title || node.type,
                        type: node.type,
                        inputs: node.inputs || [],
                        outputs: node.outputs || [],
                        properties: node.properties || {}
                    },
                });
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            graph.links.forEach((link: any) => {
                if (Array.isArray(link) && link.length >= 5) {
                    const [id, sourceId, sourceSlot, targetId, targetSlot] = link;
                    newEdges.push({
                        id: String(id),
                        source: String(sourceId),
                        sourceHandle: String(sourceSlot),
                        target: String(targetId),
                        targetHandle: newNodes.find((n) => n.id === String(targetId))?.data?.inputs?.[targetSlot]?.name || String(targetSlot),
                        type: 'smoothstep',
                        markerEnd: { type: MarkerType.ArrowClosed },
                        style: { stroke: '#888' }
                    });
                }
            });

        }
        // CASE B: API Format (Dictionary of ID -> Node)
        else {
            // 1. Identify Nodes & Edges
            const nodeIds = Object.keys(graph);
            const ranks: Record<string, number> = {};
            const complexEdges: { source: string, target: string, handleName: string, sourceIdx: number }[] = [];

            // Create Nodes
            nodeIds.forEach(id => {
                const node = graph[id];
                const inputs = [];

                // Parse dictionary inputs to array for our component
                if (node.inputs) {
                    for (const [key, val] of Object.entries(node.inputs)) {
                        inputs.push({ name: key, type: "wildcard" });
                        // Check for links
                        if (Array.isArray(val) && val.length === 2 && typeof val[0] === 'string') {
                            complexEdges.push({
                                source: val[0],
                                target: id,
                                handleName: key,
                                sourceIdx: val[1] as number
                            });
                        }
                    }
                }

                newNodes.push({
                    id: id,
                    type: 'comfyNode',
                    position: { x: 0, y: 0 }, // Placeholder, will layout below
                    data: {
                        nodeId: id,
                        label: aliasMap[id] || node._meta?.title || node.title || node.class_type,
                        type: node.class_type,
                        inputs: inputs,
                        outputs: [{ name: "output", type: "wildcard" }], // API format doesn't list outputs, assume generically
                        properties: {}
                    }
                });
            });

            // Create ReactFlow Edges
            complexEdges.forEach((e, idx) => {
                newEdges.push({
                    id: `e-${idx}`,
                    source: e.source,
                    sourceHandle: String(e.sourceIdx), // API usually uses index 0 for output unless specified
                    target: e.target,
                    targetHandle: e.handleName,
                    type: 'smoothstep',
                    markerEnd: { type: MarkerType.ArrowClosed },
                    style: { stroke: '#888' }
                });
            });

            // 2. Simple Auto-Layout (Rank-based)
            // Calculate Ranks (Longest path from roots)
            // 5 passes of relaxation
            nodeIds.forEach(id => (ranks[id] = 0));

            for (let i = 0; i < nodeIds.length + 2; i++) {
                let changed = false;
                complexEdges.forEach(e => {
                    if ((ranks[e.source] || 0) + 1 > (ranks[e.target] || 0)) {
                        ranks[e.target] = (ranks[e.source] || 0) + 1;
                        changed = true;
                    }
                });
                if (!changed) break;
            }

            // Group by Rank
            const nodesByRank: Record<number, string[]> = {};
            Object.entries(ranks).forEach(([id, rank]) => {
                if (!nodesByRank[rank]) nodesByRank[rank] = [];
                nodesByRank[rank].push(id);
            });

            // Assign Positions
            const SPACING_X = 300;
            const SPACING_Y = 150;

            newNodes = newNodes.map(n => {
                const rank = ranks[n.id] || 0;
                const indexInRank = nodesByRank[rank].indexOf(n.id);
                return {
                    ...n,
                    position: {
                        x: rank * SPACING_X,
                        y: indexInRank * SPACING_Y
                    }
                };
            });
        }

        setNodes(newNodes);
        setEdges(newEdges);
        setSelectedNodeId(null);
    }, [graph, inputSchema, setNodes, setEdges]);

    const nodeById = useMemo(() => {
        return new Map(nodes.map((node) => [node.id, node]));
    }, [nodes]);

    const connected = useMemo(() => {
        if (!selectedNodeId) {
            return {
                connectedNodeIds: new Set<string>(),
                connectedEdgeIds: new Set<string>(),
                incomingNodeIds: [] as string[],
                outgoingNodeIds: [] as string[],
            };
        }

        const connectedNodeIds = new Set<string>([selectedNodeId]);
        const connectedEdgeIds = new Set<string>();
        const incomingNodeIds = new Set<string>();
        const outgoingNodeIds = new Set<string>();

        edges.forEach((edge) => {
            const isIncoming = edge.target === selectedNodeId;
            const isOutgoing = edge.source === selectedNodeId;
            if (!isIncoming && !isOutgoing) return;

            connectedEdgeIds.add(edge.id);

            if (isIncoming) {
                connectedNodeIds.add(edge.source);
                incomingNodeIds.add(edge.source);
            }

            if (isOutgoing) {
                connectedNodeIds.add(edge.target);
                outgoingNodeIds.add(edge.target);
            }
        });

        return {
            connectedNodeIds,
            connectedEdgeIds,
            incomingNodeIds: Array.from(incomingNodeIds).sort(compareNodeIds),
            outgoingNodeIds: Array.from(outgoingNodeIds).sort(compareNodeIds),
        };
    }, [edges, selectedNodeId]);

    const selectedNode = useMemo(() => {
        if (!selectedNodeId) return null;
        return nodeById.get(selectedNodeId) || null;
    }, [nodeById, selectedNodeId]);

    const renderedNodes = useMemo(() => {
        if (!selectedNodeId) {
            return nodes.map((node) => ({
                ...node,
                data: {
                    ...node.data,
                    isSelected: false,
                    isConnected: false,
                },
                style: { ...node.style, opacity: 1 },
            }));
        }

        return nodes.map((node) => {
            const isSelected = node.id === selectedNodeId;
            const isConnected = connected.connectedNodeIds.has(node.id) && !isSelected;
            const isDimmed = !connected.connectedNodeIds.has(node.id);
            return {
                ...node,
                data: {
                    ...node.data,
                    isSelected,
                    isConnected,
                },
                style: { ...node.style, opacity: isDimmed ? 0.2 : 1 },
            };
        });
    }, [connected.connectedNodeIds, nodes, selectedNodeId]);

    const renderedEdges = useMemo(() => {
        if (!selectedNodeId) return edges;

        return edges.map((edge) => {
            const isConnected = connected.connectedEdgeIds.has(edge.id);
            const baseStyle = (edge.style || {}) as Record<string, unknown>;
            return {
                ...edge,
                animated: isConnected,
                markerEnd: { type: MarkerType.ArrowClosed, color: isConnected ? "#3b82f6" : "#94a3b8" },
                style: {
                    ...baseStyle,
                    stroke: isConnected ? "#3b82f6" : "#94a3b8",
                    strokeWidth: isConnected ? 2 : 1,
                    opacity: isConnected ? 1 : 0.15,
                },
            };
        });
    }, [connected.connectedEdgeIds, edges, selectedNodeId]);

    return (
        <Card className="w-full h-[600px] bg-background border-border overflow-hidden">
            <div className="relative w-full h-full">
                <div className="absolute top-3 right-3 z-10 w-[280px] rounded-md border border-border bg-surface/95 backdrop-blur p-3 shadow-sm">
                    {!selectedNode ? (
                        <div className="text-xs text-muted-foreground">
                            Click a node to see its connections.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                            #{selectedNode.id}
                                        </span>
                                        <span className="text-xs font-semibold text-foreground truncate">
                                            {String((selectedNode.data as any)?.label || selectedNode.id)}
                                        </span>
                                    </div>
                                    <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                                        {String((selectedNode.data as any)?.type || "")}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="text-[10px] text-muted-foreground hover:text-foreground"
                                    onClick={() => setSelectedNodeId(null)}
                                >
                                    Clear
                                </button>
                            </div>

                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                                    Incoming ({connected.incomingNodeIds.length})
                                </div>
                                <div className="max-h-[140px] overflow-auto space-y-1">
                                    {connected.incomingNodeIds.length === 0 ? (
                                        <div className="text-xs text-muted-foreground">None</div>
                                    ) : (
                                        connected.incomingNodeIds.map((id) => {
                                            const node = nodeById.get(id);
                                            const label = node ? String((node.data as any)?.label || id) : id;
                                            return (
                                                <button
                                                    key={`in-${id}`}
                                                    type="button"
                                                    className="w-full text-left rounded px-2 py-1 hover:bg-background"
                                                    onClick={() => setSelectedNodeId(id)}
                                                >
                                                    <span className="text-[10px] font-mono text-muted-foreground">#{id}</span>
                                                    <span className="ml-2 text-xs text-foreground">{label}</span>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                                    Outgoing ({connected.outgoingNodeIds.length})
                                </div>
                                <div className="max-h-[140px] overflow-auto space-y-1">
                                    {connected.outgoingNodeIds.length === 0 ? (
                                        <div className="text-xs text-muted-foreground">None</div>
                                    ) : (
                                        connected.outgoingNodeIds.map((id) => {
                                            const node = nodeById.get(id);
                                            const label = node ? String((node.data as any)?.label || id) : id;
                                            return (
                                                <button
                                                    key={`out-${id}`}
                                                    type="button"
                                                    className="w-full text-left rounded px-2 py-1 hover:bg-background"
                                                    onClick={() => setSelectedNodeId(id)}
                                                >
                                                    <span className="text-[10px] font-mono text-muted-foreground">#{id}</span>
                                                    <span className="ml-2 text-xs text-foreground">{label}</span>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <ReactFlow
                    nodes={renderedNodes}
                    edges={renderedEdges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    nodeTypes={nodeTypes}
                    fitView
                    className="bg-background"
                    minZoom={0.1}
                    proOptions={{ hideAttribution: true }}
                    onNodeClick={(_, node) => setSelectedNodeId((prev) => (prev === node.id ? null : node.id))}
                    onPaneClick={() => setSelectedNodeId(null)}
                >
                    <Background color="#ccc" gap={20} />
                    <Controls />
                </ReactFlow>
            </div>
        </Card>
    );
}

