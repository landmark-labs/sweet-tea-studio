import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { PromptItem, PromptRehydrationItemV1, PromptRehydrationSnapshotV1 } from "@/lib/types";
import { logClientFrameLatency, logClientPerfSample } from "@/lib/clientDiagnostics";
import { cancelIdle, scheduleIdle, type IdleHandle } from "@/lib/idleScheduler";
import { buildSnippetIndex, findSnippetMatches, selectNonOverlappingMatches } from "@/lib/snippetMatcher";
import {
    SNIPPET_COLORS,
    getNextSnippetColor as getNextSnippetColorFromPalette,
    getSnippetColorSeed,
    normalizeSnippetColor,
} from "@/lib/snippetColors";


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
    onRehydrationSnapshot?: (snapshot: PromptRehydrationSnapshotV1) => void;
    rehydrationSnapshot?: PromptRehydrationSnapshotV1 | null;
    rehydrationKey?: number;
}

// --- Constants ---

export const COLORS = SNIPPET_COLORS;
export const getNextSnippetColor = getNextSnippetColorFromPalette;


// --- Sub-Components ---

const SortableItem = React.memo(function SortableItem({ item, textIndex, onRemove, onUpdateContent, onEditTextSnippet, onTextFocusChange, onSetSnippetRehydrationMode }: { item: PromptItem, textIndex?: number, onRemove: (id: string, e: React.MouseEvent) => void, onUpdateContent: (id: string, val: string) => void, onEditTextSnippet?: (item: PromptItem, textIndex?: number) => void, onTextFocusChange: (focused: boolean) => void, onSetSnippetRehydrationMode?: (id: string, mode: "frozen" | "live") => void }) {
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
        onTextFocusChange(false);
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onTextFocusChange(false);
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
                        onFocus={() => onTextFocusChange(true)}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        className="min-h-[32px] h-auto w-full text-[11px] font-mono border-dashed bg-surface-raised shadow-lg ring-2 ring-ring transition-colors resize-y py-1 px-2 rounded-md"
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
                            "bg-surface-raised border-border text-foreground/90 hover:border-ring",
                            isDragging && "ring-2 ring-ring shadow-lg"
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
                                className="h-4 w-4 rounded-full text-muted-foreground hover:text-foreground hover:bg-hover"
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
                            className="h-4 w-4 ml-1 -mr-1 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => onRemove(item.id, e)}
                        >
                            <X size={10} />
                        </Button>
                    </div>
                </HoverCardTrigger>
                <HoverCardContent className="w-80 shadow-xl border-border/60" side="left" align="start">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-foreground/80">Text Segment {textIndex}</p>
                            <span className="text-[10px] font-mono text-muted-foreground">{item.content.length} chars</span>
                        </div>
                        <ScrollArea className="h-32 rounded-lg border border-border/60 bg-muted/20">
                            <p className="p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-foreground/80">
                                {item.content}
                            </p>
                        </ScrollArea>
                    </div>
                </HoverCardContent>
            </HoverCard>
        );
    }

    // Snippet Block
    const showRehydrationControls = Boolean(item.sourceId && item.frozenContent !== undefined && onSetSnippetRehydrationMode);
    const activeRehydrationMode: "frozen" | "live" =
        (item.rehydrationMode === "live" || item.rehydrationMode === "frozen")
            ? item.rehydrationMode
            : (item.frozenContent !== undefined ? "frozen" : "live");
    const baseLabel = item.label || item.content.slice(0, 15);
    const displayLabel = activeRehydrationMode === "frozen" && !baseLabel.startsWith("*")
        ? `*${baseLabel}`
        : baseLabel;

    return (
        <HoverCard openDelay={500}>
            <HoverCardTrigger asChild>
                <div
                    ref={setNodeRef}
                    style={style}
                    className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-md border shadow-sm cursor-grab active:cursor-grabbing select-none group relative text-[11px] font-medium w-full min-w-0 min-h-[32px] transition-all hover:-translate-y-0.5 hover:shadow-md",
                        normalizeSnippetColor(item.color, getSnippetColorSeed(item)),
                        isDragging && "ring-2 ring-ring shadow-lg"
                    )}
                    {...attributes}
                    {...listeners}
                >
                    <span className="truncate flex-1 min-w-0">{displayLabel}</span>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 ml-1 -mr-1 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => onRemove(item.id, e)}
                    >
                        <X size={10} />
                    </Button>
                </div>
            </HoverCardTrigger>
            <HoverCardContent className="w-80 shadow-xl border-border/60" side="left" align="start">
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-foreground/80">{item.label || "Snippet"}</p>
                        <span className="text-[10px] font-mono text-muted-foreground">{item.content.length} chars</span>
                    </div>
                    {showRehydrationControls && (
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant={activeRehydrationMode === "frozen" ? "default" : "outline"}
                                className="h-6 px-2 text-[10px] font-semibold"
                                onClick={() => onSetSnippetRehydrationMode?.(item.id, "frozen")}
                                title="Use the exact snippet text from the saved generation"
                            >
                                {activeRehydrationMode === "frozen" && <Check size={12} className="-ml-0.5 mr-1" />}
                                Saved
                            </Button>
                            <Button
                                type="button"
                                variant={activeRehydrationMode === "live" ? "default" : "outline"}
                                className="h-6 px-2 text-[10px] font-semibold"
                                onClick={() => onSetSnippetRehydrationMode?.(item.id, "live")}
                                title="Substitute the current snippet text (prompt rehydration)"
                            >
                                {activeRehydrationMode === "live" && <Check size={12} className="-ml-0.5 mr-1" />}
                                Rehydrate
                            </Button>
                        </div>
                    )}
                    <ScrollArea className="h-32 rounded-lg border border-border/60 bg-muted/20">
                        <p className="p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-foreground/80">
                            {item.content}
                        </p>
                    </ScrollArea>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
}, (prevProps, nextProps) => {
    // Custom comparison - only re-render if item content/id changes
    return prevProps.item.id === nextProps.item.id &&
        prevProps.item.content === nextProps.item.content &&
        prevProps.item.label === nextProps.item.label &&
        prevProps.item.rehydrationMode === nextProps.item.rehydrationMode &&
        prevProps.textIndex === nextProps.textIndex;
});

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
        .trim()
        .replace(/\s*,\s*/g, ",")
        .replace(/\s+/g, " ");
};

const stripTrailingWrappers = (value: string) => value.trimEnd().replace(/[\s"'`)\]]+$/g, "");

const isNaturalLanguageSnippet = (item: PromptItem) => {
    const stripped = stripTrailingWrappers(item.content || "");
    return /[.!?…]$/.test(stripped);
};

const getImplicitSeparator = (prev: PromptItem | undefined, next: PromptItem | undefined) => {
    if (!prev || !next) return "";

    if (isNaturalLanguageSnippet(prev) || isNaturalLanguageSnippet(next)) {
        const hasBoundaryWhitespace = /\s$/.test(prev.content) || /^\s/.test(next.content);
        return hasBoundaryWhitespace ? "" : " ";
    }

    return ", ";
};

const compileItemsToPrompt = (items: PromptItem[]) => {
    if (!items.length) return "";
    let compiled = items[0].content;
    for (let i = 1; i < items.length; i += 1) {
        compiled += getImplicitSeparator(items[i - 1], items[i]);
        compiled += items[i].content;
    }
    return compiled;
};

const SortableLibrarySnippet = React.memo(function SortableLibrarySnippet({ snippet, isEditing, onStartLongPress, onCancelLongPress, onDoubleClick, onEdit, onDelete, onAddToCanvas }: SortableLibrarySnippetProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: snippet.id });

    // Controlled hover state - only show when mouse is stationary and no interactions are happening
    const [hoverOpen, setHoverOpen] = useState(false);
    const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);
    const closeTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isInteractingRef = useRef(false);
    const isInHoverContentRef = useRef(false);

    const clearHoverTimer = () => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
    };

    const clearCloseTimer = () => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    };

    const startHoverTimer = () => {
        clearHoverTimer();
        clearCloseTimer();
        if (isInteractingRef.current || isDragging) return;
        hoverTimerRef.current = setTimeout(() => {
            if (!isInteractingRef.current && !isDragging) {
                setHoverOpen(true);
            }
        }, 500);
    };

    const handleMouseMove = () => {
        // Reset the timer on any mouse movement - require stillness
        if (!hoverOpen) {
            startHoverTimer();
        }
    };

    const handleMouseEnter = () => {
        clearCloseTimer();
        if (!isInteractingRef.current && !isDragging) {
            startHoverTimer();
        }
    };

    const handleMouseLeave = () => {
        clearHoverTimer();
        // Delay closing to give user time to move mouse to hover content
        // This prevents the "invisible path" problem with finnicky hover cards
        clearCloseTimer();
        closeTimerRef.current = setTimeout(() => {
            if (!isInHoverContentRef.current) {
                setHoverOpen(false);
            }
        }, 150);
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        isInteractingRef.current = true;
        clearHoverTimer();
        setHoverOpen(false);
        onStartLongPress(e);
    };

    const handlePointerUp = () => {
        isInteractingRef.current = false;
        onCancelLongPress();
    };

    const handlePointerLeave = () => {
        isInteractingRef.current = false;
        onCancelLongPress();
        handleMouseLeave();
    };

    const handlePointerCancel = () => {
        isInteractingRef.current = false;
        onCancelLongPress();
    };

    const handleDoubleClick = () => {
        isInteractingRef.current = true;
        clearHoverTimer();
        setHoverOpen(false);
        onCancelLongPress();
        onDoubleClick();
        // Reset after a brief delay
        setTimeout(() => {
            isInteractingRef.current = false;
        }, 100);
    };

    const handleHoverContentEnter = () => {
        clearCloseTimer();
        isInHoverContentRef.current = true;
    };

    const handleHoverContentLeave = () => {
        isInHoverContentRef.current = false;
        // Use delayed close for consistency
        clearCloseTimer();
        closeTimerRef.current = setTimeout(() => {
            setHoverOpen(false);
        }, 100);
    };

    // Cleanup timers on unmount
    useEffect(() => {
        return () => {
            clearHoverTimer();
            clearCloseTimer();
        };
    }, []);

    // Close hover when dragging starts
    useEffect(() => {
        if (isDragging) {
            clearHoverTimer();
            setHoverOpen(false);
        }
    }, [isDragging]);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : "auto",
        opacity: isDragging ? 0.7 : 1,
    };

    return (
        <ContextMenu>
            <HoverCard open={hoverOpen} onOpenChange={(open) => {
                // Only allow external close, not external open (we control opening via timer)
                if (!open) {
                    setHoverOpen(false);
                }
            }}>
                <ContextMenuTrigger asChild>
                    <HoverCardTrigger asChild>
                        <div
                            ref={setNodeRef}
                            style={style}
                            className={cn(
                                "flex items-center gap-1 px-1.5 py-1 rounded-md border shadow-sm cursor-grab active:cursor-grabbing select-none group relative text-[10px] font-medium w-full h-full min-w-0 min-h-[28px] transition-all hover:-translate-y-0.5 hover:shadow-md overflow-hidden",
                                normalizeSnippetColor(snippet.color, getSnippetColorSeed(snippet)),
                                isEditing ? "ring-2 ring-ring ring-offset-1" : "",
                                isDragging && "ring-2 ring-ring shadow-lg"
                            )}
                            onMouseEnter={handleMouseEnter}
                            onMouseMove={handleMouseMove}
                            onMouseLeave={handleMouseLeave}
                            onPointerDown={handlePointerDown}
                            onPointerUp={handlePointerUp}
                            onPointerLeave={handlePointerLeave}
                            onPointerCancel={handlePointerCancel}
                            onDoubleClick={handleDoubleClick}
                            {...attributes}
                            {...listeners}
                        >
                            <span className="truncate w-full pr-1">{snippet.label}</span>
                            <div className="absolute right-0 top-0 bottom-0 flex items-center pr-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-l from-white/90 via-white/80 to-transparent dark:from-background/80 dark:via-background/60 pl-4">
                                {/* Pencil edit button */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 rounded-full bg-surface/60 hover:bg-hover"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={onEdit}
                                    title="Edit Snippet"
                                >
                                    <Pencil size={9} className="text-foreground/80" />
                                </Button>

                                {/* Delete button */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 ml-0.5 rounded-full bg-surface/60 hover:bg-destructive/10"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={onDelete}
                                    title="Delete Snippet"
                                >
                                    <Trash2 size={9} className="text-foreground/80 hover:text-destructive" />
                                </Button>
                            </div>
                        </div>
                    </HoverCardTrigger>
                </ContextMenuTrigger>
                <HoverCardContent
                    className="w-80 shadow-xl border-border/60"
                    sideOffset={2}
                    onMouseEnter={handleHoverContentEnter}
                    onMouseLeave={handleHoverContentLeave}
                >
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-foreground/80">{snippet.label}</p>
                            <span className="text-[10px] font-mono text-muted-foreground">{snippet.content.length} chars</span>
                        </div>
                        <ScrollArea className="h-32 rounded-lg border border-border/60 bg-muted/20">
                            <p className="p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-foreground/80">
                                {snippet.content}
                            </p>
                        </ScrollArea>
                    </div>
                </HoverCardContent>
            </HoverCard>
            <ContextMenuContent>
                <ContextMenuItem onSelect={onAddToCanvas}>Add to canvas</ContextMenuItem>
                <ContextMenuItem onSelect={(e) => onEdit(e as unknown as React.MouseEvent)}>Edit snippet</ContextMenuItem>
                <ContextMenuItem onSelect={(e) => onDelete(e as unknown as React.MouseEvent)} className="text-destructive focus:text-destructive">
                    Delete snippet
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}, (prevProps, nextProps) => {
    // Custom comparison for library snippets
    return prevProps.snippet.id === nextProps.snippet.id &&
        prevProps.snippet.content === nextProps.snippet.content &&
        prevProps.snippet.label === nextProps.snippet.label &&
        prevProps.snippet.color === nextProps.snippet.color &&
        prevProps.isEditing === nextProps.isEditing;
});

// --- Main Component ---

export const PromptConstructor = React.memo(function PromptConstructor({ schema, onUpdate, onUpdateMany, currentValues, targetField: controlledTarget, onTargetChange, onFinish, snippets: library, onUpdateSnippets: setLibrary, externalValueSyncKey, onRehydrationSnapshot, rehydrationSnapshot, rehydrationKey }: PromptConstructorProps) {
    // 1. Identify Target Fields
    const [internalTarget, setInternalTarget] = useState<string>("");
    const targetField = controlledTarget !== undefined ? controlledTarget : internalTarget;
    const setTargetField = onTargetChange || setInternalTarget;

    const availableFields = useMemo(() => {
        if (!schema) return [];
        return Object.keys(schema).filter(key => {
            const f = schema[key];
            return f.widget === "textarea" || f.type === "STRING" || f.type === "string";
        });
    }, [schema]);

    useEffect(() => {
        if (controlledTarget !== undefined) return;
        if (internalTarget) return;
        const first = availableFields[0];
        if (!first) return;
        setTargetField(first);
    }, [availableFields, controlledTarget, internalTarget, setTargetField]);

    // 2. State
    const { registerStateChange, setTextInputFocused } = useUndoRedo();

    const [fieldItems, setFieldItems] = useState<Record<string, PromptItem[]>>({});
    const items = fieldItems[targetField] || [];
    const sortableIds = useMemo(() => items.map((item) => item.id), [items]);
    const initializedFieldsRef = useRef<Set<string>>(new Set());
    const lastReconciledRef = useRef<Record<string, string>>({});
    const itemsSourceRef = useRef<{ field: string; source: "constructor" | "reconcile" } | null>(null);

    const applyItems = useCallback((target: string, value: PromptItem[]) => {
        if (target) {
            initializedFieldsRef.current.add(target);
            itemsSourceRef.current = { field: target, source: "constructor" };
        }
        setFieldItems(prev => ({ ...prev, [target]: value }));
    }, []);

    useEffect(() => {
        if (!schema) return;
        if (!onRehydrationSnapshot) return;

        const fields: Record<string, PromptRehydrationItemV1[]> = {};
        Object.entries(fieldItems).forEach(([fieldKey, fieldValue]) => {
            if (!fieldValue || fieldValue.length === 0) return;
            const snapshotItems: PromptRehydrationItemV1[] = fieldValue.map((item) => ({
                type: item.type,
                content: item.content,
                sourceId: item.type === "block" ? item.sourceId : undefined,
                label: item.type === "block" ? item.label : undefined,
                color: item.type === "block" ? normalizeSnippetColor(item.color, getSnippetColorSeed(item)) : undefined,
            }));
            fields[fieldKey] = snapshotItems;
        });

        onRehydrationSnapshot({ version: 1, fields });
    }, [fieldItems, onRehydrationSnapshot, schema]);

    const setItems = useCallback((
        newItems: PromptItem[] | ((prev: PromptItem[]) => PromptItem[]),
        label = "Prompt items updated",
        record = true,
        source: "constructor" | "reconcile" = "constructor"
    ) => {
        const field = targetField;
        if (!field) return;

        initializedFieldsRef.current.add(field);
        itemsSourceRef.current = { field, source };

        setFieldItems(prev => {
            const previousItems = prev[field] || [];
            const resolvedItems = typeof newItems === 'function' ? newItems(previousItems) : newItems;
            if (resolvedItems === previousItems) return prev;

            if (record) {
                queueMicrotask(() => {
                    registerStateChange(label, previousItems, resolvedItems, (val) => applyItems(field, val));
                });
            }

            return { ...prev, [field]: resolvedItems };
        });
    }, [applyItems, registerStateChange, targetField]);

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

    const itemCountRef = useRef(0);
    itemCountRef.current = items.length;
    const libraryCountRef = useRef(0);
    libraryCountRef.current = library.length;

    const trackSnippetAction = useCallback((action: string, extra: Record<string, unknown> = {}) => {
        if (typeof performance === "undefined") return;
        const start = performance.now();
        logClientFrameLatency(
            "perf_snippet_action_latency",
            "perf_snippet_action_latency",
            start,
            {
                action,
                items: itemCountRef.current,
                library: libraryCountRef.current,
                ...extra,
            },
            { sampleRate: 0.1, throttleMs: 2000, minMs: 4 }
        );
    }, []);

    // --- Effects ---

    // Ref Pattern: Track currentValues without triggering effects in Output channel
    const valuesRef = useRef(currentValues);
    useLayoutEffect(() => { valuesRef.current = currentValues; }, [currentValues]);

    // Ref Pattern: Track fieldItems for library sync without triggering on every change
    const fieldItemsRef = useRef(fieldItems);
    useLayoutEffect(() => { fieldItemsRef.current = fieldItems; }, [fieldItems]);

    // Guard Ref: To prevent "Echo" loops where we parse what we just compiled
    const lastCompiledRef = useRef<{ field: string, value: string } | null>(null);

    // When syncing snippets -> prompts we intentionally skip reconcile/compile for one tick
    // to prevent stale parent values from overwriting linked blocks.
    const syncingLibraryRef = useRef(false);
    const suppressCompileRef = useRef(false);

    // Helper to validate target
    const isTargetValid = targetField && schema && schema[targetField] && schema[targetField].type === 'string';
    const snippetIndex = useMemo(() => buildSnippetIndex(library), [library]);
    // Ref to access snippetIndex in effects without adding it as a dependency (prevents infinite loops)
    const snippetIndexRef = useRef(snippetIndex);
    snippetIndexRef.current = snippetIndex;
    const libraryByIdRef = useRef<Map<string, PromptItem>>(new Map());
    useLayoutEffect(() => {
        libraryByIdRef.current = new Map(library.map((s) => [s.id, s]));
    }, [library]);
    const prevLibraryRef = useRef<PromptItem[] | null>(null);
    const reconcileHandleRef = useRef<IdleHandle | null>(null);
    const reconcileTokenRef = useRef(0);
    const lastAppliedRehydrationKeyRef = useRef<number | null>(null);
    // Per-field tracking of rehydrated values to prevent reconciliation from overwriting
    const rehydratedFieldValuesRef = useRef<Record<string, string>>({});

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
                if (gap.trim().length > 0) {
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
            if (tail.trim().length > 0) {
                nextItems.push({
                    id: `text-${cursor}`,
                    type: "text",
                    content: tail,
                });
            }
        }

        return nextItems;
    };

    const buildItemsFromSnapshot = useCallback((
        fieldKey: string,
        snapshotItems?: PromptRehydrationItemV1[]
    ): PromptItem[] | null => {
        if (!Array.isArray(snapshotItems) || snapshotItems.length === 0) return null;
        const libraryById = libraryByIdRef.current;
        let textLabelCounter = 0;

        const built = snapshotItems.flatMap((snap, idx): PromptItem[] => {
            const content = typeof snap?.content === "string" ? snap.content : "";
            if (snap?.type === "block" && typeof snap?.sourceId === "string" && snap.sourceId) {
                const librarySnippet = libraryById.get(snap.sourceId);

                // Preserve orphan blocks for stale/deleted snippets.
                const label = librarySnippet?.label || snap.label || "Snippet";
                const color = normalizeSnippetColor(
                    librarySnippet?.color || snap.color,
                    `${snap.sourceId}|${label}|${content}`
                );

                if (!librarySnippet) {
                    return [{
                        id: `rehydrate-${fieldKey}-${idx}`,
                        type: "block" as const,
                        sourceId: snap.sourceId,
                        content,
                        label,
                        color,
                        rehydrationMode: "frozen" as const,
                        frozenContent: content,
                    }];
                }

                return [{
                    id: `rehydrate-${fieldKey}-${idx}`,
                    type: "block" as const,
                    sourceId: snap.sourceId,
                    content,
                    label,
                    color,
                    ...(content !== librarySnippet.content
                        ? { rehydrationMode: "frozen" as const, frozenContent: content }
                        : {}),
                }];
            }

            if (!content.length) return [];
            textLabelCounter += 1;
            return [{
                id: `rehydrate-${fieldKey}-${idx}`,
                type: "text" as const,
                content,
                label: snap?.label || `Text ${textLabelCounter}`,
            }];
        });

        return built;
    }, []);

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
                if (gap.trim().length > 0) {
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
            if (tail.trim().length > 0) {
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
        const shouldApplyRehydration = Boolean(
            rehydrationSnapshot &&
            typeof rehydrationKey === "number" &&
            lastAppliedRehydrationKeyRef.current !== rehydrationKey
        );

        if (shouldApplyRehydration) {
            lastAppliedRehydrationKeyRef.current = rehydrationKey ?? null;
        }

        // Apply snapshot rehydration across all prompt fields.
        // Important: this effect should NOT be keyed to targetField/focus changes,
        // otherwise focus switches rebuild from live snippets and can downgrade stale blocks.
        availableFields.forEach((fieldKey) => {
            const rawVal = (valuesRef.current as any)?.[fieldKey];
            const currentVal = typeof rawVal === "string" ? rawVal : (rawVal === null || rawVal === undefined ? "" : String(rawVal));

            if (shouldApplyRehydration) {
                const snapshotItems = (rehydrationSnapshot as any)?.fields?.[fieldKey] as PromptRehydrationItemV1[] | undefined;
                const built = buildItemsFromSnapshot(fieldKey, snapshotItems);
                if (built && built.length > 0) {
                    nextFieldItems[fieldKey] = built;
                } else {
                    // Use ref to avoid adding snippetIndex to dependency array (prevents infinite loops)
                    nextFieldItems[fieldKey] = rebuildItemsForValue(currentVal, snippetIndexRef.current);
                }
                // CRITICAL FIX: Lock the reconciliation logic to prevent it from overwriting our work.
                // Track this field as rehydrated with its current value (per-field tracking).
                lastReconciledRef.current[fieldKey] = normalizePrompt(currentVal);
                rehydratedFieldValuesRef.current[fieldKey] = currentVal;

            } else {
                // Use ref to avoid adding snippetIndex to dependency array (prevents infinite loops)
                nextFieldItems[fieldKey] = rebuildItemsForValue(currentVal, snippetIndexRef.current);
            }
            nextReconciled[fieldKey] = normalizePrompt(currentVal);
        });

        // Guard: Only update if items actually changed to prevent infinite loops
        const currentItems = fieldItemsRef.current;
        const hasChanges = Object.keys(nextFieldItems).some(key => {
            const next = nextFieldItems[key];
            const curr = currentItems[key];
            if (!curr || curr.length !== next.length) return true;
            return next.some((item, i) => {
                const current = curr[i];
                if (!current) return true;
                return (
                    item.id !== current.id ||
                    item.type !== current.type ||
                    item.content !== current.content ||
                    item.sourceId !== current.sourceId ||
                    item.label !== current.label ||
                    item.color !== current.color ||
                    item.rehydrationMode !== current.rehydrationMode ||
                    item.frozenContent !== current.frozenContent
                );
            });
        });

        if (hasChanges) {
            setFieldItems(nextFieldItems);
        }
        initializedFieldsRef.current = new Set(availableFields);
        lastReconciledRef.current = { ...lastReconciledRef.current, ...nextReconciled };
        if (targetField) {
            itemsSourceRef.current = { field: targetField, source: "reconcile" };
        }

        setTimeout(() => {
            syncingLibraryRef.current = false;
        }, 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [availableFields, externalValueSyncKey, rehydrationKey, rehydrationSnapshot, schema, buildItemsFromSnapshot]);

    // Sync Library: keep linked blocks + prompt text aligned when snippets change.
    // Important: reconciliation depends on `library`, so we must guard against it
    // running on a library edit before the parent prompt text is updated.
    useEffect(() => {
        const prevLibrary = prevLibraryRef.current;
        prevLibraryRef.current = library;

        if (!library || library.length === 0) return;
        if (syncingLibraryRef.current) return;

        const contentReplacements = (() => {
            if (!prevLibrary || prevLibrary.length === 0) return [];
            const prevById = new Map(prevLibrary.map((snippet) => [snippet.id, snippet]));
            const replacements: Array<{ from: string; to: string }> = [];
            for (const next of library) {
                if (next.type !== "block") continue;
                const prev = prevById.get(next.id);
                if (!prev || prev.type !== "block") continue;
                const from = prev.content || "";
                const to = next.content || "";
                if (!from || !to) continue;
                if (from === to) continue;
                replacements.push({ from, to });
            }
            // Avoid partial replacements when snippets overlap (prefer longest old content first).
            replacements.sort((a, b) => b.from.length - a.from.length);
            return replacements;
        })();

        const applyContentReplacements = (value: string) => {
            if (!value || contentReplacements.length === 0) {
                return { value, didReplace: false };
            }
            let nextValue = value;
            let didReplace = false;
            for (const { from, to } of contentReplacements) {
                if (!from) continue;
                if (!nextValue.includes(from)) continue;
                nextValue = nextValue.split(from).join(to);
                didReplace = true;
            }
            return { value: nextValue, didReplace };
        };

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
            const { value: rewrittenVal, didReplace } = applyContentReplacements(currentVal);
            const valueForRebuild = didReplace ? rewrittenVal : currentVal;

            let updated = existing;
            let didChangeField = false;

            if (updated.length === 0 && valueForRebuild) {
                const rebuilt = buildItemsFromValue(valueForRebuild, snippetIndexRef.current);
                if (rebuilt && rebuilt.length > 0) {
                    updated = rebuilt;
                    didChangeField = true;
                }
            }

            let synced = updated.map(item => {
                if (item.type !== "block" || !item.sourceId) return item;

                const librarySnippet = libraryById.get(item.sourceId);
                if (!librarySnippet) {
                    // FIX: If the item is already a frozen block (e.g. rehydrated orphan), preserve it
                    if (item.rehydrationMode === "frozen" && item.type === "block") {
                        return item;
                    }

                    didChangeField = true;
                    return { ...item, type: "text" as const, sourceId: undefined, rehydrationMode: undefined, frozenContent: undefined, label: item.label || "Text" };
                }

                const nextLabel = librarySnippet.label;
                const nextColor = normalizeSnippetColor(librarySnippet.color, getSnippetColorSeed(librarySnippet));
                const isFrozen = item.rehydrationMode === "frozen";
                const frozenContent = item.frozenContent ?? item.content;
                const nextContent = isFrozen ? frozenContent : librarySnippet.content;

                if (item.label !== nextLabel || item.content !== nextContent || item.color !== nextColor || (isFrozen && item.frozenContent !== frozenContent)) {
                    didChangeField = true;
                    return { ...item, label: nextLabel, content: nextContent, color: nextColor, frozenContent: isFrozen ? frozenContent : item.frozenContent };
                }

                return item;
            });

            // If this field currently has only text items, a library edit may create
            // a brand new match that should become a linked snippet brick.
            const hasLinkedBlocksBeforeRelink = synced.some(i => i.type === "block" && !!i.sourceId);
            if (!hasLinkedBlocksBeforeRelink && valueForRebuild) {
                const relinked = rebuildItemsForValue(valueForRebuild, snippetIndexRef.current);
                const relinkedHasLinkedBlocks = relinked.some(i => i.type === "block" && !!i.sourceId);
                if (relinkedHasLinkedBlocks) {
                    synced = relinked;
                    didChangeField = true;
                }
            }

            if (didChangeField) {
                didChangeItems = true;
                nextFieldItems[fieldKey] = synced;
            }

            const hasLinkedBlocks = synced.some(i => i.type === "block" && !!i.sourceId);
            if (!hasLinkedBlocks) {
                // If a snippet's content changed, we can still keep prompt text "linked" by
                // rewriting old snippet content to the new one in-place, even if this field
                // hasn't been initialized in the constructor yet.
                if (didReplace && rewrittenVal !== currentVal) {
                    valueUpdates[fieldKey] = rewrittenVal;
                }
                continue;
            }

            const compiled = compileItemsToPrompt(synced);

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [availableFields, library]);

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
        const normalizedCurrent = normalizePrompt(currentVal);

        const normalizeItem = (i: PromptItem) => `${i.type}|${i.content}|${i.label || ''}|${i.sourceId || ''}|${i.rehydrationMode || ''}|${i.frozenContent || ''}`;
        const currentItems = fieldItemsRef.current[targetField] || [];

        const snapshotItems = (rehydrationSnapshot as any)?.fields?.[targetField] as PromptRehydrationItemV1[] | undefined;
        const snapshotBuilt = buildItemsFromSnapshot(targetField, snapshotItems);
        if (snapshotBuilt && snapshotBuilt.length > 0) {
            const snapshotNormalized = normalizePrompt(compileItemsToPrompt(snapshotBuilt));
            if (snapshotNormalized === normalizedCurrent) {
                // If the prompt text matches the rehydration snapshot, prefer the snapshot blocks
                // even when focus changes (reconcile path). This keeps stale snippet bricks intact.
                const snapshotStr = snapshotBuilt.map(normalizeItem).join('~');
                const itemsStr = currentItems.map(normalizeItem).join('~');
                if (snapshotStr !== itemsStr) {
                    setItems(snapshotBuilt, "Prompt reconstructed", false, "reconcile");
                }
                lastReconciledRef.current[targetField] = normalizedCurrent;
                rehydratedFieldValuesRef.current[targetField] = currentVal;
                return;
            }
        }

        // CRITICAL FIX: Skip reconciliation if this field was just rehydrated with this exact value.
        // This prevents reconciliation from overwriting rehydrated blocks when the user clicks on a field.
        if (rehydratedFieldValuesRef.current[targetField] === currentVal) {
            return;
        }

        if (currentItems.length > 0) {
            const compiledNormalized = normalizePrompt(compileItemsToPrompt(currentItems));
            if (compiledNormalized === normalizedCurrent) {
                lastReconciledRef.current[targetField] = normalizedCurrent;
                return;
            }
        }

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

            const matches = findSnippetMatches(currentVal, snippetIndexRef.current);
            if (matches === null) return;
            const selectedMatches = selectNonOverlappingMatches(matches, { preferLongest: true });

            const newItems: PromptItem[] = [];
            let cursor = 0;

            const safeVal = currentVal;
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

                    if (gap.trim().length > 0) {
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

                if (tail.trim().length > 0) {
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

            const normalizeItem = (i: PromptItem) => `${i.type}|${i.content}|${i.label || ''}|${i.sourceId || ''}|${i.rehydrationMode || ''}|${i.frozenContent || ''}`;
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
                        library: snippetIndexRef.current.entries.length,
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentValues[targetField], targetField, isTargetValid, snippetIndex, buildItemsFromSnapshot, rehydrationSnapshot]);


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

        // Only update parent if local change differs from parent value.
        // Use implicit separators for cleaner linking (commas for tags, spaces for NL snippets).
        const compiled = compileItemsToPrompt(items);
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
        const defaultContent = items.some(isNaturalLanguageSnippet) ? "" : ", ";
        setItems([...items, { id, type: 'text', content: defaultContent, label: `Text ${nextIndex}` }]);
    };

    const addSnippetToCanvas = (snippet: PromptItem) => {
        if (!isTargetValid) return;
        const id = `instance-${nextInstanceId()}`;
        trackSnippetAction("add_snippet", { snippet_id: snippet.id });
        // Use callback form to avoid stale closure - ensures we always work with latest items
        setItems((prev) => [...prev, { ...snippet, id, sourceId: snippet.id }], "Added snippet to canvas");
    };

    // Ref pattern: allow memoized components to always access the latest callback
    const addSnippetToCanvasRef = useRef(addSnippetToCanvas);
    addSnippetToCanvasRef.current = addSnippetToCanvas;

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
            // We update the library state; the existing "Sync Library" useEffect 
            // will detect the change, rewrite prompt text (if content changed),
            // and update fieldItems safely.

            const updatedLibrary = library.map(s =>
                s.id === editingSnippetId
                    ? { ...s, label: snippetTitle, content: snippetContent }
                    : s
            );

            setLibrary(updatedLibrary);
            cancelEdit();

        } else {
            // CREATE NEW
            const newSnippet: PromptItem = {
                id: `s-${nextInstanceId()}`,
                type: 'block',
                label: snippetTitle,
                content: snippetContent,
                color: getNextSnippetColor(library)
            };

            setLibrary([...library, newSnippet]);
            setSnippetContent("");
            setSnippetTitle("");
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            // If snippet editor is completely empty, don't handle the event here
            // Let it bubble up to trigger generation instead
            if (!snippetTitle.trim() && !snippetContent.trim()) {
                return; // Don't prevent default, let it bubble
            }
            e.preventDefault();
            e.stopPropagation();
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

    const handleUpdateItemContent = useCallback((id: string, value: string) => {
        setItems((prev) => {
            let mutated = false;
            const next = prev.map((item) => {
                if (item.id !== id) return item;
                if (item.content === value) return item;
                mutated = true;
                return { ...item, content: value };
            });
            return mutated ? next : prev;
        }, "Text updated", false);
    }, [setItems]);

    const handleSetSnippetRehydrationMode = useCallback((id: string, mode: "frozen" | "live") => {
        trackSnippetAction(mode === "live" ? "rehydrate_snippet" : "restore_saved_snippet", { target_id: id });
        setItems((prev) => {
            const libraryById = libraryByIdRef.current;
            let mutated = false;
            const next = prev.map((item) => {
                if (item.id !== id) return item;
                if (item.type !== "block" || !item.sourceId) return item;

                const frozenContent = item.frozenContent ?? item.content;

                if (mode === "frozen") {
                    if (item.rehydrationMode === "frozen" && item.content === frozenContent && item.frozenContent === frozenContent) {
                        return item;
                    }
                    mutated = true;
                    return { ...item, rehydrationMode: "frozen" as const, frozenContent, content: frozenContent };
                }

                const snippet = libraryById.get(item.sourceId);
                if (!snippet) {
                    if (item.rehydrationMode === "frozen" && item.content === frozenContent && item.frozenContent === frozenContent) {
                        return item;
                    }
                    mutated = true;
                    return { ...item, rehydrationMode: "frozen" as const, frozenContent, content: frozenContent };
                }

                if (
                    item.rehydrationMode === "live" &&
                    item.content === snippet.content &&
                    item.label === snippet.label &&
                    item.color === snippet.color &&
                    item.frozenContent === frozenContent
                ) {
                    return item;
                }

                mutated = true;
                return {
                    ...item,
                    rehydrationMode: "live" as const,
                    frozenContent,
                    content: snippet.content,
                    label: snippet.label,
                    color: normalizeSnippetColor(snippet.color, getSnippetColorSeed(snippet)),
                };
            });
            return mutated ? next : prev;
        }, mode === "live" ? "Rehydrated snippet" : "Restored saved snippet");
    }, [setItems, trackSnippetAction]);

    const handleRemoveItem = useCallback((id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        trackSnippetAction("remove_item", { target_id: id });
        setItems((prev) => prev.filter((item) => item.id !== id), "Removed item");
    }, [setItems, trackSnippetAction]);


    return (
        <div className="prompt-constructor h-full flex flex-col border-t border-border">

            {/* 2. Snippet Creator (Standing) */}
            <div data-snippet-editor="true" className={cn("p-3 border-b border-dashed border-border shrink-0 transition-colors bg-surface-raised/60", isEditing && "bg-surface-overlay/60")}>
                <div className="flex gap-2">
                    <div className="flex-1 space-y-2">
                        <div className="flex justify-between items-center">
                            <Input
                                placeholder="snippet name"
                                className="h-7 text-xs font-semibold bg-surface w-full disabled:opacity-80"
                                value={snippetTitle}
                                onChange={e => setSnippetTitle(e.target.value)}
                                onKeyDown={handleTitleKeyDown}
                                disabled={!!editingTextId}
                            />
                            {isEditing && <span className="text-[10px] font-bold text-primary ml-2 whitespace-nowrap">EDITING</span>}
                        </div>
                        <PromptAutocompleteTextarea
                            placeholder="Prompt text... (Ctrl+Enter to save)"
                            className="h-[100px] text-xs font-mono bg-surface resize-none"
                            value={snippetContent}
                            onValueChange={setSnippetContent}
                            onKeyDown={handleKeyDown}
                            showAutocompleteToggle={true}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Button
                            variant="default"
                            className="h-auto flex-1 w-10 p-0 flex flex-col gap-1 items-center justify-center"
                            onClick={saveSnippet}
                            title={isEditing ? "Update Snippet" : "Create Snippet"}
                        >
                            {isEditing ? <Check size={16} /> : <Plus size={16} />}
                            <span className="text-[10px] font-bold">{isEditing ? "Update" : "Add"}</span>
                        </Button>
                        {isEditing && (
                            <Button
                                variant="ghost"
                                className="h-auto flex-1 w-10 p-0 flex flex-col gap-1 items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"
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
            <div className="px-3 py-2 border-b border-border shadow-sm shrink-0 bg-surface/80">
                <div className="mb-2">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase block">Snippets (Double-click to Add, Drag to Reorder, Long-press to Edit)</span>
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
                            columnCount={3}
                            rowHeight={32}
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
                                    onDoubleClick={() => addSnippetToCanvasRef.current(snippet)}
                                    onEdit={(e) => editSnippet(snippet, e)}
                                    onDelete={(e) => deleteFromLibrary(snippet.id, e)}
                                    onAddToCanvas={() => addSnippetToCanvasRef.current(snippet)}
                                />
                            )}
                        />
                    </SortableContext>
                </DndContext>
            </div>

            {/* 4. Canvas (Vertical / Flex Wrap) */}
            <div className="flex-1 overflow-y-auto p-4 relative bg-background">
                {!isTargetValid ? (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-sm select-none gap-2 opacity-60">
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
                                    className="h-7 w-7 text-foreground bg-muted hover:bg-hover border border-border shadow-xs"
                                    onClick={() => onFinish?.()}
                                    title="Finish Editing (Deselect)"
                                >
                                    <Check size={16} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-border/60 shadow-sm"
                                    onClick={clearCanvas}
                                    title="Clear Canvas"
                                >
                                    <Eraser size={16} />
                                </Button>
                            </div>
                        )}

                        <SortableContext
                            items={sortableIds}
                            strategy={rectSortingStrategy}
                        >
                            {/* Canvas grid uses 2-column layout to match snippet bank. */}
                            <div className="grid grid-cols-2 auto-rows-[minmax(32px,auto)] items-start gap-2 min-h-[100px] p-2 rounded-xl border-2 border-dashed border-border bg-surface-raised/40 transition-colors hover:bg-hover/40 relative group/canvas">

                                {items.length === 0 && (
                                    <div className="w-full text-center py-10 text-muted-foreground text-sm select-none italic flex flex-col items-center gap-2">
                                        <CornerDownLeft size={24} className="opacity-20" />
                                        <span>Drag snippets here to build prompt</span>
                                    </div>
                                )}
                                {(() => {
                                    let textCount = 0;
                                    return items.map((item) => {
                                        const textIndex = item.type === 'text' ? (textCount += 1) : undefined;
                                        return (
                                            <SortableItem
                                                key={item.id}
                                                textIndex={textIndex}
                                                item={item}
                                                onRemove={handleRemoveItem}
                                                onUpdateContent={handleUpdateItemContent}
                                                onEditTextSnippet={item.type === 'text' ? editTextSnippet : undefined}
                                                onTextFocusChange={setTextInputFocused}
                                                onSetSnippetRehydrationMode={handleSetSnippetRehydrationMode}
                                            />
                                        );
                                    });
                                })()}
                                <Button
                                    variant="ghost"
                                    className="h-8 border border-dashed text-muted-foreground hover:text-foreground hover:bg-muted/20 text-[10px] gap-1 ml-1 justify-start"
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


