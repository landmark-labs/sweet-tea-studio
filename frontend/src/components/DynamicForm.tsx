import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSetAtom, useStore } from "jotai";
import { Button } from "@/components/ui/button";
import { DraggablePanel } from "@/components/ui/draggable-panel";
import { api } from "@/lib/api";
import type { PromptItem, PromptRehydrationSnapshotV1, PromptRehydrationItemV1 } from "@/lib/types";
import { formDataAtom, setFormDataAtom } from "@/lib/atoms/formAtoms";
import { ChevronDown, ChevronUp, Palette, X } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSeparator, ContextMenuLabel } from "@/components/ui/context-menu";
import { FieldRenderer } from "@/components/dynamic-form/FieldRenderer";
import { NodeMediaGroup, NodePromptGroup, NodeStackRow } from "@/components/dynamic-form/NodeGroups";
import { NODE_HOVER_CLOSE_DELAY, NODE_HOVER_OPEN_DELAY } from "@/components/dynamic-form/constants";
import type { FormSection, GroupMap, PlacementMeta } from "@/components/dynamic-form/types";
import { isMediaUploadField, resolveNodeTitle, resolveParamTitle } from "@/components/dynamic-form/fieldUtils";

interface DynamicFormProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSubmit: (data: any) => void;
    nodeOrder?: string[];
    persistenceKey?: string;
    engineId?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onChange?: (data: any) => void;
    onFieldFocus?: (key: string) => void;
    onFieldBlur?: (key: string, relatedTarget: Element | null) => void;
    activeField?: string;
    onReset?: () => void;
    snippets?: PromptItem[];
    projectSlug?: string; // If set, uploads go to project-specific input folder
    destinationFolder?: string; // If set with projectSlug, uploads go to /input/<project>/<folder>/
    submitLabel?: string;
    isLoading?: boolean;
    submitDisabled?: boolean;
    externalValueSyncKey?: number;
    promptRehydrationSnapshot?: PromptRehydrationSnapshotV1 | null;
    promptRehydrationKey?: number;
    workflowId?: string;
    paletteOpen?: boolean;
    onPaletteClose?: () => void;
    paletteSyncKey?: number;
}

export const DynamicForm = React.memo(function DynamicForm({
    schema,
    onSubmit,
    nodeOrder,
    persistenceKey,
    engineId,
    onChange: externalOnChange,
    onFieldFocus,
    onFieldBlur,
    activeField,
    onReset,
    snippets = [],
    projectSlug,
    destinationFolder,
    externalValueSyncKey,
    promptRehydrationSnapshot,
    promptRehydrationKey,
    workflowId,
    paletteOpen = false,
    onPaletteClose,
    paletteSyncKey = 0,
}: DynamicFormProps) {
    const [dynamicOptions, setDynamicOptions] = useState<Record<string, string[]>>({});
    const store = useStore();
    const setFormData = useSetAtom(setFormDataAtom);

    // Initialize defaults or load from storage (fallback for uncontrolled usage)
    useEffect(() => {
        if (!schema || externalOnChange) return;

        let storedData = null;
        if (persistenceKey) {
            try {
                const item = localStorage.getItem(persistenceKey);
                if (item) storedData = JSON.parse(item);
            } catch (e) {
                console.error("Failed to load form data", e);
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const defaults: any = {};
        Object.keys(schema).forEach((key) => {
            if (schema[key].default !== undefined) {
                defaults[key] = schema[key].default;
            }
        });

        setFormData({ ...defaults, ...(storedData || {}) });
    }, [schema, persistenceKey, externalOnChange, setFormData]);

    // Load dynamic options from Engine
    useEffect(() => {
        if (!engineId || !schema) return;
        const parsedEngineId = parseInt(engineId, 10);
        if (!Number.isFinite(parsedEngineId)) return;

        const loadDynamicOptions = async () => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const info = await api.getEngineObjectInfo(parsedEngineId);
                const newOptions: Record<string, string[]> = {};

                Object.keys(schema).forEach(key => {
                    const field = schema[key];
                    const classType = field.x_class_type;

                    if (classType && info[classType]) {
                        const nodeDef = info[classType];
                        // Identify parameter name from key (usually "Class.param") or just match field title?
                        // Schema key is "Class.param" usually.
                        const paramName = key.split('.').pop();

                        if (paramName) {
                            // Check inputs
                            const inputs = { ...nodeDef.input?.required, ...nodeDef.input?.optional };
                            const inputDef = inputs[paramName];

                            if (inputDef) {
                                const inputType = inputDef[0];
                                if (Array.isArray(inputType)) {
                                    // Legacy enum format: [["a","b","c"]]
                                    newOptions[key] = inputType;
                                } else if (typeof inputType === "string" && inputType.toUpperCase() === "COMBO") {
                                    // Typed enum format: ["COMBO", { options: ["a","b"], default: "a" }]
                                    const options = inputDef?.[1]?.options;
                                    if (Array.isArray(options)) {
                                        newOptions[key] = options;
                                    }
                                }
                            }
                        }
                    }
                });

                setDynamicOptions(newOptions);
            } catch (e) {
                console.error("Failed to load dynamic options", e);
            }
        };

        loadDynamicOptions();
    }, [engineId, schema]);

    const applyData = useCallback((next: Record<string, any>) => {
        if (externalOnChange) {
            externalOnChange(next);
            return;
        }
        if (persistenceKey) {
            localStorage.setItem(persistenceKey, JSON.stringify(next));
        }
        setFormData(next);
    }, [externalOnChange, persistenceKey, setFormData]);

    const handleUpdate = useCallback((updates: Record<string, any>) => {
        const current = store.get(formDataAtom) || {};
        const next = { ...current, ...updates };
        applyData(next);
    }, [applyData, store]);

    const handleChange = useCallback((key: string, value: string | number | boolean) => {
        handleUpdate({ [key]: value });
    }, [handleUpdate]);

    // Group fields
    const groups = useMemo<{
        inputs: string[];
        prompts: string[];
        loras: string[];
        nodes: Record<string, GroupMap>;
        placements: Record<string, PlacementMeta>;
    }>(() => {
        if (!schema) return { inputs: [], prompts: [], loras: [], nodes: {}, placements: {} };

        const inputs: string[] = [];
        const prompts: PlacementMeta[] = [];
        const loras: string[] = [];
        const nodes: Record<string, GroupMap> = {};
        const placements: Record<string, PlacementMeta> = {};

        const nodeOrderIndex = new Map<string, number>();
        nodeOrder?.forEach((id, idx) => nodeOrderIndex.set(String(id), idx));

        const parseOrder = (value?: string | number, fallback = 999) => {
            if (typeof value === "number") return value;
            const parsed = parseInt(value || "");
            return Number.isFinite(parsed) ? parsed : fallback;
        };

        const resolvePlacement = (key: string): PlacementMeta => {
            const field = schema[key];
            const nodeId = field.x_node_id ? String(field.x_node_id) : undefined;
            const nodeOrderPosition = nodeId !== undefined && nodeOrderIndex.has(nodeId)
                ? nodeOrderIndex.get(nodeId)
                : undefined;
            const annotations = field.x_form as {
                section?: FormSection;
                groupId?: string;
                groupTitle?: string;
                order?: number;
            };

            if (annotations?.section) {
                return {
                    key,
                    section: annotations.section,
                    groupId: annotations.groupId || annotations.section,
                    groupTitle: annotations.groupTitle || field.title || annotations.groupId || key,
                    order: nodeOrderPosition ?? parseOrder(annotations.order ?? field.x_node_id),
                    source: "annotation",
                    reason: "explicit_annotation"
                };
            }

            // Media uploads are grouped with their parent node - same title resolution as other fields
            const isMediaUpload = isMediaUploadField(key, field);
            if (isMediaUpload) {
                const nodeGroupId = field.x_node_id ? String(field.x_node_id) : "media";
                const groupTitle = resolveNodeTitle(field, "Media Input");
                return {
                    key,
                    section: "nodes",
                    groupId: nodeGroupId,
                    groupTitle,
                    order: nodeOrderPosition ?? parseOrder(field.x_node_id, 0),
                    source: "heuristic",
                    reason: "media_upload"
                };
            }

            const isStrictPrompt = field.x_class_type && (
                field.x_class_type.includes("CLIPTextEncode") ||
                field.x_class_type.includes("String Literal") ||
                field.x_class_type.includes("SimpleWildcards")
            );

            if (field.widget === "textarea" && isStrictPrompt) {
                return {
                    key,
                    section: "prompts",
                    groupId: field.x_node_id || "prompt",
                    groupTitle: field.title || "Prompt",
                    order: nodeOrderPosition ?? -1,
                    source: "heuristic",
                    reason: "prompt_textarea"
                };
            }

            if (field.x_class_type === "LoraLoader" || (field.title && field.title.includes("LoraLoader"))) {
                return {
                    key,
                    section: "loras",
                    groupId: field.x_node_id ? String(field.x_node_id) : "loras",  // Use unique node ID
                    groupTitle: field.x_title || field.title || "LoRA",
                    order: nodeOrderPosition ?? parseOrder(field.x_node_id, 0),
                    source: "heuristic",
                    reason: "lora_loader"
                };
            }

            const fallbackNodeId = field.x_node_id || "default";
            // Prefer alias > x_title > field.title for group title
            const fallbackGroupTitle = field.x_node_alias || field.x_title || field.title || "Configuration";
            const match = field.title?.match(/\((.+)\)$/);
            // If we have an alias, use it directly; otherwise fall back to heuristics
            const heuristicTitle = field.x_node_alias || (match ? match[1] : fallbackGroupTitle);
            // Always prefer the clean x_node_id for grouping stability if available
            const nodeGroupId = field.x_node_id ? String(field.x_node_id) : (match ? heuristicTitle : fallbackNodeId);

            return {
                key,
                section: "nodes",
                groupId: nodeGroupId,
                groupTitle: heuristicTitle,
                order: nodeOrderPosition ?? parseOrder(field.x_node_id),
                source: "heuristic",
                reason: match ? "title_annotation_match" : "fallback_configuration"
            };
        };

        Object.keys(schema).forEach((key) => {
            const placement = resolvePlacement(key);
            placements[key] = placement;

            // Note: "inputs" section is deprecated - media uploads now go into their node groups
            // This block is kept for backwards compatibility with explicit x_form annotations
            if (placement.section === "inputs" && placement.source === "annotation") {
                inputs.push(key);
                return;
            }

            if (placement.section === "prompts") {
                prompts.push(placement);
                return;
            }

            if (placement.section === "loras") {
                loras.push(key);
                // Fall through to also add to node groups
            }

            // All non-input, non-prompt fields go into node groups (including loras)
            if (!nodes[placement.groupId]) {
                nodes[placement.groupId] = {
                    title: placement.groupTitle || "Advanced",
                    keys: [],
                    order: placement.order ?? 999
                };
            } else if (nodes[placement.groupId].title.startsWith("Bypass") && !placement.groupTitle.startsWith("Bypass")) {
                // Upgrade title if we found a better one
                nodes[placement.groupId].title = placement.groupTitle;
            }
            nodes[placement.groupId].order = Math.min(nodes[placement.groupId].order, placement.order ?? nodes[placement.groupId].order);
            nodes[placement.groupId].keys.push(key);
        });

        prompts.sort((a, b) => a.order - b.order);

        return { inputs, prompts: prompts.map((prompt) => prompt.key), loras, nodes, placements };

    }, [schema, nodeOrder]);

    const compareGroups = (a: { order: number; id?: string; title?: string }, b: { order: number; id?: string; title?: string }) => {
        const orderA = Number.isFinite(a.order) ? a.order : 999;
        const orderB = Number.isFinite(b.order) ? b.order : 999;
        if (orderA !== orderB) return orderA - orderB;
        const titleA = (a.title || a.id || "").toString();
        const titleB = (b.title || b.id || "").toString();
        return titleA.localeCompare(titleB);
    };

    // User-managed core keys: fields with x_core: true go to Core Controls
    // All others go to Expanded Controls (accordion)
    const strictCoreKeys = useMemo(() => {
        if (!schema) return new Set<string>();

        // Find all keys where x_core is true
        const coreKeys = Object.keys(schema).filter((key) => {
            const field = schema[key];
            return field.x_core === true;
        });

        // Add the first 2 prompts to core keys so they appear at the top (can be overridden by user)
        // Only if prompts don't already have x_core defined
        const corePrompts = groups.prompts.slice(0, 2).filter(key => {
            const field = schema[key];
            return field.x_core !== false; // Include if undefined or true
        });

        return new Set([...coreKeys, ...corePrompts]);
    }, [schema, groups.prompts]);

    // Group core keys by node ID for proper visual organization
    // If ANY key from a node has x_core: true, include ALL keys from that node in core
    const strictCoreGroups = useMemo(() => {
        if (!schema) return [] as { id: string; title: string; keys: string[]; order: number }[];

        // First pass: identify which node IDs have ANY core keys
        const coreNodeIds = new Set<string>();
        Array.from(strictCoreKeys).forEach((key) => {
            const field = schema[key];
            const placement = groups.placements[key];
            const nodeId = String(field?.x_node_id || placement?.groupId || "general");
            coreNodeIds.add(nodeId);
        });

        const groupMap: Record<string, { title: string; keys: string[]; order: number }> = {};

        // Second pass: add ALL keys for nodes that have any core keys
        Object.keys(schema).forEach((key) => {
            const field = schema[key];
            const placement = groups.placements[key];
            const nodeId = String(field?.x_node_id || placement?.groupId || "general");

            // Only include if this node has any core keys
            if (!coreNodeIds.has(nodeId)) return;

            const nodeTitle = placement?.groupTitle || field?.x_title || "General";

            // SIMPLE: Use direct position in nodeOrder array, fallback to 999 if not found
            const orderIndex = (nodeOrder || []).indexOf(nodeId);
            const order = orderIndex >= 0 ? orderIndex : 999;

            if (!groupMap[nodeId]) {
                groupMap[nodeId] = { title: nodeTitle, keys: [], order };
            } else if (groupMap[nodeId].title.startsWith("Bypass") && !nodeTitle.startsWith("Bypass")) {
                // Upgrade title
                groupMap[nodeId].title = nodeTitle;
            }
            groupMap[nodeId].keys.push(key);
        });

        return Object.entries(groupMap)
            .map(([id, group]) => ({ id, ...group }))
            .sort((a, b) => a.order - b.order);
    }, [schema, strictCoreKeys, groups.placements, nodeOrder]);

    const getBypassMeta = (group: { id?: string; keys: string[] }) => {
        if (!schema) return { bypassKey: undefined, hasBypass: false };
        let bypassKey = group.keys.find(k => {
            const f = schema[k];
            return f?.widget === "toggle" && (
                (f.title && f.title.toLowerCase().startsWith("bypass")) ||
                k.toLowerCase().includes("bypass")
            );
        });

        if (!bypassKey && group.id) {
            const strictKey = `__bypass_${group.id}`;
            if (schema && strictKey in schema) bypassKey = strictKey;
        }

        const hasBypass = !!bypassKey;
        return { bypassKey, hasBypass };
    };

    const stackGroups = useMemo(() => {
        if (!schema) return [] as { id: string; title: string; keys: string[]; order: number }[];

        // First, identify which node IDs have ANY core keys - these entire nodes should only appear in core
        const coreNodeIds = new Set<string>();
        Array.from(strictCoreKeys).forEach((key) => {
            const field = schema[key];
            const placement = groups.placements[key];
            const nodeId = String(field?.x_node_id || placement?.groupId || "general");
            coreNodeIds.add(nodeId);
        });

        const groupMap: Record<string, { id: string; title: string; keys: string[]; order: number }> = {};

        Object.keys(schema).forEach((key) => {
            const placement = groups.placements[key];
            if (!placement) return;
            if (placement.section === "inputs" && placement.source === "annotation") return;

            const groupId = String(placement.groupId || "default");

            // Skip entire node groups that have ANY core keys
            if (coreNodeIds.has(groupId)) return;

            const groupTitle = placement.groupTitle || "Configuration";
            const order = Number.isFinite(placement.order) ? placement.order : 999;

            if (!groupMap[groupId]) {
                groupMap[groupId] = {
                    id: groupId,
                    title: groupTitle,
                    keys: [key],
                    order,
                };
            } else {
                groupMap[groupId].keys.push(key);
                groupMap[groupId].order = Math.min(groupMap[groupId].order, order);
                if (groupMap[groupId].title.startsWith("Bypass") && !groupTitle.startsWith("Bypass")) {
                    groupMap[groupId].title = groupTitle;
                }
            }
        });

        return Object.values(groupMap).sort(compareGroups);
    }, [schema, strictCoreKeys, groups.placements]);

    const stackGroupsWithMeta = useMemo(() => {
        return stackGroups.map((group) => ({
            ...group,
            ...getBypassMeta(group),
        }));
    }, [stackGroups, schema]);

    const promptKeySet = useMemo(() => new Set(groups.prompts), [groups.prompts]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(store.get(formDataAtom));
    };

    const handleToggleChange = useCallback((key: string, checked: boolean) => {
        // If enabling bypass, auto-fill any empty required enum fields in the same group
        // This prevents "Value not in list" errors from ComfyUI validation
        const updates: Record<string, any> = { [key]: checked };

        if (checked === true) {
            const placement = groups.placements[key];
            if (placement && placement.groupId) {
                const groupKeys = groups.nodes[placement.groupId]?.keys || [];
                const currentData = store.get(formDataAtom) || {};
                groupKeys.forEach(siblingKey => {
                    if (siblingKey === key) return;
                    const siblingField = schema[siblingKey];
                    const currentValue = currentData[siblingKey];

                    // Check if it's an enum field and currently empty
                    if (siblingField?.enum && Array.isArray(siblingField.enum) && siblingField.enum.length > 0) {
                        if (currentValue === "" || currentValue === undefined || currentValue === null) {
                            updates[siblingKey] = siblingField.enum[0];
                        }
                    }
                });
            }
        }

        handleUpdate(updates);
    }, [groups.nodes, groups.placements, handleUpdate, schema, store]);

    const paletteStorageKey = useMemo(() => {
        if (!workflowId) return null;
        return `ds_pipe_palette_${workflowId}`;
    }, [workflowId]);

    const [paletteKeys, setPaletteKeys] = useState<string[]>([]);
    const [paletteHydrated, setPaletteHydrated] = useState(false);
    const paletteKeySet = useMemo(() => new Set(paletteKeys), [paletteKeys]);
    const paletteKeysRef = useRef<string[]>([]);

    const applyPaletteKeys = useCallback((nextKeys: string[]) => {
        const deduped = Array.from(new Set(nextKeys));
        paletteKeysRef.current = deduped;
        setPaletteKeys(deduped);
        if (paletteStorageKey && paletteHydrated) {
            localStorage.setItem(paletteStorageKey, JSON.stringify(deduped));
        }
    }, [paletteHydrated, paletteStorageKey]);

    useEffect(() => {
        setPaletteHydrated(false);
        if (!paletteStorageKey) {
            paletteKeysRef.current = [];
            setPaletteKeys([]);
            setPaletteHydrated(true);
            return;
        }
        try {
            const raw = localStorage.getItem(paletteStorageKey);
            if (!raw) {
                paletteKeysRef.current = [];
                setPaletteKeys([]);
                setPaletteHydrated(true);
                return;
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                paletteKeysRef.current = [];
                setPaletteKeys([]);
                setPaletteHydrated(true);
                return;
            }
            const next = parsed.filter((entry) => typeof entry === "string") as string[];
            const deduped = Array.from(new Set(next));
            paletteKeysRef.current = deduped;
            setPaletteKeys(deduped);
        } catch (err) {
            console.warn("[palette] Failed to load palette contents", err);
            paletteKeysRef.current = [];
            setPaletteKeys([]);
        } finally {
            setPaletteHydrated(true);
        }
    }, [paletteStorageKey, paletteSyncKey]);

    useEffect(() => {
        if (!schema || !paletteHydrated) return;
        if (Object.keys(schema).length === 0) return;
        const current = paletteKeysRef.current;
        const next = current.filter((key) => key in schema);
        if (next.length === current.length) return;
        paletteKeysRef.current = next;
        setPaletteKeys(next);
        if (paletteStorageKey) {
            localStorage.setItem(paletteStorageKey, JSON.stringify(next));
        }
    }, [paletteHydrated, paletteStorageKey, schema]);

    useEffect(() => {
        if (!paletteStorageKey || !paletteHydrated) return;
        paletteKeysRef.current = paletteKeys;
        localStorage.setItem(paletteStorageKey, JSON.stringify(paletteKeys));
    }, [paletteHydrated, paletteKeys, paletteStorageKey]);

    const togglePaletteKey = useCallback((key: string) => {
        const current = paletteKeysRef.current;
        const next = current.includes(key)
            ? current.filter((entry) => entry !== key)
            : [...current, key];
        applyPaletteKeys(next);
    }, [applyPaletteKeys]);

    const togglePaletteKeys = useCallback((keys: string[]) => {
        if (keys.length === 0) return;
        const current = paletteKeysRef.current;
        const currentSet = new Set(current);
        const allSelected = keys.every((key) => currentSet.has(key));
        if (allSelected) {
            const removeSet = new Set(keys);
            const next = current.filter((key) => !removeSet.has(key));
            applyPaletteKeys(next);
            return;
        }
        const next = [...current];
        keys.forEach((key) => {
            if (currentSet.has(key)) return;
            currentSet.add(key);
            next.push(key);
        });
        applyPaletteKeys(next);
    }, [applyPaletteKeys]);

    const removePaletteKeys = useCallback((keys: string[]) => {
        if (keys.length === 0) return;
        const removeSet = new Set(keys);
        const current = paletteKeysRef.current;
        const next = current.filter((key) => !removeSet.has(key));
        applyPaletteKeys(next);
    }, [applyPaletteKeys]);

    const [activeStackId, setActiveStackId] = useState<string | null>(null);
    const hoverOpenTimerRef = useRef<NodeJS.Timeout | null>(null);
    const hoverCloseTimerRef = useRef<NodeJS.Timeout | null>(null);
    const [mediaExpanded, setMediaExpanded] = useState<Record<string, boolean>>({});
    const [promptExpanded, setPromptExpanded] = useState<Record<string, boolean>>({});
    const [expandedControlsCollapsed, setExpandedControlsCollapsed] = useState(() => {
        if (typeof window !== "undefined") {
            return localStorage.getItem("ds_expanded_controls_collapsed") === "true";
        }
        return false;
    });
    const clearHoverTimers = useCallback(() => {
        if (hoverOpenTimerRef.current) {
            clearTimeout(hoverOpenTimerRef.current);
            hoverOpenTimerRef.current = null;
        }
        if (hoverCloseTimerRef.current) {
            clearTimeout(hoverCloseTimerRef.current);
            hoverCloseTimerRef.current = null;
        }
    }, []);

    const isMenuOpenRef = useRef(false);

    const handleMenuOpen = useCallback((isOpen: boolean) => {
        isMenuOpenRef.current = isOpen;
        if (isOpen) {
            clearHoverTimers();
        }
    }, [clearHoverTimers]);

    const requestOpenNode = useCallback((id: string, immediate = false) => {
        clearHoverTimers();
        if (immediate) {
            setActiveStackId(id);
            return;
        }
        hoverOpenTimerRef.current = setTimeout(() => {
            setActiveStackId(id);
        }, NODE_HOVER_OPEN_DELAY);
    }, [clearHoverTimers]);

    const requestCloseNode = useCallback((id: string) => {
        if (isMenuOpenRef.current) return;
        clearHoverTimers();
        hoverCloseTimerRef.current = setTimeout(() => {
            setActiveStackId((current) => (current === id ? null : current));
        }, NODE_HOVER_CLOSE_DELAY);
    }, [clearHoverTimers]);

    const closeNodeImmediate = useCallback((id: string) => {
        clearHoverTimers();
        setActiveStackId((current) => (current === id ? null : current));
    }, [clearHoverTimers]);

    const holdNodeOpen = useCallback(() => {
        if (hoverCloseTimerRef.current) {
            clearTimeout(hoverCloseTimerRef.current);
            hoverCloseTimerRef.current = null;
        }
    }, []);

    const toggleMediaGroup = useCallback((id: string) => {
        setMediaExpanded((prev) => {
            const current = prev[id];
            const next = current === undefined ? false : !current;
            return { ...prev, [id]: next };
        });
    }, []);

    const togglePromptGroup = useCallback((id: string) => {
        setPromptExpanded((prev) => {
            const current = prev[id];
            const next = current === undefined ? false : !current;
            return { ...prev, [id]: next };
        });
    }, []);

    useEffect(() => {
        setActiveStackId(null);
        setMediaExpanded({});
        setPromptExpanded({});
    }, [schema]);

    useEffect(() => {
        if (!activeStackId) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                clearHoverTimers();
                setActiveStackId(null);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [activeStackId, clearHoverTimers]);

    useEffect(() => {
        return () => clearHoverTimers();
    }, [clearHoverTimers]);

    const renderField = useCallback((key: string) => {
        const field = schema[key];
        const isActive = key === activeField;
        const isPromptField = groups.prompts.includes(key);
        const rehydrationItems = (promptRehydrationSnapshot?.fields?.[key] as PromptRehydrationItemV1[] | undefined);

        return (
            <FieldRenderer
                key={key}
                fieldKey={key}
                field={field}
                isActive={isActive}
                isPromptField={isPromptField}
                dynamicOptions={dynamicOptions}
                showPaletteToggle={true}
                paletteSelected={paletteKeySet.has(key)}
                onPaletteToggle={() => togglePaletteKey(key)}
                onFieldFocus={onFieldFocus}
                onFieldBlur={onFieldBlur}
                onValueChange={handleChange}
                onToggleChange={handleToggleChange}
                snippets={snippets}
                rehydrationItems={rehydrationItems}
                rehydrationKey={promptRehydrationKey}
                engineId={engineId}
                projectSlug={projectSlug}
                destinationFolder={destinationFolder}
                externalValueSyncKey={externalValueSyncKey}
                onMenuOpen={handleMenuOpen}
            />
        );
    }, [
        activeField,
        paletteKeySet,
        togglePaletteKey,
        destinationFolder,
        dynamicOptions,
        engineId,
        externalValueSyncKey,
        groups.prompts,
        handleChange,
        handleToggleChange,
        onFieldBlur,
        onFieldFocus,
        promptRehydrationKey,
        promptRehydrationSnapshot,
        projectSlug,
        schema,
        snippets,
        handleMenuOpen
    ]);

    const renderMediaField = useCallback((key: string, mediaVariant: "default" | "compact", hideLabel: boolean) => {
        const field = schema[key];
        const isActive = key === activeField;
        const isPromptField = groups.prompts.includes(key);
        const rehydrationItems = (promptRehydrationSnapshot?.fields?.[key] as PromptRehydrationItemV1[] | undefined);

        return (
            <FieldRenderer
                key={key}
                fieldKey={key}
                field={field}
                isActive={isActive}
                isPromptField={isPromptField}
                dynamicOptions={dynamicOptions}
                showPaletteToggle={true}
                paletteSelected={paletteKeySet.has(key)}
                onPaletteToggle={() => togglePaletteKey(key)}
                onFieldFocus={onFieldFocus}
                onFieldBlur={onFieldBlur}
                onValueChange={handleChange}
                onToggleChange={handleToggleChange}
                snippets={snippets}
                rehydrationItems={rehydrationItems}
                rehydrationKey={promptRehydrationKey}
                engineId={engineId}
                projectSlug={projectSlug}
                destinationFolder={destinationFolder}
                externalValueSyncKey={externalValueSyncKey}
                mediaVariant={mediaVariant}
                hideLabel={hideLabel}
                onMenuOpen={handleMenuOpen}
            />
        );
    }, [
        activeField,
        paletteKeySet,
        togglePaletteKey,
        destinationFolder,
        dynamicOptions,
        engineId,
        externalValueSyncKey,
        groups.prompts,
        handleChange,
        handleToggleChange,
        onFieldBlur,
        onFieldFocus,
        promptRehydrationKey,
        promptRehydrationSnapshot,
        projectSlug,
        schema,
        snippets,
        handleMenuOpen
    ]);

    const coreGroups = useMemo(() => {
        return strictCoreGroups.map((group) => ({
            ...group,
            ...getBypassMeta(group),
        }));
    }, [strictCoreGroups, schema]);

    const paletteGroups = useMemo(() => {
        if (!schema) return [] as Array<{ id: string; title: string; order: number; keys: string[] }>;
        if (paletteKeys.length === 0) return [] as Array<{ id: string; title: string; order: number; keys: string[] }>;

        const groupMap = new Map<string, { id: string; title: string; order: number; keys: string[] }>();

        paletteKeys.forEach((key) => {
            const field = schema[key];
            if (!field) return;
            const placement = groups.placements[key];
            const groupId = String(placement?.groupId || field.x_node_id || "palette");
            const groupTitle = placement?.groupTitle || resolveNodeTitle(field, "Configuration");
            const order = Number.isFinite(placement?.order) ? placement.order : 999;

            const existing = groupMap.get(groupId);
            if (!existing) {
                groupMap.set(groupId, { id: groupId, title: groupTitle, order, keys: [key] });
                return;
            }

            existing.keys.push(key);
            existing.order = Math.min(existing.order, order);
            if (existing.title.startsWith("Bypass") && !groupTitle.startsWith("Bypass")) {
                existing.title = groupTitle;
            }
        });

        const grouped = Array.from(groupMap.values()).sort(compareGroups);

        // Use schema key order to preserve the original field order within each node
        // This matches how fields appear in the configurator
        const schemaKeyOrder = Object.keys(schema);

        grouped.forEach((group) => {
            group.keys.sort((a, b) => {
                const indexA = schemaKeyOrder.indexOf(a);
                const indexB = schemaKeyOrder.indexOf(b);
                return indexA - indexB;
            });
        });

        return grouped;
    }, [groups.placements, paletteKeys, schema]);

    if (!schema) return null;

    return (
        <form onSubmit={handleSubmit} className="space-y-6 pb-20">
            {paletteOpen && createPortal(
                <DraggablePanel
                    persistenceKey="ds_palette_pos"
                    defaultPosition={{ x: 140, y: 100 }}
                    className="z-50"
                >
                    <div className="shadow-md border border-border bg-surface/95 ring-1 ring-black/5 dark:ring-white/5 backdrop-blur-md overflow-hidden rounded-xl w-80 max-w-[320px] text-[11px] text-foreground transition-shadow">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-raised/80 cursor-move">
                            <div className="flex items-center gap-2">
                                <div className="p-1 rounded-md bg-primary shadow-sm">
                                    <Palette className="w-3 h-3 text-white" />
                                </div>
                                <span className="text-xs font-semibold text-foreground">palette</span>
                                {paletteKeys.length > 0 && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold">
                                        {paletteKeys.length}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5">
                                {onPaletteClose && (
                                    <button
                                        type="button"
                                        onClick={onPaletteClose}
                                        className="p-1 rounded-md hover:bg-hover text-muted-foreground hover:text-foreground transition-colors"
                                        aria-label="Close palette"
                                        title="Close palette"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="p-2 max-h-[85vh] overflow-y-auto">
                            {paletteGroups.length === 0 ? (
                                <div className="text-[10px] text-muted-foreground text-center py-4 px-2">
                                    <div className="mb-2 opacity-60">✨</div>
                                    Add parameters using the palette icon next to a parameter label.
                                </div>
                            ) : (
                                <div className="columns-2 gap-1.5">
                                    {paletteGroups.map((group) => (
                                        <ContextMenu key={group.id}>
                                            <ContextMenuTrigger asChild>
                                                <div
                                                    title={group.title}
                                                    className="break-inside-avoid mb-1.5 border border-border rounded-lg bg-surface-raised/70 shadow-xs hover:bg-hover/40 transition-all duration-200 cursor-default"
                                                >
                                                    <div className="p-1.5 space-y-0.5">
                                                        {group.keys.map((key) => {
                                                            const field = schema[key];
                                                            const fieldTitle = resolveParamTitle(key, field);
                                                            return (
                                                                <ContextMenu key={key}>
                                                                    <ContextMenuTrigger asChild>
                                                                        <div title={fieldTitle}>
                                                                            <FieldRenderer
                                                                                variant="palette"
                                                                                fieldKey={key}
                                                                                field={field}
                                                                                isActive={key === activeField}
                                                                                isPromptField={groups.prompts.includes(key)}
                                                                                dynamicOptions={dynamicOptions}
                                                                                onFieldFocus={onFieldFocus}
                                                                                onFieldBlur={onFieldBlur}
                                                                                onValueChange={handleChange}
                                                                                onToggleChange={handleToggleChange}
                                                                                snippets={snippets}
                                                                                rehydrationItems={(promptRehydrationSnapshot?.fields?.[key] as PromptRehydrationItemV1[] | undefined)}
                                                                                rehydrationKey={promptRehydrationKey}
                                                                                engineId={engineId}
                                                                                projectSlug={projectSlug}
                                                                                destinationFolder={destinationFolder}
                                                                                externalValueSyncKey={externalValueSyncKey}
                                                                            />
                                                                        </div>
                                                                    </ContextMenuTrigger>
                                                                    <ContextMenuContent className="min-w-[160px]">
                                                                        <ContextMenuLabel className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                                                                            {fieldTitle} • {group.title}
                                                                        </ContextMenuLabel>
                                                                        <ContextMenuSeparator />
                                                                        <ContextMenuItem
                                                                            onSelect={() => togglePaletteKey(key)}
                                                                            className="text-xs cursor-pointer"
                                                                        >
                                                                            Remove parameter
                                                                        </ContextMenuItem>
                                                                        {group.keys.length > 1 && (
                                                                            <ContextMenuItem
                                                                                onSelect={() => removePaletteKeys(group.keys)}
                                                                                className="text-xs cursor-pointer"
                                                                            >
                                                                                Remove all from {group.title}
                                                                            </ContextMenuItem>
                                                                        )}
                                                                    </ContextMenuContent>
                                                                </ContextMenu>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </ContextMenuTrigger>
                                            <ContextMenuContent className="min-w-[160px]">
                                                <ContextMenuLabel className="text-[10px] text-muted-foreground">
                                                    {group.title}
                                                </ContextMenuLabel>
                                                <ContextMenuSeparator />
                                                <ContextMenuItem
                                                    onSelect={() => removePaletteKeys(group.keys)}
                                                    className="text-xs cursor-pointer"
                                                >
                                                    Remove all {group.keys.length} parameters
                                                </ContextMenuItem>
                                            </ContextMenuContent>
                                        </ContextMenu>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </DraggablePanel>,
                document.body
            )}
            {/* 1. Main Inputs (Images) */}
            {groups.inputs.length > 0 && (
                <div className="space-y-4 p-4 bg-surface-raised/70 rounded-lg border border-border/60">
                    <h3 className="text-sm font-bold text-foreground/80 uppercase tracking-wider">input images</h3>
                    <div className="space-y-4">
                        {groups.inputs.map(renderField)}
                    </div>
                </div>
            )}

            <div className="space-y-4 p-4 bg-surface-raised/70 rounded-lg border border-border/60">
                <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-foreground tracking-normal">core pipe controls</h3>
                    {onReset && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={onReset}
                            className="h-6 text-[10px] text-muted-foreground hover:text-foreground px-2"
                        >
                            reset to defaults
                        </Button>
                    )}
                </div>
                {strictCoreGroups.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic py-2">
                        No core controls configured. Edit the pipe to add nodes to this section.
                    </div>
                ) : (
                    <div className="flex flex-col gap-3" data-core-stack>
                        {coreGroups.map((group) => {
                            const stackId = `core:${group.id}`;
                            const contentKeys = group.keys.filter((key) => key !== group.bypassKey);

                            // Skip groups that only have a bypass toggle and no actual parameters
                            if (contentKeys.length === 0) return null;

                            const mediaKeys = contentKeys.filter((key) => isMediaUploadField(key, schema[key]));
                            const nonMediaKeys = contentKeys.filter((key) => !isMediaUploadField(key, schema[key]));
                            const promptKeys = contentKeys.filter((key) => promptKeySet.has(key));
                            const nonPromptKeys = contentKeys.filter((key) => !promptKeySet.has(key));
                            const hasPromptField = promptKeys.length > 0;
                            const hasMediaField = mediaKeys.length > 0;
                            const isOpen = activeStackId === stackId;
                            const allOnPalette = contentKeys.length > 0 && contentKeys.every((key) => paletteKeySet.has(key));

                            if (hasPromptField) {
                                const promptStateId = `core:${group.id}`;
                                const isExpanded = promptExpanded[promptStateId] ?? true;
                                return (
                                    <NodePromptGroup
                                        key={group.id}
                                        group={group}
                                        promptKeys={promptKeys}
                                        nonPromptKeys={nonPromptKeys}
                                        isExpanded={isExpanded}
                                        onToggleExpanded={() => togglePromptGroup(promptStateId)}
                                        renderField={renderField}
                                        onToggleChange={handleToggleChange}
                                    />
                                );
                            }

                            if (hasMediaField) {
                                const mediaStateId = `core:${group.id}`;
                                const isExpanded = mediaExpanded[mediaStateId] ?? true;
                                return (
                                    <NodeMediaGroup
                                        key={group.id}
                                        group={group}
                                        mediaKeys={mediaKeys}
                                        nonMediaKeys={nonMediaKeys}
                                        isExpanded={isExpanded}
                                        onToggleExpanded={() => toggleMediaGroup(mediaStateId)}
                                        renderField={renderField}
                                        renderMediaField={renderMediaField}
                                        onToggleChange={handleToggleChange}
                                    />
                                );
                            }

                            return (
                                <NodeStackRow
                                    key={group.id}
                                    group={group}
                                    stackId={stackId}
                                    isOpen={isOpen}
                                    allOnPalette={allOnPalette}
                                    onHoverOpen={() => requestOpenNode(stackId)}
                                    onFocusOpen={() => requestOpenNode(stackId, true)}
                                    onHoverClose={() => requestCloseNode(stackId)}
                                    onHoldOpen={holdNodeOpen}
                                    onCloseImmediate={() => closeNodeImmediate(stackId)}
                                    onTogglePaletteAll={() => togglePaletteKeys(contentKeys)}
                                    renderField={renderField}
                                    onToggleChange={handleToggleChange}
                                />
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="space-y-3 p-4 bg-surface-raised/70 rounded-lg border border-border/60">
                <div
                    className="flex items-center justify-between cursor-pointer select-none"
                    onClick={() => {
                        const next = !expandedControlsCollapsed;
                        setExpandedControlsCollapsed(next);
                        localStorage.setItem("ds_expanded_controls_collapsed", String(next));
                    }}
                >
                    <h3 className="text-xs font-semibold text-foreground tracking-normal">expanded controls</h3>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">hover a node to edit</span>
                        {expandedControlsCollapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
                    </div>
                </div>
                {!expandedControlsCollapsed && (stackGroupsWithMeta.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic py-1">
                        No expanded controls configured.
                    </div>
                ) : (
                    <div className="flex flex-col gap-2" data-expanded-stack>
                        {stackGroupsWithMeta.map((group) => {
                            const stackId = `expanded:${group.id}`;
                            const contentKeys = group.keys.filter((key) => key !== group.bypassKey);

                            // Skip groups that only have a bypass toggle and no actual parameters
                            if (contentKeys.length === 0) return null;

                            const mediaKeys = contentKeys.filter((key) => isMediaUploadField(key, schema[key]));
                            const nonMediaKeys = contentKeys.filter((key) => !isMediaUploadField(key, schema[key]));
                            const promptKeys = contentKeys.filter((key) => promptKeySet.has(key));
                            const nonPromptKeys = contentKeys.filter((key) => !promptKeySet.has(key));
                            const hasPromptField = promptKeys.length > 0;
                            const hasMediaField = mediaKeys.length > 0;
                            const isOpen = activeStackId === stackId;
                            const allOnPalette = contentKeys.length > 0 && contentKeys.every((key) => paletteKeySet.has(key));

                            if (hasPromptField) {
                                const promptStateId = `expanded:${group.id}`;
                                const isExpanded = promptExpanded[promptStateId] ?? true;
                                return (
                                    <NodePromptGroup
                                        key={group.id}
                                        group={group}
                                        promptKeys={promptKeys}
                                        nonPromptKeys={nonPromptKeys}
                                        isExpanded={isExpanded}
                                        onToggleExpanded={() => togglePromptGroup(promptStateId)}
                                        renderField={renderField}
                                        onToggleChange={handleToggleChange}
                                    />
                                );
                            }

                            if (hasMediaField) {
                                const mediaStateId = `expanded:${group.id}`;
                                const isExpanded = mediaExpanded[mediaStateId] ?? true;
                                return (
                                    <NodeMediaGroup
                                        key={group.id}
                                        group={group}
                                        mediaKeys={mediaKeys}
                                        nonMediaKeys={nonMediaKeys}
                                        isExpanded={isExpanded}
                                        onToggleExpanded={() => toggleMediaGroup(mediaStateId)}
                                        renderField={renderField}
                                        renderMediaField={renderMediaField}
                                        onToggleChange={handleToggleChange}
                                    />
                                );
                            }

                            return (
                                <NodeStackRow
                                    key={group.id}
                                    group={group}
                                    stackId={stackId}
                                    isOpen={isOpen}
                                    allOnPalette={allOnPalette}
                                    onHoverOpen={() => requestOpenNode(stackId)}
                                    onFocusOpen={() => requestOpenNode(stackId, true)}
                                    onHoverClose={() => requestCloseNode(stackId)}
                                    onHoldOpen={holdNodeOpen}
                                    onCloseImmediate={() => closeNodeImmediate(stackId)}
                                    onTogglePaletteAll={() => togglePaletteKeys(contentKeys)}
                                    renderField={renderField}
                                    onToggleChange={handleToggleChange}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>
        </form>
    );
});

