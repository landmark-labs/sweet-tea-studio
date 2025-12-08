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
}

export function DynamicForm({
    schema,
    onSubmit,
    isLoading,
    persistenceKey,
    engineId,
    submitLabel = "Generate & Upscale",
    formData: externalData,
    onChange: externalOnChange,
    onFieldFocus,
    onFieldBlur,
    activeField,
    submitDisabled
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
            const nodeId = match ? heuristicTitle : fallbackNodeId;

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
            }
            nodes[placement.groupId].keys.push(key);
        });

        prompts.sort((a, b) => a.order - b.order);

        return { inputs, prompts: prompts.map((prompt) => prompt.key), loras, nodes, placements };
    }, [schema]);

    useEffect(() => {
        if (!schema) return;

        const ambiguous = Object.values(groups.placements).filter(
            (placement) =>
                placement.source === "heuristic" &&
                (placement.groupId === "default" || placement.reason === "fallback_configuration")
        );

        if (!ambiguous.length) return;

        sendTelemetryEvent("dynamic_form.grouping_signal", {
            engineId,
            persistenceKey,
            fields: ambiguous.map((placement) => ({
                key: placement.key,
                groupId: placement.groupId,
                groupTitle: placement.groupTitle,
                reason: placement.reason,
                widget: schema[placement.key]?.widget,
                title: schema[placement.key]?.title,
                nodeId: schema[placement.key]?.x_node_id,
                classType: schema[placement.key]?.x_class_type
            }))
        });
    }, [engineId, groups.placements, persistenceKey, schema]);

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
                            onCheckedChange={(c) => handleChange(key, c)}
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

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(formData);
    };

    if (!schema) return null;

    return (
        <form onSubmit={handleSubmit} className="space-y-6 pb-20">
            {/* 1. Main Inputs (Images) */}
            {groups.inputs.length > 0 && (
                <div className="space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Input Images</h3>
                    <div className="space-y-4">
                        {groups.inputs.map(renderField)}
                    </div>
                </div>
            )}

            {/* 2. Prompts */}
            {groups.prompts.length > 0 && (
                <div className="space-y-4">
                    {groups.prompts.map(renderField)}
                </div>
            )}

            {/* 3. LoRAs */}
            {groups.loras.length > 0 && (
                <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="loras" className="border rounded-lg px-2 bg-white">
                        <AccordionTrigger className="text-xs font-semibold uppercase text-slate-500 hover:no-underline py-2">LoRA Models</AccordionTrigger>
                        <AccordionContent className="space-y-4 pt-0 pb-4">
                            {groups.loras.map(renderField)}
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            )}

            {/* 4. Advanced/Node Groups */}
            <Accordion type="multiple" defaultValue={["Configuration", "default"]} className="w-full space-y-2">
                {Object.entries(groups.nodes)
                    .sort(([, a], [, b]) => a.order - b.order)
                    .map(([id, group]) => (
                        <AccordionItem key={id} value={id} className="border rounded-lg px-2 bg-white">
                            <AccordionTrigger className="text-xs font-semibold uppercase text-slate-500 hover:no-underline py-2">
                                {group.title}
                            </AccordionTrigger>
                            <AccordionContent className="space-y-4 pt-0 pb-4">
                                {group.keys.map(renderField)}
                            </AccordionContent>
                        </AccordionItem>
                    ))}
            </Accordion>

            <Button type="submit" disabled={isLoading || submitDisabled} className="w-full bg-slate-900 hover:bg-slate-800 text-white shadow-lg transition-all hover:scale-[1.02]">
                {isLoading ? "Generating..." : submitLabel}
            </Button>
        </form>
    );
}
