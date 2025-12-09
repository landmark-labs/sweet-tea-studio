import React, { useEffect, useRef, useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Plus, X, Type, Trash2, CornerDownLeft, Eraser, Check, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUndoRedo } from "@/lib/undoRedo";

// --- Types ---

export type PromptItemType = 'block' | 'text';

export interface PromptItem {
    id: string;
    sourceId?: string; // ID of the library snippet this was created from
    type: PromptItemType;
    content: string; // The actual prompt text
    label?: string; // For blocks, a short name
    color?: string; // For blocks
}

interface PromptConstructorProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: any;
    onUpdate: (field: string, value: string) => void;
    currentValues: Record<string, string>;
    targetField?: string;
    onTargetChange?: (field: string) => void;
    onFinish?: () => void;
}

// --- Constants ---

const COLORS = [
    "bg-blue-100 border-blue-300 text-blue-900",
    "bg-green-100 border-green-300 text-green-900",
    "bg-purple-100 border-purple-300 text-purple-900",
    "bg-amber-100 border-amber-300 text-amber-900",
    "bg-rose-100 border-rose-300 text-rose-900",
    "bg-cyan-100 border-cyan-300 text-cyan-900",
    "bg-slate-100 border-slate-300 text-slate-900",
];

// --- Sub-Components ---

function SortableItem({ item, index, textIndex, onRemove, onUpdateContent }: { item: PromptItem, index: number, textIndex?: number, onRemove: (id: string, e: React.MouseEvent) => void, onUpdateContent: (id: string, val: string) => void }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: item.id });

    const [isEditing, setIsEditing] = useState(false);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : "auto",
    };

    const handleBlur = () => {
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            setIsEditing(false);
        }
    };

    if (item.type === 'text') {
        if (isEditing) {
            return (
                <div ref={setNodeRef} style={style} className="flex items-center gap-1 group relative z-50">
                    <Textarea
                        value={item.content}
                        autoFocus
                        onChange={(e) => onUpdateContent(item.id, e.target.value)}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        className="min-h-[32px] h-auto w-full text-[11px] font-mono border-dashed bg-white shadow-lg ring-2 ring-blue-500 transition-colors resize-y py-1 px-2 rounded-md"
                        placeholder="text..."
                    />
                </div>
            );
        }

        return (
            <HoverCard openDelay={200}>
                <HoverCardTrigger asChild>
                    <div
                        ref={setNodeRef}
                        style={style}
                        className={cn(
                            "flex items-center gap-2 px-2 py-1 rounded-md border shadow-sm cursor-grab active:cursor-grabbing select-none group relative text-[11px] font-medium w-full min-h-[32px] transition-all hover:-translate-y-0.5 hover:shadow-md",
                            "bg-slate-50 border-slate-300 text-slate-700 hover:border-slate-400",
                            isDragging && "ring-2 ring-blue-200 shadow-lg"
                        )}
                        {...attributes}
                        {...listeners}
                        onDoubleClick={() => setIsEditing(true)}
                    >
                        <span className="truncate">{textIndex ? `Text ${textIndex}` : "Text"}</span>

                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-4 w-4 ml-1 -mr-1 rounded-full text-black/20 hover:text-red-600 hover:bg-black/5"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => onRemove(item.id, e)}
                        >
                            <X size={10} />
                        </Button>
                    </div>
                </HoverCardTrigger>
                <HoverCardContent className="w-80 shadow-xl border-slate-200" side="left" align="start">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-slate-700">Text Segment {textIndex}</p>
                            <span className="text-[10px] font-mono text-slate-400">{item.content.length} chars</span>
                        </div>
                        <ScrollArea className="h-32 rounded-lg border border-slate-100 bg-slate-50">
                            <p className="p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-slate-700">
                                {item.content}
                            </p>
                        </ScrollArea>
                    </div>
                </HoverCardContent>
            </HoverCard>
        );
    }

    // Snippet Block
    return (
        <HoverCard openDelay={200}>
            <HoverCardTrigger asChild>
                <div
                    ref={setNodeRef}
                    style={style}
                    className={cn(
                        "flex items-center gap-2 px-2 py-1 rounded-md border shadow-sm cursor-grab active:cursor-grabbing select-none group relative text-[11px] font-medium w-full min-h-[32px] transition-all hover:-translate-y-0.5 hover:shadow-md",
                        item.color || "bg-slate-100 border-slate-200",
                        isDragging && "ring-2 ring-blue-200 shadow-lg"
                    )}
                    {...attributes}
                    {...listeners}
                >
                    <span className="truncate">{item.label || item.content.slice(0, 15)}</span>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 ml-1 -mr-1 rounded-full text-black/20 hover:text-red-600 hover:bg-black/5"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => onRemove(item.id, e)}
                    >
                        <X size={10} />
                    </Button>
                </div>
            </HoverCardTrigger>
            <HoverCardContent className="w-80 shadow-xl border-slate-200" side="left" align="start">
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-700">{item.label || "Snippet"}</p>
                        <span className="text-[10px] font-mono text-slate-400">{item.content.length} chars</span>
                    </div>
                    <ScrollArea className="h-32 rounded-lg border border-slate-100 bg-slate-50">
                        <p className="p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-slate-700">
                            {item.content}
                        </p>
                    </ScrollArea>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
}

// --- Main Component ---

export function PromptConstructor({ schema, onUpdate, currentValues, targetField: controlledTarget, onTargetChange, onFinish }: PromptConstructorProps) {
    // 1. Identify Target Fields
    const [internalTarget, setInternalTarget] = useState<string>("");
    const targetField = controlledTarget !== undefined ? controlledTarget : internalTarget;
    const setTargetField = onTargetChange || setInternalTarget;

    const [availableFields, setAvailableFields] = useState<string[]>([]);

    // 2. State
    const { registerStateChange } = useUndoRedo();

    const [fieldItems, setFieldItems] = useState<Record<string, PromptItem[]>>({});
    const items = fieldItems[targetField] || [];

    const applyItems = (target: string, value: PromptItem[]) => {
        setFieldItems(prev => ({ ...prev, [target]: value }));
    };

    const setItems = (newItems: PromptItem[] | ((prev: PromptItem[]) => PromptItem[]), label = "Prompt items updated", record = true) => {
        if (!targetField) return;
        setFieldItems(prev => {
            const previousItems = prev[targetField] || [];
            const resolved = typeof newItems === 'function' ? newItems(previousItems) : newItems;
            if (record) {
                registerStateChange(label, previousItems, resolved, (val) => applyItems(targetField, val));
            }
            return { ...prev, [targetField]: resolved };
        });
    };

    const [library, setLibrary] = useState<PromptItem[]>(() => {
        const saved = localStorage.getItem("ds_prompt_snippets");
        return saved ? JSON.parse(saved) : [
            { id: "s-1", type: "block", label: "Masterpiece", content: "masterpiece, best quality, highres, 8k", color: COLORS[0] },
            { id: "s-2", type: "block", label: "Negative Basics", content: "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry", color: COLORS[4] }
        ];
    });

    // Creation / Editing State
    const [snippetTitle, setSnippetTitle] = useState("");
    const [snippetContent, setSnippetContent] = useState("");
    const [editingSnippetId, setEditingSnippetId] = useState<string | null>(null);
    const longPressRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        return () => {
            if (longPressRef.current) clearTimeout(longPressRef.current);
        };
    }, []);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    // --- Effects ---

    useEffect(() => {
        if (schema) {
            const fields = Object.keys(schema).filter(key => {
                const f = schema[key];
                return f.widget === "textarea" || f.type === "STRING";
            });
            setAvailableFields(fields);
        }
    }, [schema]);

    // Sync Library
    useEffect(() => {
        localStorage.setItem("ds_prompt_snippets", JSON.stringify(library));
    }, [library]);

    // Ref Pattern: Track currentValues without triggering effects in Output channel
    const valuesRef = useRef(currentValues);
    useEffect(() => { valuesRef.current = currentValues; }, [currentValues]);

    // Guard Ref: To prevent "Echo" loops where we parse what we just compiled
    const lastCompiledRef = useRef<{ field: string, value: string } | null>(null);

    // Helper to validate target
    const isTargetValid = targetField && schema && schema[targetField] && schema[targetField].type === 'string';

    // Reconciliation Logic (INPUT Channel: External Text -> Items)
    useEffect(() => {
        if (!isTargetValid) return;

        const currentVal = currentValues[targetField] || "";

        // GUARD: If this value matches exactly what we just compiled for this field,
        // it is an "Echo" from the parent. We trust our local state (items) is legally correct
        // and preserving it prevents ID thrashing / re-renders.
        if (lastCompiledRef.current?.field === targetField && lastCompiledRef.current?.value === currentVal) {
            return;
        }

        // AUTO-DISCOVERY ALGORITHM

        // 1. Find all potential matches
        interface Match { start: number; end: number; snippet: PromptItem; }
        const matches: Match[] = [];

        library.forEach(snippet => {
            if (!snippet.content || snippet.content.length === 0) return;

            // Safety check for currentVal being string
            if (typeof currentVal !== 'string') return;

            let pos = currentVal.indexOf(snippet.content);
            while (pos !== -1) {
                matches.push({ start: pos, end: pos + snippet.content.length, snippet });
                pos = currentVal.indexOf(snippet.content, pos + 1);
            }
        });

        matches.sort((a, b) => {
            if (a.start !== b.start) return a.start - b.start;
            return b.snippet.content.length - a.snippet.content.length;
        });

        const selectedMatches: Match[] = [];
        let lastEnd = 0;

        matches.forEach(m => {
            if (m.start >= lastEnd) {
                selectedMatches.push(m);
                lastEnd = m.end;
            }
        });

        const newItems: PromptItem[] = [];
        let cursor = 0;

        // Safety cast
        const safeVal = String(currentVal);

        selectedMatches.forEach((m, idx) => {
            if (m.start > cursor) {
                let gap = safeVal.substring(cursor, m.start);

                // Smart logic: Strip the implicit ", " separators from the gap
                // consistently so we don't spawn "Text" items for them.

                // If this is NOT the first item, strip leading separator
                if (newItems.length > 0 && gap.startsWith(", ")) {
                    gap = gap.substring(2);
                }

                // If this is NOT the last item (which we don't know yet, but we know we are before `m`), 
                // strip trailing separator. 
                // Actually, the join puts separator AFTER the previous item. 
                // So if we have `Prev, Gap, Next`, the string is `Prev` + `, ` + `Gap` + `, ` + `Next`.
                // The gap captured is `, Gap, `.

                // Leading strip handles the first comma. 
                // Trailing strip handles the second comma.
                if (gap.endsWith(", ")) {
                    gap = gap.substring(0, gap.length - 2);
                }

                if (gap.length > 0) {
                    newItems.push({
                        id: `text-${cursor}`, // Stable ID based on position
                        type: 'text',
                        content: gap
                    });
                }
            }
            newItems.push({
                ...m.snippet,
                id: `instance-${m.start}`,
                sourceId: m.snippet.id
            });
            cursor = m.end;
        });

        if (cursor < safeVal.length) {
            let tail = safeVal.substring(cursor);
            // Handle tail: If previous item exists, strip leading separator
            if (newItems.length > 0 && tail.startsWith(", ")) {
                tail = tail.substring(2);
            }

            if (tail.length > 0) {
                newItems.push({
                    id: `text-${cursor}`,
                    type: 'text',
                    content: tail
                });
            }
        }

        // Merge adjacent
        const mergedItems: PromptItem[] = [];
        newItems.forEach(item => {
            if (mergedItems.length > 0) {
                const last = mergedItems[mergedItems.length - 1];
                if (last.type === 'text' && item.type === 'text') {
                    last.content += item.content;
                    return;
                }
            }
            mergedItems.push(item);
        });

        // Deep Compare
        const normalize = (list: PromptItem[]) => list.map(i => ({ type: i.type, content: i.content, label: i.label, sourceId: i.sourceId }));
        const isDifferent = JSON.stringify(normalize(mergedItems)) !== JSON.stringify(normalize(items));

        if (isDifferent) {
            if (mergedItems.length === 0 && currentVal === "") {
                if (items.length > 0) setItems([], "Prompt cleared", false);
            } else {
                setItems(mergedItems, "Prompt reconstructed", false);
            }
        }

    }, [currentValues[targetField], targetField, library, isTargetValid]);


    // Compile (OUTPUT Channel: Items -> Parent)
    useEffect(() => {
        if (!isTargetValid) return;

        // Only update parent if local change differs from parent value
        // Use implicit ", " separator for cleaner linking
        const compiled = items.map(i => i.content).join(", ");
        const currentVal = valuesRef.current[targetField] || "";

        if (compiled !== currentVal) {
            // MARK: We record this output so Reconcile knows to ignore it on echo
            lastCompiledRef.current = { field: targetField, value: compiled };
            onUpdate(targetField, compiled);
        }
    }, [items, targetField, isTargetValid]);


    // --- Handlers ---

    const handleDragEnd = (event: any) => {
        const { active, over } = event;
        if (active.id !== over.id) {
            const oldIndex = items.findIndex((i) => i.id === active.id);
            const newIndex = items.findIndex((i) => i.id === over.id);
            const newArr = arrayMove(items, oldIndex, newIndex);
            setItems(newArr);
        }
    };

    const addTextSpacer = () => {
        if (!isTargetValid) return;
        const id = `text-${Date.now()}`;
        setItems([...items, { id, type: 'text', content: ", ", label: "Text" }]);
    };

    const addSnippetToCanvas = (snippet: PromptItem) => {
        if (!isTargetValid) return;
        const id = `instance-${Date.now()}`;
        setItems([...items, { ...snippet, id, sourceId: snippet.id }]);
    };

    const cancelEdit = () => {
        setEditingSnippetId(null);
        setSnippetTitle("");
        setSnippetContent("");
    };

    const editSnippet = (snippet: PromptItem, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingSnippetId(snippet.id);
        setSnippetTitle(snippet.label || "");
        setSnippetContent(snippet.content);
    };

    const saveSnippet = () => {
        if (!snippetContent.trim() || !snippetTitle.trim()) return;

        if (editingSnippetId) {
            // UPDATE GLOBAL
            const updatedLibrary = library.map(s =>
                s.id === editingSnippetId
                    ? { ...s, label: snippetTitle, content: snippetContent }
                    : s
            );
            setLibrary(updatedLibrary);

            setFieldItems(prev => {
                const next = { ...prev };
                Object.keys(next).forEach(fieldKey => {
                    next[fieldKey] = next[fieldKey].map(item => {
                        if (item.type === 'block' && item.sourceId === editingSnippetId) {
                            return { ...item, label: snippetTitle, content: snippetContent };
                        }
                        return item;
                    });
                });
                return next;
            });

            cancelEdit();

        } else {
            // CREATE NEW
            const newSnippet: PromptItem = {
                id: `s-${Date.now()}`,
                type: 'block',
                label: snippetTitle,
                content: snippetContent,
                color: COLORS[library.length % COLORS.length]
            };

            setLibrary([newSnippet, ...library]);
            setSnippetContent("");
            setSnippetTitle("");
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            saveSnippet();
        }
    };

    const handleTitleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            saveSnippet();
        }
    };

    const clearCanvas = () => {
        if (confirm("Clear the constructor canvas for this field?")) {
            setItems([]);
        }
    };

    // Long-press gesture keeps double-click free for "add to canvas" while enabling edit affordances on touch devices.
    const startLongPress = (snippet: PromptItem, e: React.PointerEvent | React.MouseEvent) => {
        if (longPressRef.current) clearTimeout(longPressRef.current);
        longPressRef.current = setTimeout(() => editSnippet(snippet, e as React.MouseEvent), 550);
    };

    const cancelLongPress = () => {
        if (longPressRef.current) {
            clearTimeout(longPressRef.current);
            longPressRef.current = null;
        }
    };

    const deleteFromLibrary = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm("Delete this snippet permanently?")) {
            setLibrary(prev => prev.filter(i => i.id !== id));
            if (editingSnippetId === id) cancelEdit();
        }
    };

    const handleRemoveItem = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setItems(items.filter(i => i.id !== id));
    };


    return (
        <div className="prompt-constructor h-full flex flex-col bg-slate-50 border-t border-slate-200">

            {/* 2. Snippet Creator (Standing) */}
            <div className={cn("p-3 border-b border-dashed border-slate-200 shrink-0 transition-colors", editingSnippetId ? "bg-amber-50" : "bg-slate-50")}>
                <div className="flex gap-2">
                    <div className="flex-1 space-y-2">
                        <div className="flex justify-between items-center">
                            <Input
                                placeholder="Snippet Title"
                                className="h-7 text-xs font-semibold bg-white w-full"
                                value={snippetTitle}
                                onChange={e => setSnippetTitle(e.target.value)}
                                onKeyDown={handleTitleKeyDown}
                            />
                            {editingSnippetId && <span className="text-[10px] font-bold text-amber-600 ml-2 whitespace-nowrap">EDITING</span>}
                        </div>
                        <Textarea
                            placeholder="Prompt text... (Ctrl+Enter to save)"
                            className="h-[140px] text-xs font-mono bg-white resize-none"
                            value={snippetContent}
                            onChange={e => setSnippetContent(e.target.value)}
                            onKeyDown={handleKeyDown}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Button
                            variant="default"
                            className={cn("h-auto flex-1 w-10 p-0 flex flex-col gap-1 items-center justify-center", editingSnippetId ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-800 hover:bg-slate-700")}
                            onClick={saveSnippet}
                            title={editingSnippetId ? "Save Changes" : "Create Snippet"}
                        >
                            {editingSnippetId ? <Check size={16} /> : <Plus size={16} />}
                            <span className="text-[10px] font-bold">{editingSnippetId ? "Save" : "Add"}</span>
                        </Button>
                        {editingSnippetId && (
                            <Button
                                variant="ghost"
                                className="h-auto flex-1 w-10 p-0 flex flex-col gap-1 items-center justify-center text-slate-500 hover:text-red-600 hover:bg-red-50"
                                onClick={cancelEdit}
                                title="Cancel Editing"
                            >
                                <X size={16} />
                                <span className="text-[10px] font-bold">Cancel</span>
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* 3. Library (Horizontal Scroll)
                Grid layout keeps snippet chips aligned for tessellation and consistent sizing. */}
            <div className="bg-white px-3 py-2 border-b shadow-sm shrink-0">
                <div className="mb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Snippets (Double-click to Add, long-press to Edit)</span>
                </div>
                <ScrollArea className="h-32 w-full">
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2 items-start min-h-[40px] p-1">
                        {library.map(snippet => (
                            <ContextMenu key={snippet.id}>
                                <HoverCard openDelay={120} closeDelay={80}>
                                    <ContextMenuTrigger asChild>
                                        <HoverCardTrigger asChild>
                                            <div
                                                className={cn(
                                                    "flex items-center gap-2 px-2 py-1.5 rounded-md border shadow-sm cursor-pointer select-none group relative text-[11px] font-medium min-h-[32px] transition-all hover:-translate-y-0.5 hover:shadow-md",
                                                    snippet.color,
                                                    editingSnippetId === snippet.id ? "ring-2 ring-amber-400 ring-offset-1" : "",
                                                )}
                                                onPointerDown={(e) => startLongPress(snippet, e)}
                                                onPointerUp={cancelLongPress}
                                                onPointerLeave={cancelLongPress}
                                                onPointerCancel={cancelLongPress}
                                                onClick={(e) => {
                                                    if (e.detail === 1) addSnippetToCanvas(snippet);
                                                }}
                                                onDoubleClick={(e) => {
                                                    cancelLongPress();
                                                    addSnippetToCanvas(snippet);
                                                }}
                                            >
                                                <span className="truncate flex-1">{snippet.label}</span>

                                                {/* Explicit Edit Action (Pencil) remains as an accessible fallback. */}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-4 w-4 -mr-0.5 ml-1 rounded-full opacity-0 hover:opacity-100 group-hover:opacity-100 bg-white/30 hover:bg-white/60"
                                                    onClick={(e) => editSnippet(snippet, e)}
                                                    title="Edit Snippet"
                                                >
                                                    <Pencil size={10} className="text-slate-700" />
                                                </Button>

                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-4 w-4 -mr-1 rounded-full opacity-0 hover:opacity-100 group-hover:opacity-100 bg-white/20 hover:bg-red-100/80"
                                                    onClick={(e) => deleteFromLibrary(snippet.id, e)}
                                                    title="Delete Snippet"
                                                >
                                                    <Trash2 size={10} className="text-slate-700 hover:text-red-600" />
                                                </Button>
                                            </div>
                                        </HoverCardTrigger>
                                    </ContextMenuTrigger>
                                    {/* Rich hover preview replaces the plain title tooltip and supports long text via ScrollArea. */}
                                    <HoverCardContent className="w-80 shadow-xl border-slate-200">
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <p className="text-xs font-semibold text-slate-700">{snippet.label}</p>
                                                <span className="text-[10px] font-mono text-slate-400">{snippet.content.length} chars</span>
                                            </div>
                                            <ScrollArea className="h-32 rounded-lg border border-slate-100 bg-slate-50">
                                                <p className="p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-slate-700">
                                                    {snippet.content}
                                                </p>
                                            </ScrollArea>
                                        </div>
                                    </HoverCardContent>
                                </HoverCard>
                                <ContextMenuContent>
                                    <ContextMenuItem onSelect={() => addSnippetToCanvas(snippet)}>Add to canvas</ContextMenuItem>
                                    <ContextMenuItem onSelect={(e) => editSnippet(snippet, e as unknown as React.MouseEvent)}>Edit snippet</ContextMenuItem>
                                    <ContextMenuItem onSelect={(e) => deleteFromLibrary(snippet.id, e as unknown as React.MouseEvent)} className="text-red-600 focus:text-red-700">
                                        Delete snippet
                                    </ContextMenuItem>
                                </ContextMenuContent>
                            </ContextMenu>
                        ))}
                    </div>
                </ScrollArea>
            </div>

            {/* 4. Canvas (Vertical / Flex Wrap) */}
            <div className="flex-1 overflow-y-auto p-4 bg-slate-100/50 relative">
                {!isTargetValid ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm select-none gap-2 opacity-60">
                        <CornerDownLeft size={32} />
                        <span className="font-semibold">{targetField ? "Unsupported field type" : "Select a text prompt field to build"}</span>
                        <span className="text-xs">Select a valid text/string box on the right</span>
                    </div>
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={items.map(i => i.id)}
                            strategy={rectSortingStrategy}
                        >
                            {/* Canvas grid mirrors library spacing so blocks tessellate cleanly when rearranged. */}
                            <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] auto-rows-[minmax(32px,auto)] items-start gap-2 min-h-[100px] p-2 rounded-xl border-2 border-dashed border-slate-300 bg-white/80 transition-colors hover:bg-white/100 relative group/canvas">

                                {/* Floating Controls */}
                                {targetField && (
                                    <div className="absolute top-2 right-2 flex gap-1 z-10 opacity-0 group-hover/canvas:opacity-100 transition-opacity">
                                        <Button
                                            variant="ghost" size="icon"
                                            className="h-6 w-6 text-green-500 bg-green-50 hover:bg-green-100 hover:text-green-600 border border-green-200"
                                            onClick={() => onFinish?.()}
                                            title="Finish Editing (Deselect)"
                                        >
                                            <Check size={14} />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-300 hover:text-red-500 hover:bg-red-50" onClick={clearCanvas} title="Clear Canvas">
                                            <Eraser size={14} />
                                        </Button>
                                    </div>
                                )}

                                {items.length === 0 && (
                                    <div className="w-full text-center py-10 text-slate-400 text-sm select-none italic flex flex-col items-center gap-2">
                                        <CornerDownLeft size={24} className="opacity-20" />
                                        <span>Drag snippets here to build prompt</span>
                                    </div>
                                )}
                                {items.map((item, idx) => {
                                    // Calculate index for text items (1-based enumeration)
                                    let textCount = 0;
                                    if (item.type === 'text') {
                                        textCount = items.slice(0, idx + 1).filter(i => i.type === 'text').length;
                                    }

                                    return (
                                        <SortableItem
                                            key={item.id}
                                            index={idx}
                                            textIndex={item.type === 'text' ? textCount : undefined}
                                            item={item}
                                            onRemove={handleRemoveItem}
                                            onUpdateContent={(id, val) => setItems(prev => prev.map(i => i.id === id ? { ...i, content: val } : i))}
                                        />
                                    );
                                })}
                                <Button
                                    variant="ghost"
                                    className="h-8 border border-dashed text-slate-500 hover:text-slate-700 hover:bg-white text-[10px] gap-1 ml-1 justify-start"
                                    onClick={addTextSpacer}
                                >
                                    <Type size={10} /> Add Text
                                </Button>
                            </div>
                        </SortableContext>
                    </DndContext>
                )}
            </div>
        </div>
    );
}
