import { useEffect } from 'react';
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

interface WorkflowGraphViewerProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    graph: any;
}

// Custom Node for ComfyUI Generic Nodes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ComfyNode = ({ data }: { data: any }) => {
    return (
        <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-slate-200 min-w-[150px]">
            <div className="flex flex-col">
                <div className="font-bold text-xs text-slate-700 mb-1 border-b pb-1">
                    {data.label}
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
                                <span className="text-[10px] text-slate-500">{input.name}</span>
                            </div>
                        ))}
                    </div>

                    {/* Outputs - Right Side handles */}
                    <div className="flex flex-col gap-2 mt-1 text-right">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {data.outputs?.map((output: any, idx: number) => (
                            <div key={idx} className="relative flex items-center justify-end h-4">
                                <span className="text-[10px] text-slate-500 mr-1">{output.name}</span>
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
            <div className="text-[9px] text-slate-400 mt-2 text-center uppercase tracking-wider">
                {data.type}
            </div>
        </div>
    );
};

const nodeTypes = {
    comfyNode: ComfyNode,
};

export function WorkflowGraphViewer({ graph }: WorkflowGraphViewerProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    useEffect(() => {
        if (!graph) return;

        let newNodes: Node[] = [];
        let newEdges: Edge[] = [];

        // CASE A: Standard UI Format (has "nodes" and "links" arrays)
        if (Array.isArray(graph.nodes) && Array.isArray(graph.links)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            graph.nodes.forEach((node: any) => {
                newNodes.push({
                    id: String(node.id),
                    type: 'comfyNode',
                    position: { x: node.pos?.[0] || 0, y: node.pos?.[1] || 0 },
                    data: {
                        label: node.title || node.type,
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
                        label: node._meta?.title || node.class_type,
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
    }, [graph, setNodes, setEdges]);


    return (
        <Card className="w-full h-[600px] bg-slate-50 border-slate-200 overflow-hidden">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                className="bg-slate-50"
                minZoom={0.1}
            >
                <Background color="#ccc" gap={20} />
                <Controls />
            </ReactFlow>
        </Card>
    );
}
