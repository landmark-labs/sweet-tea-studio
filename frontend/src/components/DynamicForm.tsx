import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageUpload } from "@/components/ImageUpload";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { PromptAutocompleteTextarea } from "@/components/PromptAutocompleteTextarea";
import { api } from "@/lib/api";
import { PromptItem } from "@/lib/types";
import { formDataAtom, formFieldAtom, setFormDataAtom } from "@/lib/atoms/formAtoms";

type FormSection = "inputs" | "prompts" | "loras" | "nodes";

interface PlacementMeta {
    key: string;
    section: FormSection;
    groupId: string;
    groupTitle: string;
    source: "annotation" | "heuristic";
    reason: string;
    order: number;
}

interface GroupMap {
    title: string;
    keys: string[];
    order: number;
}

interface FieldRendererProps {
    fieldKey: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    field: any;
    isActive: boolean;
    isPromptField: boolean;
    dynamicOptions: Record<string, string[]>;
    onFieldFocus?: (key: string) => void;
    onFieldBlur?: (key: string, relatedTarget: Element | null) => void;
    onValueChange: (key: string, value: string | number | boolean) => void;
    onToggleChange: (key: string, value: boolean) => void;
    snippets: PromptItem[];
    engineId?: string;
    projectSlug?: string;
    destinationFolder?: string;
    externalValueSyncKey?: number;
}

const BYPASS_PLACEHOLDER_KEY = "__sts_bypass_placeholder__";

const resolveMediaKind = (fieldKey: string, field: Record<string, unknown>) => {
    const explicit = typeof field.x_media_kind === "string" ? field.x_media_kind.toLowerCase() : null;
    if (explicit === "image" || explicit === "video") {
        return explicit;
    }

    const key = fieldKey.toLowerCase();
    const title = String(field.title || "").toLowerCase();
    const classType = String(field.x_class_type || "").toLowerCase();
    if (key.endsWith(".video") && classType.includes("loadvideo")) {
        return "video";
    }
    return "image";
};

const isMediaUploadField = (fieldKey: string, field: Record<string, unknown>) => {
    const key = fieldKey.toLowerCase();
    const title = String(field.title || "").toLowerCase();
    const classType = String(field.x_class_type || "").toLowerCase();
    const isExplicit =
        field.widget === "media_upload" ||
        field.widget === "image_upload" ||
        (field.widget === "upload" && resolveMediaKind(fieldKey, field) === "image");
    const isLoadImage = title.includes("loadimage");
    const isVideoInput = key.endsWith(".video") && classType.includes("loadvideo");
    const isStringLike = field.type === "string" || Array.isArray(field.enum);

    return (isExplicit || isLoadImage || isVideoInput) && isStringLike;
};

const FieldRenderer = React.memo(function FieldRenderer({
    fieldKey,
    field,
    isActive,
    isPromptField,
    dynamicOptions,
    onFieldFocus,
    onFieldBlur,
    onValueChange,
    onToggleChange,
    snippets,
    engineId,
    projectSlug,
    destinationFolder,
    externalValueSyncKey,
}: FieldRendererProps) {
    const value = useAtomValue(formFieldAtom(fieldKey));
    const isMediaUpload = isMediaUploadField(fieldKey, field);

    if (isMediaUpload) {
        const mediaKind = resolveMediaKind(fieldKey, field);

        return (
            <div className="space-y-2">
                <Label>{field.title || fieldKey}</Label>
                <ImageUpload
                    value={value as string | undefined}
                    onChange={(val) => onValueChange(fieldKey, val)}
                    engineId={engineId}
                    options={field.enum}
                    projectSlug={projectSlug}
                    destinationFolder={destinationFolder}
                    mediaKind={mediaKind}
                />
            </div>
        );
    }

    if (field.widget === "textarea") {
        return (
            <div className="space-y-2">
                {/* Only show label for non-prompt textareas; prompt fields get their title from the group header */}
                {!isPromptField && (
                    <Label htmlFor={fieldKey} className={cn(isActive && "text-blue-600 font-semibold")}>{field.title || fieldKey}</Label>
                )}
                {isPromptField ? (
                    <PromptAutocompleteTextarea
                        id={fieldKey}
                        value={typeof value === "string" ? value : ""}
                        onValueChange={(val) => onValueChange(fieldKey, val)}
                        onFocus={() => onFieldFocus?.(fieldKey)}
                        onBlur={(e) => onFieldBlur?.(fieldKey, e.relatedTarget as Element)}
                        placeholder=""
                        isActive={isActive}
                        snippets={snippets}
                        highlightSnippets={true}
                        externalValueSyncKey={externalValueSyncKey}
                    />
                ) : (
                    <Textarea
                        id={fieldKey}
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) => onValueChange(fieldKey, e.target.value)}
                        onFocus={() => onFieldFocus?.(fieldKey)}
                        onBlur={(e) => onFieldBlur?.(fieldKey, e.relatedTarget as Element)}
                        placeholder=""
                        rows={6}
                        className={cn(
                            "text-xs font-mono transition-all min-h-[150px]",
                            isActive && "ring-2 ring-blue-400 border-blue-400 bg-blue-50/20"
                        )}
                    />
                )}
            </div>
        );
    }

    if (field.widget === "toggle") {
        return (
            <div className="flex items-center justify-between py-2">
                <Label htmlFor={fieldKey} className={cn("text-xs text-slate-500", isActive && "text-blue-600 font-semibold")}>
                    {field.title || fieldKey}
                </Label>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 uppercase">{value ? "Bypassed" : "Active"}</span>
                    <Switch
                        checked={!!value}
                        onCheckedChange={(c) => onToggleChange(fieldKey, Boolean(c))}
                        className={cn(value ? "bg-amber-500" : "bg-slate-200")}
                    />
                </div>
            </div>
        );
    }

    // Inline layout for non-prompt fields (label on left)
    const isNumberType = field.type === "integer" || field.type === "number" || field.type === "float";
    const currentVal = String(value ?? "");

    return (
        <div className="flex items-center gap-2 py-0.5">
            <Label htmlFor={fieldKey} className={cn("text-xs text-slate-500 w-24 flex-shrink-0 text-right", isActive && "text-blue-600 font-semibold")}>{field.title || fieldKey}</Label>
            {field.enum || dynamicOptions[fieldKey] ? (
                (() => {
                    const rawOptions = dynamicOptions[fieldKey] || field.enum || [];
                    const options = currentVal && !rawOptions.includes(currentVal)
                        ? [currentVal, ...rawOptions]
                        : rawOptions;

                    return (
                        <Select
                            value={currentVal}
                            onValueChange={(val) => {
                                onValueChange(fieldKey, val);
                            }}
                        >
                            <SelectTrigger id={fieldKey} className={cn("h-7 text-xs flex-1 min-w-0 overflow-hidden", isActive && "ring-1 ring-blue-400 border-blue-400")}>
                                <span className="truncate block w-full text-left">
                                    {currentVal || "Select..."}
                                </span>
                            </SelectTrigger>
                            <SelectContent position="popper" sideOffset={5} className="max-h-[300px] max-w-[320px] overflow-y-auto z-50">
                                {options.map((opt: string) => (
                                    <SelectItem key={opt} value={opt} className="text-xs">
                                        <span className="block truncate max-w-[280px]" title={opt}>
                                            {opt}
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    );
                })()
            ) : (
                <Input
                    id={fieldKey}
                    type="text"
                    inputMode={isNumberType ? "decimal" : "text"}
                    value={currentVal}
                    onChange={(e) => {
                        const val = e.target.value;
                        // For number fields, allow typing raw values including "-", ".", "-."
                        // Don't parse until blur to allow natural typing of negatives and decimals
                        onValueChange(fieldKey, val);
                    }}
                    onBlur={(e) => {
                        // Parse number on blur for number types
                        if (isNumberType) {
                            const val = e.target.value;
                            if (val === "" || val === "-" || val === "." || val === "-.") {
                                // Leave as-is or clear incomplete values
                                return;
                            }
                            const parsed = field.type === "integer" ? parseInt(val) : parseFloat(val);
                            if (!isNaN(parsed)) {
                                onValueChange(fieldKey, parsed);
                            }
                        }
                    }}
                    onFocus={() => onFieldFocus?.(fieldKey)}
                    placeholder=""
                    className={cn("h-7 text-xs flex-1", isActive && "ring-1 ring-blue-400 border-blue-400")}
                    step={field.step || (field.type === "integer" ? 1 : 0.01)}
                    min={field.minimum}
                    max={field.maximum}
                />
            )}
        </div>
    );
});

interface GroupWithBypass {
    id: string;
    title: string;
    keys: string[];
    order: number;
    bypassKey?: string;
    hasBypass: boolean;
}

interface CoreGroupSectionProps {
    group: GroupWithBypass;
    renderField: (key: string) => JSX.Element;
    onToggleChange: (key: string, value: boolean) => void;
    showHeader: boolean;
}

const CoreGroupSection = React.memo(function CoreGroupSection({
    group,
    renderField,
    onToggleChange,
    showHeader,
}: CoreGroupSectionProps) {
    const bypassValue = useAtomValue(formFieldAtom(group.bypassKey ?? BYPASS_PLACEHOLDER_KEY));
    const isBypassed = group.hasBypass && Boolean(bypassValue);
    const fieldsToRender = group.keys.filter(k => k !== group.bypassKey);
    const orderBase = Number.isFinite(group.order) ? group.order : 999;
    const order = isBypassed ? orderBase + 1000 : orderBase;

    return (
        <div key={group.id} className="space-y-2" style={{ order }}>
            {(showHeader || group.hasBypass) && (
                <div className="flex items-center justify-between border-b border-slate-100 pb-1">
                    <h4 className="text-[11px] font-semibold uppercase text-slate-400 tracking-wide flex items-center gap-2">
                        <span>{group.title}</span>
                        {isBypassed && (
                            <span className="text-[9px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                                Bypassed
                            </span>
                        )}
                    </h4>
                    {group.hasBypass && group.bypassKey && (
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] text-slate-300 uppercase  tracking-wider">
                                {isBypassed ? "bypassed" : "active"}
                            </span>
                            <Switch
                                checked={Boolean(bypassValue)}
                                onCheckedChange={(c) => onToggleChange(group.bypassKey!, Boolean(c))}
                                className={cn(
                                    "h-3.5 w-6 data-[state=checked]:bg-amber-500 data-[state=unchecked]:bg-slate-200"
                                )}
                            />
                        </div>
                    )}
                </div>
            )}
            <div className="space-y-3">
                {!isBypassed ? (
                    fieldsToRender.map(renderField)
                ) : (
                    <div className="text-[10px] text-slate-400 italic px-1 opacity-60">
                        Node bypassed. Parameters hidden.
                    </div>
                )}
            </div>
        </div>
    );
});

interface SettingsGroupSectionProps {
    group: GroupWithBypass;
    renderField: (key: string) => JSX.Element;
    onToggleChange: (key: string, value: boolean) => void;
}

const SettingsGroupSection = React.memo(function SettingsGroupSection({
    group,
    renderField,
    onToggleChange,
}: SettingsGroupSectionProps) {
    const bypassValue = useAtomValue(formFieldAtom(group.bypassKey ?? BYPASS_PLACEHOLDER_KEY));
    const isBypassed = group.hasBypass && Boolean(bypassValue);
    const fieldsToRender = group.keys.filter(k => k !== group.bypassKey);
    const orderBase = Number.isFinite(group.order) ? group.order : 999;
    const order = isBypassed ? orderBase + 1000 : orderBase;

    return (
        <AccordionItem
            key={group.id}
            value={group.id}
            className={cn(
                "border rounded-lg px-2 bg-white transition-opacity",
                isBypassed && "opacity-60"
            )}
            style={{ order }}
        >
            <AccordionTrigger
                className="text-xs font-semibold uppercase text-slate-500 hover:no-underline py-2 [&>svg]:ml-auto"
                aria-label={`${group.title} controls (${isBypassed ? "bypassed" : "active"})`}
            >
                <div className="flex flex-1 items-center justify-between" role="button" tabIndex={0}>
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-2">
                            <span>{group.title}</span>
                            {isBypassed && (
                                <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                                    Bypassed
                                </span>
                            )}
                        </span>
                        {group.hasBypass && group.bypassKey && (
                            <div
                                className="flex items-center gap-2"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <span className="text-[9px] text-slate-300 uppercase tracking-wider">
                                    {isBypassed ? "bypassed" : "active"}
                                </span>
                                <Switch
                                    checked={Boolean(bypassValue)}
                                    onCheckedChange={(c) => onToggleChange(group.bypassKey!, Boolean(c))}
                                    className={cn(
                                        "h-3.5 w-6 data-[state=checked]:bg-amber-500 data-[state=unchecked]:bg-slate-200"
                                    )}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-0 pb-4">
                {!isBypassed ? (
                    fieldsToRender.map(renderField)
                ) : (
                    <div className="text-[10px] text-slate-400 italic px-1">
                        Node bypassed. Parameters hidden.
                    </div>
                )}
            </AccordionContent>
        </AccordionItem>
    );
});

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

                            if (inputDef && Array.isArray(inputDef[0])) {
                                // It's an enum!
                                newOptions[key] = inputDef[0];
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

    const defaults = useMemo(() => {
        if (!schema) return {} as Record<string, unknown>;
        const initial: Record<string, unknown> = {};
        Object.keys(schema).forEach((key) => {
            if (schema[key].default !== undefined) {
                initial[key] = schema[key].default;
            }
        });
        return initial;
    }, [schema, nodeOrder]);

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
                // Use same title chain as other nodes: alias > x_title > field.title > fallback
                const groupTitle = field.x_node_alias || field.x_title || field.title || "Media Input";
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
    const strictCoreGroups = useMemo(() => {
        if (!schema) return [] as { id: string; title: string; keys: string[]; order: number }[];

        const groupMap: Record<string, { title: string; keys: string[]; order: number }> = {};

        Array.from(strictCoreKeys).forEach((key) => {
            const field = schema[key];
            const placement = groups.placements[key];
            const nodeId = String(field?.x_node_id || placement?.groupId || "general");
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




    // Re-calculate settingsFields using strictCoreKeys
    const strictSettingsFields = useMemo(() => {
        const promptExtras = groups.prompts.filter((key) => !strictCoreKeys.has(key));
        const loraExtras = groups.loras.filter((key) => !strictCoreKeys.has(key));
        const orderArr = nodeOrder || [];
        const nodeEntries = Object.entries(groups.nodes).map(([id, group]) => {
            const orderIndex = orderArr.indexOf(String(id));
            return {
                id,
                title: group.title,
                order: orderIndex >= 0 ? orderIndex : 999,
                keys: group.keys.filter((key) => !strictCoreKeys.has(key)),
            };
        })
            .filter((group) => group.keys.length > 0)
            .sort((a, b) => a.order - b.order);
        return { promptExtras, loraExtras, nodeEntries };
    }, [groups.loras, groups.nodes, groups.prompts, strictCoreKeys, nodeOrder]);


    const [settingsOpen, setSettingsOpen] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(store.get(formDataAtom));
    };

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

    const renderField = useCallback((key: string) => {
        const field = schema[key];
        const isActive = key === activeField;
        const isPromptField = groups.prompts.includes(key);

        return (
            <FieldRenderer
                key={key}
                fieldKey={key}
                field={field}
                isActive={isActive}
                isPromptField={isPromptField}
                dynamicOptions={dynamicOptions}
                onFieldFocus={onFieldFocus}
                onFieldBlur={onFieldBlur}
                onValueChange={handleChange}
                onToggleChange={handleToggleChange}
                snippets={snippets}
                engineId={engineId}
                projectSlug={projectSlug}
                destinationFolder={destinationFolder}
                externalValueSyncKey={externalValueSyncKey}
            />
        );
    }, [
        activeField,
        destinationFolder,
        dynamicOptions,
        engineId,
        externalValueSyncKey,
        groups.prompts,
        handleChange,
        handleToggleChange,
        onFieldBlur,
        onFieldFocus,
        projectSlug,
        schema,
        snippets
    ]);

    const coreGroups = useMemo(() => {
        return strictCoreGroups.map((group) => ({
            ...group,
            ...getBypassMeta(group),
        }));
    }, [strictCoreGroups, schema]);

    const settingsGroups = useMemo(() => {
        return strictSettingsFields.nodeEntries.map((group) => ({
            ...group,
            ...getBypassMeta(group),
        }));
    }, [strictSettingsFields.nodeEntries, schema]);

    if (!schema) return null;

    return (
        <form onSubmit={handleSubmit} className="space-y-6 pb-20">
            {/* 1. Main Inputs (Images) */}
            {groups.inputs.length > 0 && (
                <div className="space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">input images</h3>
                    <div className="space-y-4">
                        {groups.inputs.map(renderField)}
                    </div>
                </div>
            )}

            <div className="space-y-4 p-4 bg-white rounded-lg border border-slate-200">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">core pipe controls</h3>
                    {onReset && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={onReset}
                            className="h-6 text-[10px] text-slate-400 hover:text-slate-600 px-2"
                        >
                            reset to defaults
                        </Button>
                    )}
                </div>
                {strictCoreGroups.length === 0 ? (
                    <div className="text-xs text-slate-400 italic py-2">
                        No core controls configured. Edit the pipe to add nodes to this section.
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        {coreGroups.map((group) => (
                            <CoreGroupSection
                                key={group.id}
                                group={group}
                                renderField={renderField}
                                onToggleChange={handleToggleChange}
                                showHeader={strictCoreGroups.length > 1}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* 3. Settings - Renamed to EXPANDED CONTROLS */}
            <Accordion
                type="single"
                collapsible
                value={settingsOpen ? "settings" : undefined}
                onValueChange={(val) => setSettingsOpen(Boolean(val))}
                className="w-full"
            >
                <AccordionItem value="settings" className="border rounded-lg px-2 bg-white">
                    <AccordionTrigger className="text-xs font-semibold uppercase text-slate-500 hover:no-underline py-2">
                        EXPANDED CONTROLS
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-0 pb-4">

                        {strictSettingsFields.promptExtras.length > 0 && (
                            <div className="space-y-2">
                                <h4 className="text-[11px] font-semibold uppercase text-slate-500">additional prompts</h4>
                                <div className="space-y-4">
                                    {strictSettingsFields.promptExtras.map(renderField)}
                                </div>
                            </div>
                        )}

                        {strictSettingsFields.nodeEntries.length > 0 && (
                            <Accordion type="multiple" className="w-full flex flex-col gap-2">
                                {settingsGroups.map((group) => (
                                    <SettingsGroupSection
                                        key={group.id}
                                        group={group}
                                        renderField={renderField}
                                        onToggleChange={handleToggleChange}
                                    />
                                ))}
                            </Accordion>
                        )}

                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </form>
    );
});
