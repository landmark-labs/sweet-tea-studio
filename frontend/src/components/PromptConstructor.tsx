import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { PromptAutocompleteTextarea } from "./PromptAutocompleteTextarea";
import { VirtualGrid } from "@/components/VirtualGrid";
import { PromptItem } from "@/lib/types";
import { logClientFrameLatency, logClientPerfSample } from "@/lib/clientDiagnostics";
import { cancelIdle, scheduleIdle, type IdleHandle } from "@/lib/idleScheduler";
import { buildSnippetIndex, findSnippetMatches, selectNonOverlappingMatches } from "@/lib/snippetMatcher";


interface PromptConstructorProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: any;
    onUpdate: (field: string, value: string) => void;
    onUpdateMany?: (updates: Record<string, string>) => void;
    currentValues: Record<string, string>;
    targetField?: string;
    onTargetChange?: (field: string) => void;
    onFinish?: () => void;
    snippets: PromptItem[];
    onUpdateSnippets: React.Dispatch<React.SetStateAction<PromptItem[]>>;
    externalValueSyncKey?: number;
}

// --- Constants ---

export const COLORS = [
    "bg-blue-100 border-blue-300 text-blue-900",
    "bg-green-100 border-green-300 text-green-900",
    "bg-purple-100 border-purple-300 text-purple-900",
    "bg-amber-100 border-amber-300 text-amber-900",
    "bg-rose-100 border-rose-300 text-rose-900",
    "bg-cyan-100 border-cyan-300 text-cyan-900",
    "bg-slate-100 border-slate-300 text-slate-900",
];

// --- Sub-Components ---

function SortableItem({ item, index, textIndex, onRemove, onUpdateContent, onEditTextSnippet }: { item: PromptItem, index: number, textIndex?: number, onRemove: (id: string, e: React.MouseEvent) => void, onUpdateContent: (id: string, val: string) => void, onEditTextSnippet?: (item: PromptItem, textIndex?: number) => void }) {
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
            <HoverCard openDelay={500}>
                <HoverCardTrigger asChild>
                    <div
                        ref={setNodeRef}
                        style={style}
                        className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded-md border shadow-sm cursor-grab active:cursor-grabbing select-none group relative text-[11px] font-medium w-full min-w-0 min-h-[32px] transition-all hover:-translate-y-0.5 hover:shadow-md",
                            "bg-slate-50 border-slate-300 text-slate-700 hover:border-slate-400",
                            isDragging && "ring-2 ring-blue-200 shadow-lg"
                        )}
                        {...attributes}
                        {...listeners}
                        onDoubleClick={() => setIsEditing(true)}
                    >
                        <span className="truncate flex-1 min-w-0">{textIndex ? `Text ${textIndex}` : "Text"}</span>

                        {onEditTextSnippet && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 rounded-full text-black/20 hover:text-amber-600 hover:bg-amber-50"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onEditTextSnippet(item, textIndex);
                                }}
                            >
                                <Pencil size={10} />
                            </Button>
                        )}

                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-4 w-4 ml-1 -mr-1 rounded-full text-slate-500 hover:text-red-600 hover:bg-red-50"
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
        <HoverCard openDelay={500}>
            <HoverCardTrigger asChild>
                <div
                    ref={setNodeRef}
                    style={style}
                    className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-md border shadow-sm cursor-grab active:cursor-grabbing select-none group relative text-[11px] font-medium w-full min-w-0 min-h-[32px] transition-all hover:-translate-y-0.5 hover:shadow-md",
                        item.color || "bg-slate-100 border-slate-200",
                        isDragging && "ring-2 ring-blue-200 shadow-lg"
                    )}
                    {...attributes}
                    {...listeners}
                >
                    <span className="truncate flex-1 min-w-0">{item.label || item.content.slice(0, 15)}</span>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 ml-1 -mr-1 rounded-full text-slate-500 hover:text-red-600 hover:bg-red-50"
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

// Sortable library snippet for drag-to-reorder
interface SortableLibrarySnippetProps {
    snippet: PromptItem;
    isEditing: boolean;
    onStartLongPress: (e: React.PointerEvent) => void;
    onCancelLongPress: () => void;
    onDoubleClick: () => void;
    onEdit: (e: React.MouseEvent) => void;
    onDelete: (e: React.MouseEvent) => void;
    onAddToCanvas: () => void;
}

const normalizePrompt = (value: string) => {
    return value
        .split(/\s*,\s*/g)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .join("|");
};

function SortableLibrarySnippet({ snippet, isEditing, onStartLongPress, onCancelLongPress, onDoubleClick, onEdit, onDelete, onAddToCanvas }: SortableLibrarySnippetProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: snippet.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : "auto",
        opacity: isDragging ? 0.7 : 1,
    };

    return (
        <ContextMenu>
            <HoverCard openDelay={500} closeDelay={80}>
                <ContextMenuTrigger asChild>
                    <HoverCardTrigger asChild>
                        <div
                            ref={setNodeRef}
                            style={style}
                            className={cn(
                                "flex items-center gap-1 px-2 py-1.5 rounded-md border shadow-sm cursor-grab active:cursor-grabbing select-none group relative text-[11px] font-medium w-full h-full min-w-0 min-h-[32px] transition-all hover:-translate-y-0.5 hover:shadow-md",
                                snippet.color,
                                isEditing ? "ring-2 ring-amber-400 ring-offset-1" : "",
                                isDragging && "ring-2 ring-blue-200 shadow-lg"
                            )}
                            onPointerDown={onStartLongPress}
                            onPointerUp={onCancelLongPress}
                            onPointerLeave={onCancelLongPress}
                            onPointerCancel={onCancelLongPress}
                            onDoubleClick={(e) => {
                                onCancelLongPress();
                                onDoubleClick();
                            }}
                            {...attributes}
                            {...listeners}
                        >
                            <span className="truncate flex-1 min-w-0">{snippet.label}</span>

                            {/* Pencil edit button */}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 -mr-0.5 ml-1 rounded-full opacity-0 hover:opacity-100 group-hover:opacity-100 bg-white/30 hover:bg-white/60"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={onEdit}
                                title="Edit Snippet"
                            >
                                <Pencil size={10} className="text-slate-700" />
                            </Button>

                            {/* Delete button */}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 -mr-1 rounded-full opacity-0 hover:opacity-100 group-hover:opacity-100 bg-white/20 hover:bg-red-100/80"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={onDelete}
                                title="Delete Snippet"
                            >
                                <Trash2 size={10} className="text-slate-700 hover:text-red-600" />
                            </Button>
                        </div>
                    </HoverCardTrigger>
                </ContextMenuTrigger>
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
                <ContextMenuItem onSelect={onAddToCanvas}>Add to canvas</ContextMenuItem>
                <ContextMenuItem onSelect={(e) => onEdit(e as unknown as React.MouseEvent)}>Edit snippet</ContextMenuItem>
                <ContextMenuItem onSelect={(e) => onDelete(e as unknown as React.MouseEvent)} className="text-red-600 focus:text-red-700">
                    Delete snippet
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}

// --- Main Component ---

export const PromptConstructor = React.memo(function PromptConstructor({ schema, onUpdate, onUpdateMany, currentValues, targetField: controlledTarget, onTargetChange, onFinish, snippets: library, onUpdateSnippets: setLibrary, externalValueSyncKey }: PromptConstructorProps) {
    // 1. Identify Target Fields
    const [internalTarget, setInternalTarget] = useState<string>("");
    const targetField = controlledTarget !== undefined ? controlledTarget : internalTarget;
    const setTargetField = onTargetChange || setInternalTarget;

    const [availableFields, setAvailableFields] = useState<string[]>([]);

    // 2. State
    const { registerStateChange } = useUndoRedo();

    const [fieldItems, setFieldItems] = useState<Record<string, PromptItem[]>>({});
    const items = fieldItems[targetField] || [];
    const initializedFieldsRef = useRef<Set<string>>(new Set());
    const lastReconciledRef = useRef<Record<string, string>>({});
    const itemsSourceRef = useRef<{ field: string; source: "constructor" | "reconcile" } | null>(null);

    const applyItems = (target: string, value: PromptItem[]) => {
        if (target) {
            initializedFieldsRef.current.add(target);
            itemsSourceRef.current = { field: target, source: "constructor" };
        }
        setFieldItems(prev => ({ ...prev, [target]: value }));
    };

    const setItems = (
        newItems: PromptItem[] | ((prev: PromptItem[]) => PromptItem[]),
        label = "Prompt items updated",
        record = true,
        source: "constructor" | "reconcile" = "constructor"
    ) => {
        if (!targetField) return;
        initializedFieldsRef.current.add(targetField);
        itemsSourceRef.current = { field: targetField, source };
        // Collect values for undo/redo registration AFTER the state update
        let previousItems: PromptItem[] = [];
        let resolvedItems: PromptItem[] = [];

        setFieldItems(prev => {
            previousItems = prev[targetField] || [];
            resolvedItems = typeof newItems === 'function' ? newItems(previousItems) : newItems;
            return { ...prev, [targetField]: resolvedItems };
        });

        // Register undo/redo AFTER setFieldItems to avoid setState during render
        if (record) {
            // Use queueMicrotask to ensure this runs after the current render
            queueMicrotask(() => {
                registerStateChange(label, previousItems, resolvedItems, (val) => applyItems(targetField, val));
            });
        }
    };

    // Library now comes from props (aliasing 'snippets' to 'library' in arg destructuring)
    // Removed internal state initialization

    // Creation / Editing State
    const [snippetTitle, setSnippetTitle] = useState("");
    const [snippetContent, setSnippetContent] = useState("");
    const [editingSnippetId, setEditingSnippetId] = useState<string | null>(null);
    const [editingTextId, setEditingTextId] = useState<string | null>(null);
    const [editingTextField, setEditingTextField] = useState<string | null>(null);
    const [isDraggingLibrary, setIsDraggingLibrary] = useState(false);
    const longPressRef = useRef<NodeJS.Timeout | null>(null);

    const isEditing = editingSnippetId !== null || editingTextId !== null;

    useEffect(() => {
        return () => {
            if (longPressRef.current) clearTimeout(longPressRef.current);
        };
    }, []);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const trackSnippetAction = (action: string, extra: Record<string, unknown> = {}) => {
        if (typeof performance === "undefined") return;
        const start = performance.now();
        logClientFrameLatency(
            "perf_snippet_action_latency",
            "perf_snippet_action_latency",
            start,
            {
                action,
                items: items.length,
                library: library.length,
                ...extra,
            },
            { sampleRate: 0.1, throttleMs: 2000, minMs: 4 }
        );
    };

    // --- Effects ---

    useEffect(() => {
        if (schema) {
            const fields = Object.keys(schema).filter(key => {
                const f = schema[key];
                return f.widget === "textarea" || f.type === "STRING" || f.type === "string";
            });
            setAvailableFields(fields);
        }
    }, [schema]);

    // Ref Pattern: Track currentValues without triggering effects in Output channel
    const valuesRef = useRef(currentValues);
    useEffect(() => { valuesRef.current = currentValues; }, [currentValues]);

    // Ref Pattern: Track fieldItems for library sync without triggering on every change
    const fieldItemsRef = useRef(fieldItems);
    useEffect(() => { fieldItemsRef.current = fieldItems; }, [fieldItems]);

    // Guard Ref: To prevent "Echo" loops where we parse what we just compiled
    const lastCompiledRef = useRef<{ field: string, value: string } | null>(null);

    // When syncing snippets -> prompts we intentionally skip reconcile/compile for one tick
    // to prevent stale parent values from overwriting linked blocks.
    const syncingLibraryRef = useRef(false);
    const suppressCompileRef = useRef(false);

    // Helper to validate target
    const isTargetValid = targetField && schema && schema[targetField] && schema[targetField].type === 'string';
    const snippetIndex = useMemo(() => buildSnippetIndex(library), [library]);
    const reconcileHandleRef = useRef<IdleHandle | null>(null);
    const reconcileTokenRef = useRef(0);

    const buildItemsFromValue = (
        value: string,
        index: ReturnType<typeof buildSnippetIndex>
    ): PromptItem[] | null => {
        if (!value) return null;
        const matches = findSnippetMatches(value, index);
        if (!matches || matches.length === 0) return null;
        const selectedMatches = selectNonOverlappingMatches(matches, { preferLongest: true });
        if (selectedMatches.length === 0) return null;

        const nextItems: PromptItem[] = [];
        let cursor = 0;

        selectedMatches.forEach((m) => {
            if (m.start > cursor) {
                let gap = value.substring(cursor, m.start);
                if (nextItems.length > 0 && gap.startsWith(", ")) {
                    gap = gap.substring(2);
                }
                if (gap.endsWith(", ")) {
                    gap = gap.substring(0, gap.length - 2);
                }
                if (gap.length > 0) {
                    nextItems.push({
                        id: `text-${cursor}`,
                        type: "text",
                        content: gap,
                    });
                }
            }
            nextItems.push({
                ...m.snippet,
                id: `instance-${m.start}`,
                sourceId: m.snippet.id,
            });
            cursor = m.end;
        });

        if (cursor < value.length) {
            let tail = value.substring(cursor);
            if (nextItems.length > 0 && tail.startsWith(", ")) {
                tail = tail.substring(2);
            }
            if (tail.length > 0) {
                nextItems.push({
                    id: `text-${cursor}`,
                    type: "text",
                    content: tail,
                });
            }
        }

        return nextItems;
    };

    const rebuildItemsForValue = (
        value: string,
        index: ReturnType<typeof buildSnippetIndex>
    ): PromptItem[] => {
        if (!value) return [];
        const matches = findSnippetMatches(value, index);
        const selectedMatches = selectNonOverlappingMatches(matches || [], { preferLongest: true });

        const newItems: PromptItem[] = [];
        let cursor = 0;

        selectedMatches.forEach((m) => {
            if (m.start > cursor) {
                let gap = value.substring(cursor, m.start);
                if (newItems.length > 0 && gap.startsWith(", ")) {
                    gap = gap.substring(2);
                }
                if (gap.endsWith(", ")) {
                    gap = gap.substring(0, gap.length - 2);
                }
                if (gap.length > 0) {
                    newItems.push({
                        id: `text-${cursor}`,
                        type: "text",
                        content: gap,
                    });
                }
            }
            newItems.push({
                ...m.snippet,
                id: `instance-${m.start}`,
                sourceId: m.snippet.id,
            });
            cursor = m.end;
        });

        if (cursor < value.length) {
            let tail = value.substring(cursor);
            if (newItems.length > 0 && tail.startsWith(", ")) {
                tail = tail.substring(2);
            }
            if (tail.length > 0) {
                newItems.push({
                    id: `text-${cursor}`,
                    type: "text",
                    content: tail,
                });
            }
        }

        const mergedItems: PromptItem[] = [];
        newItems.forEach(item => {
            if (mergedItems.length > 0) {
                const last = mergedItems[mergedItems.length - 1];
                if (last.type === "text" && item.type === "text") {
                    last.content += item.content;
                    return;
                }
            }
            mergedItems.push(item);
        });

        let textLabelCounter = 0;
        return mergedItems.map(item => {
            if (item.type === "text") {
                textLabelCounter += 1;
                return { ...item, label: item.label || `Text ${textLabelCounter}` };
            }
            return item;
        });
    };

    useEffect(() => {
        if (externalValueSyncKey === undefined) return;
        if (!schema || availableFields.length === 0) return;

        syncingLibraryRef.current = true;

        const nextFieldItems: Record<string, PromptItem[]> = {};
        const nextReconciled: Record<string, string> = {};

        availableFields.forEach((fieldKey) => {
            const rawVal = (currentValues as any)?.[fieldKey];
            const currentVal = typeof rawVal === "string" ? rawVal : (rawVal === null || rawVal === undefined ? "" : String(rawVal));
            nextFieldItems[fieldKey] = rebuildItemsForValue(currentVal, snippetIndex);
            nextReconciled[fieldKey] = normalizePrompt(currentVal);
        });

        setFieldItems(nextFieldItems);
        initializedFieldsRef.current = new Set(availableFields);
        lastReconciledRef.current = { ...lastReconciledRef.current, ...nextReconciled };
        if (targetField) {
            itemsSourceRef.current = { field: targetField, source: "reconcile" };
        }

        setTimeout(() => {
            syncingLibraryRef.current = false;
        }, 0);
    }, [availableFields, currentValues, externalValueSyncKey, schema, snippetIndex, targetField]);

    // Sync Library: keep linked blocks + prompt text aligned when snippets change.
    // Important: reconciliation depends on `library`, so we must guard against it
    // running on a library edit before the parent prompt text is updated.
    useEffect(() => {
        if (!library || library.length === 0) return;
        if (syncingLibraryRef.current) return;

        // Use refs to access current state without dependencies
        const currentFieldItems = fieldItemsRef.current;
        const fieldKeys = Object.keys(currentFieldItems);
        const candidateFields = new Set<string>([...fieldKeys, ...availableFields]);
        if (candidateFields.size === 0) return;

        const libraryById = new Map(library.map(s => [s.id, s]));
        const nextFieldItems: Record<string, PromptItem[]> = { ...currentFieldItems };
        let didChangeItems = false;

        const valueUpdates: Record<string, string> = {};

        for (const fieldKey of candidateFields) {
            const existing = currentFieldItems[fieldKey] || [];
            const currentRaw = (valuesRef.current as any)?.[fieldKey];
            const currentVal = typeof currentRaw === "string"
                ? currentRaw
                : (currentRaw === null || currentRaw === undefined ? "" : String(currentRaw));

            let updated = existing;
            let didChangeField = false;

            if (updated.length === 0 && currentVal) {
                const rebuilt = buildItemsFromValue(currentVal, snippetIndex);
                if (rebuilt && rebuilt.length > 0) {
                    updated = rebuilt;
                    didChangeField = true;
                }
            }

            const synced = updated.map(item => {
                if (item.type !== "block" || !item.sourceId) return item;

                const librarySnippet = libraryById.get(item.sourceId);
                if (!librarySnippet) {
                    didChangeField = true;
                    return { ...item, type: "text" as const, sourceId: undefined, label: item.label || "Text" };
                }

                const nextLabel = librarySnippet.label;
                const nextContent = librarySnippet.content;
                const nextColor = librarySnippet.color;

                if (item.label !== nextLabel || item.content !== nextContent || item.color !== nextColor) {
                    didChangeField = true;
                    return { ...item, label: nextLabel, content: nextContent, color: nextColor };
                }

                return item;
            });

            if (didChangeField) {
                didChangeItems = true;
                nextFieldItems[fieldKey] = synced;
            }

            const hasLinkedBlocks = synced.some(i => i.type === "block" && !!i.sourceId);
            if (!hasLinkedBlocks) continue;

            const compiled = synced.map(i => i.content).join(", ");

            if (compiled !== currentVal) {
                valueUpdates[fieldKey] = compiled;
            }
        }

        const hasValueUpdates = Object.keys(valueUpdates).length > 0;
        if (!didChangeItems && !hasValueUpdates) return;

        // Prevent reconcile from overwriting freshly-synced linked blocks
        syncingLibraryRef.current = true;

        if (didChangeItems) {
            setFieldItems(nextFieldItems);
        }

        if (hasValueUpdates) {
            if (onUpdateMany) {
                suppressCompileRef.current = true;
                onUpdateMany(valueUpdates);
            } else if (targetField && valueUpdates[targetField] !== undefined) {
                suppressCompileRef.current = true;
                onUpdate(targetField, valueUpdates[targetField]);
            }
        }

        // Clear flag after a tick to allow state/props to settle
        setTimeout(() => {
            syncingLibraryRef.current = false;
        }, 0);
        // Only depend on library - use refs for other values to avoid effect on every keystroke
    }, [availableFields, library, snippetIndex]);

    // Reconciliation Logic (INPUT Channel: External Text -> Items)
    useEffect(() => {
        cancelIdle(reconcileHandleRef.current);
        reconcileHandleRef.current = null;

        reconcileTokenRef.current += 1;
        const token = reconcileTokenRef.current;

        if (!isTargetValid) {
            return;
        }
        if (syncingLibraryRef.current) return;

        const rawVal = currentValues[targetField];
        const currentVal = typeof rawVal === "string" ? rawVal : (rawVal === null || rawVal === undefined ? "" : String(rawVal));

        // GUARD: If this value matches exactly what we just compiled for this field,
        // it is an "Echo" from the parent. We trust our local state (items) is legally correct
        // and preserving it prevents ID thrashing / re-renders.
        if (lastCompiledRef.current?.field === targetField && lastCompiledRef.current?.value === currentVal) {
            lastReconciledRef.current[targetField] = normalizePrompt(currentVal);
            return;
        }

        reconcileHandleRef.current = scheduleIdle(() => {
            if (token !== reconcileTokenRef.current) return;
            if (!isTargetValid) return;
            if (syncingLibraryRef.current) return;
            if (lastCompiledRef.current?.field === targetField && lastCompiledRef.current?.value === currentVal) {
                lastReconciledRef.current[targetField] = normalizePrompt(currentVal);
                return;
            }

            const perfStart = typeof performance !== "undefined" ? performance.now() : null;

            const matches = findSnippetMatches(currentVal, snippetIndex);
            if (matches === null) return;
            const selectedMatches = selectNonOverlappingMatches(matches, { preferLongest: true });

            const newItems: PromptItem[] = [];
            let cursor = 0;

            const safeVal = currentVal;
            const normalizedCurrent = normalizePrompt(safeVal);

            selectedMatches.forEach((m) => {
                if (m.start > cursor) {
                    let gap = safeVal.substring(cursor, m.start);

                    // Smart logic: Strip the implicit ", " separators from the gap
                    // consistently so we don't spawn "Text" items for them.
                    if (newItems.length > 0 && gap.startsWith(", ")) {
                        gap = gap.substring(2);
                    }
                    if (gap.endsWith(", ")) {
                        gap = gap.substring(0, gap.length - 2);
                    }

                    if (gap.length > 0) {
                        newItems.push({
                            id: `text-${cursor}`,
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

            let textLabelCounter = 0;
            const labeledItems = mergedItems.map(item => {
                if (item.type === 'text') {
                    textLabelCounter += 1;
                    return { ...item, label: item.label || `Text ${textLabelCounter}` };
                }
                return item;
            });

            const currentItems = fieldItemsRef.current[targetField] || [];
            const normalizeItem = (i: PromptItem) => `${i.type}|${i.content}|${i.label || ''}|${i.sourceId || ''}`;
            const labeledStr = labeledItems.map(normalizeItem).join('~');
            const itemsStr = currentItems.map(normalizeItem).join('~');
            const isDifferent = labeledStr !== itemsStr;

            if (isDifferent) {
                if (mergedItems.length === 0 && currentVal === "") {
                    if (currentItems.length > 0) setItems([], "Prompt cleared", false, "reconcile");
                } else {
                    setItems(labeledItems, "Prompt reconstructed", false, "reconcile");
                }
            }

            lastReconciledRef.current[targetField] = normalizedCurrent;

            if (perfStart !== null) {
                logClientPerfSample(
                    "perf_prompt_reconcile",
                    "perf_prompt_reconcile",
                    performance.now() - perfStart,
                    {
                        len: safeVal.length,
                        items: currentItems.length,
                        library: snippetIndex.entries.length,
                    },
                    { sampleRate: 0.05, throttleMs: 3000, minMs: 4 }
                );
            }
            reconcileHandleRef.current = null;
        }, { timeout: 200 });

        return () => {
            cancelIdle(reconcileHandleRef.current);
            reconcileHandleRef.current = null;
        };
    }, [currentValues[targetField], targetField, snippetIndex, isTargetValid]);


    // Compile (OUTPUT Channel: Items -> Parent)
    useEffect(() => {
        if (!isTargetValid) return;
        if (suppressCompileRef.current) {
            suppressCompileRef.current = false;
            return;
        }
        const itemsSource = itemsSourceRef.current;
        if (itemsSource?.field === targetField && itemsSource.source === "reconcile") {
            return;
        }

        // Only update parent if local change differs from parent value
        // Use implicit ", " separator for cleaner linking
        const compiled = items.map(i => i.content).join(", ");
        const currentRaw = valuesRef.current[targetField];
        const currentVal = typeof currentRaw === "string" ? currentRaw : (currentRaw === null || currentRaw === undefined ? "" : String(currentRaw));
        const isInitialized = initializedFieldsRef.current.has(targetField);

        // Prevent clearing a non-empty field before reconciliation builds items.
        if (!isInitialized && items.length === 0 && currentVal.trim()) {
            return;
        }

        // NEW: Compare semantic content, not exact strings
        // This prevents cursor jump when the only difference is delimiter formatting
        // e.g., "a,b" vs "a, b" should be considered equivalent
        const normalizeForComparison = (str: string) => normalizePrompt(str);

        const compiledNormalized = normalizeForComparison(compiled);
        const currentNormalized = normalizeForComparison(currentVal);

        if (currentNormalized && lastReconciledRef.current[targetField] !== currentNormalized) {
            return;
        }

        // Only update if semantic content differs
        if (compiledNormalized !== currentNormalized) {
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
            trackSnippetAction("drag_canvas", { from: oldIndex, to: newIndex });
            setItems(newArr);
        }
    };

    const idCounterRef = useRef(0);
    const nextInstanceId = () => {
        idCounterRef.current += 1;
        return idCounterRef.current;
    };

    const addTextSpacer = () => {
        if (!isTargetValid) return;
        const id = `text-${nextInstanceId()}`;
        const nextIndex = items.filter(i => i.type === 'text').length + 1;
        trackSnippetAction("add_text");
        setItems([...items, { id, type: 'text', content: ", ", label: `Text ${nextIndex}` }]);
    };

    const addSnippetToCanvas = (snippet: PromptItem) => {
        if (!isTargetValid) return;
        // Prevent duplicate: Check if this snippet (by sourceId) is already in items
        const alreadyExists = items.some(item => item.sourceId === snippet.id);
        if (alreadyExists) return;
        const id = `instance-${nextInstanceId()}`;
        trackSnippetAction("add_snippet", { snippet_id: snippet.id });
        setItems([...items, { ...snippet, id, sourceId: snippet.id }]);
    };

    // Handle library snippet reordering
    const handleLibraryDragEnd = (event: any) => {
        const { active, over } = event;
        setIsDraggingLibrary(false);
        if (!over || active.id === over.id) return;
        const oldIndex = library.findIndex((s) => s.id === active.id);
        const newIndex = library.findIndex((s) => s.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1) {
            trackSnippetAction("drag_library", { from: oldIndex, to: newIndex });
            setLibrary(arrayMove(library, oldIndex, newIndex));
        }
    };

    const handleLibraryDragStart = () => {
        setIsDraggingLibrary(true);
    };

    const handleLibraryDragCancel = () => {
        setIsDraggingLibrary(false);
    };

    const cancelEdit = () => {
        setEditingSnippetId(null);
        setEditingTextId(null);
        setEditingTextField(null);
        setSnippetTitle("");
        setSnippetContent("");
    };

    const editSnippet = (snippet: PromptItem, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingSnippetId(snippet.id);
        setSnippetTitle(snippet.label || "");
        setSnippetContent(snippet.content);
        setEditingTextId(null);
        setEditingTextField(null);
    };

    const editTextSnippet = (item: PromptItem, textIndex?: number) => {
        if (!targetField || item.type !== 'text') return;
        setEditingSnippetId(null);
        setEditingTextId(item.id);
        setEditingTextField(targetField);
        setSnippetTitle(item.label || (textIndex ? `Text ${textIndex}` : "Text"));
        setSnippetContent(item.content);
    };

    const saveSnippet = () => {
        if (!snippetContent.trim() || !snippetTitle.trim()) return;

        if (editingTextId && editingTextField) {
            if (!targetField || targetField !== editingTextField) return;

            setItems(prev => prev.map(item =>
                item.id === editingTextId
                    ? { ...item, content: snippetContent, label: item.label || snippetTitle }
                    : item
            ), "Text snippet updated");

            cancelEdit();

        } else if (editingSnippetId) {
            // UPDATE GLOBAL SNIPPET
            const updatedLibrary = library.map(s =>
                s.id === editingSnippetId
                    ? { ...s, label: snippetTitle, content: snippetContent }
                    : s
            );
            setLibrary(updatedLibrary);

            // Update fieldItems and sync the ref immediately so the library sync effect
            // sees the correct items and doesn't try to rebuild them
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
                // Sync ref immediately so library sync effect sees correct items
                fieldItemsRef.current = next;
                return next;
            });

            cancelEdit();

        } else {
            // CREATE NEW
            const newSnippet: PromptItem = {
                id: `s-${nextInstanceId()}`,
                type: 'block',
                label: snippetTitle,
                content: snippetContent,
                color: COLORS[library.length % COLORS.length]
            };

            setLibrary([...library, newSnippet]);
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
            trackSnippetAction("clear_canvas");
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
        trackSnippetAction("remove_item", { target_id: id });
        setItems(items.filter(i => i.id !== id));
    };


    return (
        <div className="prompt-constructor h-full flex flex-col bg-slate-50 border-t border-slate-200">

            {/* 2. Snippet Creator (Standing) */}
            <div data-snippet-editor="true" className={cn("p-3 border-b border-dashed border-slate-200 shrink-0 transition-colors", isEditing ? "bg-amber-50" : "bg-slate-50")}>
                <div className="flex gap-2">
                    <div className="flex-1 space-y-2">
                        <div className="flex justify-between items-center">
                            <Input
                                placeholder="snippet name"
                                className="h-7 text-xs font-semibold bg-white w-full disabled:opacity-80"
                                value={snippetTitle}
                                onChange={e => setSnippetTitle(e.target.value)}
                                onKeyDown={handleTitleKeyDown}
                                disabled={!!editingTextId}
                            />
                            {isEditing && <span className="text-[10px] font-bold text-amber-600 ml-2 whitespace-nowrap">EDITING</span>}
                        </div>
                        <PromptAutocompleteTextarea
                            placeholder="Prompt text... (Ctrl+Enter to save)"
                            className="h-[100px] text-xs font-mono bg-white resize-none"
                            value={snippetContent}
                            onValueChange={setSnippetContent}
                            onKeyDown={handleKeyDown}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Button
                            variant="default"
                            className={cn("h-auto flex-1 w-10 p-0 flex flex-col gap-1 items-center justify-center", isEditing ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-800 hover:bg-slate-700")}
                            onClick={saveSnippet}
                            title={isEditing ? "Update Snippet" : "Create Snippet"}
                        >
                            {isEditing ? <Check size={16} /> : <Plus size={16} />}
                            <span className="text-[10px] font-bold">{isEditing ? "Update" : "Add"}</span>
                        </Button>
                        {isEditing && (
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
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Snippets (Double-click to Add, Drag to Reorder, Long-press to Edit)</span>
                </div>
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleLibraryDragStart}
                    onDragCancel={handleLibraryDragCancel}
                    onDragEnd={handleLibraryDragEnd}
                >
                    <SortableContext items={library.map(s => s.id)} strategy={rectSortingStrategy}>
                        <VirtualGrid
                            items={library}
                            columnCount={2}
                            rowHeight={40}
                            gap={8}
                            padding={4}
                            overscan={4}
                            virtualize={!isDraggingLibrary}
                            className="h-72 w-full"
                            getKey={(snippet) => snippet.id}
                            emptyState={<div className="min-h-[40px]" />}
                            renderItem={(snippet) => (
                                <SortableLibrarySnippet
                                    snippet={snippet}
                                    isEditing={editingSnippetId === snippet.id}
                                    onStartLongPress={(e) => startLongPress(snippet, e)}
                                    onCancelLongPress={cancelLongPress}
                                    onDoubleClick={() => addSnippetToCanvas(snippet)}
                                    onEdit={(e) => editSnippet(snippet, e)}
                                    onDelete={(e) => deleteFromLibrary(snippet.id, e)}
                                    onAddToCanvas={() => addSnippetToCanvas(snippet)}
                                />
                            )}
                        />
                    </SortableContext>
                </DndContext>
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
                        {/* Floating Controls pinned to top-right (outside canvas to avoid overlap) */}
                        {targetField && (
                            <div className="absolute -top-1 right-2 flex gap-2 z-20 opacity-0 hover:opacity-100 transition-opacity duration-150">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-green-600 bg-green-50 hover:bg-green-100 hover:text-green-700 border border-green-200 shadow-sm"
                                    onClick={() => onFinish?.()}
                                    title="Finish Editing (Deselect)"
                                >
                                    <Check size={16} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-slate-400 hover:text-red-500 hover:bg-red-50 border border-slate-200 shadow-sm"
                                    onClick={clearCanvas}
                                    title="Clear Canvas"
                                >
                                    <Eraser size={16} />
                                </Button>
                            </div>
                        )}

                        <SortableContext
                            items={items.map(i => i.id)}
                            strategy={rectSortingStrategy}
                        >
                            {/* Canvas grid uses 2-column layout to match snippet bank. */}
                            <div className="grid grid-cols-2 auto-rows-[minmax(32px,auto)] items-start gap-2 min-h-[100px] p-2 rounded-xl border-2 border-dashed border-slate-300 bg-white/80 transition-colors hover:bg-white/100 relative group/canvas">

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
                                            onEditTextSnippet={item.type === 'text' ? editTextSnippet : undefined}
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
});
