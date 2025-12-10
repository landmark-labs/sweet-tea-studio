import React, { useState, useEffect, useMemo } from "react";
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
import { sendTelemetryEvent } from "@/lib/telemetry";
import { labels } from "@/ui/labels";

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

interface DynamicFormProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSubmit: (data: any) => void;
    isLoading?: boolean;
    persistenceKey?: string;
    engineId?: string;
    submitLabel?: string;
    // specific controlled props
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    formData?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onChange?: (data: any) => void;
    onFieldFocus?: (key: string) => void;
    onFieldBlur?: (key: string, relatedTarget: Element | null) => void;
    activeField?: string;
    submitDisabled?: boolean;
    onReset?: () => void;
}

export function DynamicForm({
    schema,
    onSubmit,
    isLoading,
    persistenceKey,
    engineId,
    submitLabel = "run pipe",
    formData: externalData,
    onChange: externalOnChange,
    onFieldFocus,
    onFieldBlur,
    activeField,
    submitDisabled,
    onReset
}: DynamicFormProps) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [internalData, setInternalData] = useState<any>({});

    const isControlled = externalData !== undefined;
    const formData = isControlled ? externalData : internalData;

    // Initialize defaults or load from storage
    useEffect(() => {
        if (schema && !isControlled) {
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

            setInternalData({ ...defaults, ...(storedData || {}) });
        }
    }, [schema, persistenceKey, isControlled]);

    const defaults = useMemo(() => {
        if (!schema) return {} as Record<string, unknown>;
        const initial: Record<string, unknown> = {};
        Object.keys(schema).forEach((key) => {
            if (schema[key].default !== undefined) {
                initial[key] = schema[key].default;
            }
        });
        return initial;
    }, [schema]);

    const handleChange = (key: string, value: string | number | boolean) => {
        const next = { ...formData, [key]: value };

        if (persistenceKey) {
            localStorage.setItem(persistenceKey, JSON.stringify(next));
        }

        if (isControlled) {
            externalOnChange?.(next);
        } else {
            setInternalData(next);
        }
    };

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

        const parseOrder = (value?: string | number, fallback = 999) => {
            if (typeof value === "number") return value;
            const parsed = parseInt(value || "");
            return Number.isFinite(parsed) ? parsed : fallback;
        };

        const resolvePlacement = (key: string): PlacementMeta => {
            const field = schema[key];
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
                    order: parseOrder(annotations.order ?? field.x_node_id),
                    source: "annotation",
                    reason: "explicit_annotation"
                };
            }

            const isImageUpload = field.widget === "upload" || field.widget === "image_upload" || (field.title && field.title.includes("LoadImage"));
            if (isImageUpload) {
                return {
                    key,
                    section: "inputs",
                    groupId: "inputs",
                    groupTitle: field.title || "Input Images",
                    order: parseOrder(field.x_node_id, 0),
                    source: "heuristic",
                    reason: "image_upload"
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
                    order: parseOrder(field.x_node_id, 0),
                    source: "heuristic",
                    reason: "prompt_textarea"
                };
            }

            if (field.x_class_type === "LoraLoader" || (field.title && field.title.includes("LoraLoader"))) {
                return {
                    key,
                    section: "loras",
                    groupId: "loras",
                    groupTitle: field.title || "LoRA",
                    order: parseOrder(field.x_node_id, 0),
                    source: "heuristic",
                    reason: "lora_loader"
                };
            }

            const fallbackNodeId = field.x_node_id || "default";
            const fallbackGroupTitle = field.x_title || field.title || "Configuration";
            const match = field.title?.match(/\((.+)\)$/);
            const heuristicTitle = match ? match[1] : fallbackGroupTitle;
            // Always prefer the clean x_node_id for grouping stability if available
            const nodeId = field.x_node_id ? String(field.x_node_id) : (match ? heuristicTitle : fallbackNodeId);

            return {
                key,
                section: "nodes",
                groupId: nodeId,
                groupTitle: heuristicTitle,
                order: parseOrder(field.x_node_id),
                source: "heuristic",
                reason: match ? "title_annotation_match" : "fallback_configuration"
            };
        };

        Object.keys(schema).forEach((key) => {
            const placement = resolvePlacement(key);
            placements[key] = placement;

            if (placement.section === "inputs") {
                inputs.push(key);
                return;
            }

            if (placement.section === "prompts") {
                prompts.push(placement);
                return;
            }

            if (placement.section === "loras") {
                loras.push(key);
                return;
            }

            if (!nodes[placement.groupId]) {
                nodes[placement.groupId] = {
                    title: placement.groupTitle || "Advanced",
                    keys: [],
                    order: placement.order ?? 999
                };
            } else if (nodes[placement.groupId].title.startsWith("Bypass") && !placement.groupTitle.startsWith("Bypass")) {
                // Upgrade title if we found a better one (e.g. preventing "Bypass..." from being the group title)
                nodes[placement.groupId].title = placement.groupTitle;
            }
            nodes[placement.groupId].keys.push(key);
        });

        prompts.sort((a, b) => a.order - b.order);

        return { inputs, prompts: prompts.map((prompt) => prompt.key), loras, nodes, placements };
    }, [schema]);

    const { topLevelFields, nodeFieldsGroup } = useMemo(() => {
        const top = [] as string[];
        if (!schema) return { topLevelFields: [], nodeFieldsGroup: [] };

        // Define STRICT core fields that should stay at the top
        const coreKeywords = ["resolution", "width", "height", "checkpoint", "denoise", "refiner"];

        // Helper to check if a field is "core"
        const isCore = (key: string) => {
            const lower = key.toLowerCase();
            const title = (schema[key]?.title || "").toLowerCase();
            return coreKeywords.some(kw => lower.includes(kw) || title.includes(kw));
        };

        const allKeys = Object.keys(schema);
        const core = allKeys.filter((key) => !groups.inputs.includes(key));

        core.forEach(key => {
            if (isCore(key)) {
                top.push(key);
            }
        });

        return { topLevelFields: top, nodeFieldsGroup: [] };
    }, [groups.inputs, schema]);

    // Redefine primaryKeys to ONLY include the strict core ones, so others fall into node groups
    const strictCoreKeys = useMemo(() => {
        if (!schema) return new Set<string>();
        const keywords = [
            "resolution", "width", "height", "checkpoint", "refiner", "denoise"
        ];
        // We do NOT include seed, steps, cfg, sampler, scheduler here, so they appear in node groups
        const matches = Object.keys(schema).filter((key) => {
            const field = schema[key];
            const title = String(field.title || key).toLowerCase();
            return keywords.some((kw) => title.includes(kw));
        });

        // Add the first 2 prompts to core keys so they appear at the top
        const corePrompts = groups.prompts.slice(0, 2);

        return new Set([...matches, ...corePrompts]);
    }, [schema, groups.prompts]);

    // Group core keys by node ID for proper visual organization
    const strictCoreGroups = useMemo(() => {
        if (!schema) return [] as { id: string; title: string; keys: string[]; order: number }[];

        const groupMap: Record<string, { title: string; keys: string[]; order: number }> = {};

        Array.from(strictCoreKeys).forEach((key) => {
            const field = schema[key];
            const placement = groups.placements[key];
            const nodeId = placement?.groupId || field?.x_node_id || "general";
            const nodeTitle = placement?.groupTitle || field?.x_title || "General";
            const order = placement?.order ?? 999;

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
    }, [schema, strictCoreKeys, groups.placements]);

    // Re-calculate settingsFields using strictCoreKeys
    const strictSettingsFields = useMemo(() => {
        const promptExtras = groups.prompts.filter((key) => !strictCoreKeys.has(key));
        const loraExtras = groups.loras.filter((key) => !strictCoreKeys.has(key));
        const nodeEntries = Object.entries(groups.nodes).map(([id, group]) => ({
            id,
            title: group.title,
            order: group.order,
            keys: group.keys.filter((key) => !strictCoreKeys.has(key)),
        })).filter((group) => group.keys.length > 0);
        return { promptExtras, loraExtras, nodeEntries };
    }, [groups.loras, groups.nodes, groups.prompts, strictCoreKeys]);

    // Check customization based on strict fields
    const isStrictSettingsCustomized = useMemo(() => {
        const fieldsToCheck = [
            ...strictSettingsFields.promptExtras,
            ...strictSettingsFields.loraExtras,
            ...strictSettingsFields.nodeEntries.flatMap((g) => g.keys),
        ];

        return fieldsToCheck.some((key) => {
            if (!(key in formData)) return false;
            return formData[key] !== defaults[key];
        });
    }, [defaults, formData, strictSettingsFields]);


    const [settingsOpen, setSettingsOpen] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(formData);
    };

    const renderField = (key: string) => {
        const field = schema[key];
        const isImageUpload = field.widget === "upload" || field.widget === "image_upload" || (field.title && field.title.includes("LoadImage"));
        const isActive = key === activeField;
        const isPromptField = groups.prompts.includes(key);

        if (isImageUpload) {
            return (
                <div key={key} className="space-y-2">
                    <Label htmlFor={key}>{field.title || key}</Label>
                    <ImageUpload
                        value={formData[key]}
                        onChange={(val) => handleChange(key, val)}
                        engineId={engineId}
                        options={field.enum}
                    />
                </div>
            );
        }

        if (field.widget === "textarea") {
            return (
                <div key={key} className="space-y-2">
                    <Label htmlFor={key} className={cn(isActive && "text-blue-600 font-semibold")}>{field.title || key}</Label>
                    {isPromptField ? (
                        <PromptAutocompleteTextarea
                            id={key}
                            value={formData[key] || ""}
                            onValueChange={(val) => handleChange(key, val)}
                            onFocus={() => onFieldFocus?.(key)}
                            onBlur={(e) => onFieldBlur?.(key, e.relatedTarget as Element)}
                            placeholder=""
                            isActive={isActive}
                        />
                    ) : (
                        <Textarea
                            id={key}
                            value={formData[key] || ""}
                            onChange={(e) => handleChange(key, e.target.value)}
                            onFocus={() => onFieldFocus?.(key)}
                            onBlur={(e) => onFieldBlur?.(key, e.relatedTarget as Element)}
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
                <div key={key} className="flex items-center justify-between py-2">
                    <Label htmlFor={key} className={cn("text-xs text-slate-500", isActive && "text-blue-600 font-semibold")}>
                        {field.title || key}
                    </Label>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 uppercase">{formData[key] ? "Bypassed" : "Active"}</span>
                        <Switch
                            checked={!!formData[key]}
                            onCheckedChange={(c) => {
                                // If enabling bypass, auto-fill any empty required enum fields in the same group
                                // This prevents "Value not in list" errors from ComfyUI validation
                                let updates: Record<string, any> = { [key]: c };

                                if (c === true) {
                                    const placement = groups.placements[key];
                                    if (placement && placement.groupId) {
                                        const groupKeys = groups.nodes[placement.groupId]?.keys || [];
                                        groupKeys.forEach(siblingKey => {
                                            if (siblingKey === key) return;
                                            const siblingField = schema[siblingKey];
                                            const currentValue = formData[siblingKey];

                                            // Check if it's an enum field and currently empty
                                            if (siblingField?.enum && Array.isArray(siblingField.enum) && siblingField.enum.length > 0) {
                                                if (currentValue === "" || currentValue === undefined || currentValue === null) {
                                                    updates[siblingKey] = siblingField.enum[0];
                                                }
                                            }
                                        });
                                    }
                                }

                                const next = { ...formData, ...updates };
                                if (persistenceKey) localStorage.setItem(persistenceKey, JSON.stringify(next));
                                if (isControlled) externalOnChange?.(next);
                                else setInternalData(next);
                            }}
                            className={cn(formData[key] ? "bg-amber-500" : "bg-slate-200")}
                        />
                    </div>
                </div>
            );
        }

        return (
            <div key={key} className="space-y-2">
                <Label htmlFor={key} className={cn("text-xs text-slate-500", isActive && "text-blue-600 font-semibold")}>{field.title || key}</Label>
                {field.enum ? (
                    <Select
                        value={String(formData[key] || "")}
                        onValueChange={(val) => handleChange(key, val)}
                    >
                        <SelectTrigger id={key} className={cn("h-8 text-xs", isActive && "ring-1 ring-blue-400 border-blue-400")}>
                            <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent position="popper" sideOffset={5} className="max-h-[300px] overflow-y-auto z-50">
                            {field.enum.map((opt: string) => (
                                <SelectItem key={opt} value={opt} className="text-xs">
                                    {opt}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : (
                    <Input
                        id={key}
                        type={field.type === "integer" || field.type === "number" ? "number" : "text"}
                        value={formData[key] || ""}
                        onChange={(e) => handleChange(key, field.type === "integer" ? parseInt(e.target.value) : field.type === "number" ? parseFloat(e.target.value) : e.target.value)}
                        onFocus={() => onFieldFocus?.(key)}
                        placeholder=""
                        className={cn("h-8 text-xs", isActive && "ring-1 ring-blue-400 border-blue-400")}
                        step={field.step || (field.type === "integer" ? 1 : 0.01)}
                        min={field.minimum}
                        max={field.maximum}
                    />
                )}
            </div>
        );
    };

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

            {strictCoreGroups.length > 0 && (
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
                    <div className="space-y-4">
                        {strictCoreGroups.map((group) => {
                            // Detect bypass field
                            let bypassKey = group.keys.find(k => {
                                const f = schema[k];
                                return f.widget === "toggle" && (
                                    (f.title && f.title.toLowerCase().startsWith("bypass")) ||
                                    k.toLowerCase().includes("bypass")
                                );
                            });

                            const hasBypass = !!bypassKey;
                            const isBypassed = hasBypass && formData[bypassKey!];
                            const fieldsToRender = group.keys.filter(k => k !== bypassKey);

                            return (
                                <div key={group.id} className="space-y-2">
                                    {/* Always show header if multiple groups OR if we have a bypass toggle */}
                                    {(strictCoreGroups.length > 1 || hasBypass) && (
                                        <div className="flex items-center justify-between border-b border-slate-100 pb-1">
                                            <h4 className="text-[11px] font-semibold uppercase text-slate-400 tracking-wide">
                                                {group.title}
                                            </h4>
                                            {hasBypass && (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[9px] text-slate-300 uppercase  tracking-wider">
                                                        {isBypassed ? "bypassed" : "active"}
                                                    </span>
                                                    <Switch
                                                        checked={!!formData[bypassKey!]}
                                                        onCheckedChange={(c) => handleChange(bypassKey!, c)}
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
                        })}
                    </div>
                </div>
            )}

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
                        {isStrictSettingsCustomized ? "EXPANDED CONTROLS (CUSTOMIZED)" : "EXPANDED CONTROLS"}
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

                        {strictSettingsFields.loraExtras.length > 0 && (
                            <div className="space-y-2">
                                <h4 className="text-[11px] font-semibold uppercase text-slate-500">loras</h4>
                                <div className="space-y-4">
                                    {strictSettingsFields.loraExtras.map(renderField)}
                                </div>
                            </div>
                        )}

                        {strictSettingsFields.nodeEntries.length > 0 && (
                            <Accordion type="multiple" className="w-full space-y-2">
                                {strictSettingsFields.nodeEntries
                                    .sort((a, b) => a.order - b.order)
                                    .map((group) => {
                                        // Detect bypass field
                                        let bypassKey = group.keys.find(k => {
                                            const f = schema[k];
                                            return f.widget === "toggle" && (
                                                (f.title && f.title.toLowerCase().startsWith("bypass")) ||
                                                k.toLowerCase().includes("bypass")
                                            );
                                        });

                                        // Fallback to strict ID check
                                        if (!bypassKey) {
                                            const strictKey = `__bypass_${group.id}`;
                                            if (schema && strictKey in schema) bypassKey = strictKey;
                                        }

                                        const hasBypass = !!bypassKey;
                                        const isBypassed = hasBypass && formData[bypassKey!];

                                        // Filter out bypass key from rendered fields
                                        const fieldsToRender = group.keys.filter(k => k !== bypassKey);

                                        return (
                                            <AccordionItem
                                                key={group.id}
                                                value={group.id}
                                                className={cn(
                                                    "border rounded-lg px-2 bg-white transition-opacity",
                                                    isBypassed && "opacity-60"
                                                )}
                                            >
                                                <AccordionTrigger className="text-xs font-semibold uppercase text-slate-500 hover:no-underline py-2 [&>svg]:ml-auto">
                                                    <div className="flex items-center gap-3">
                                                        <span>{group.title}</span>
                                                        {hasBypass && (
                                                            <div
                                                                className="flex items-center gap-2"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <span className="text-[9px] text-slate-300 uppercase tracking-wider">
                                                                    {isBypassed ? "bypassed" : "active"}
                                                                </span>
                                                                <Switch
                                                                    checked={!!formData[bypassKey!]}
                                                                    onCheckedChange={(c) => handleChange(bypassKey!, c)}
                                                                    className={cn(
                                                                        "h-3.5 w-6 data-[state=checked]:bg-amber-500 data-[state=unchecked]:bg-slate-200"
                                                                    )}
                                                                />
                                                            </div>
                                                        )}
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
                                    })}
                            </Accordion>
                        )}

                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </form>
    );
}
