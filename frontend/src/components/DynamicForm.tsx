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
    activeField
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
    const groups = useMemo(() => {
        if (!schema) return { inputs: [], prompts: [], loras: [], nodes: {} };

        const inputs: string[] = [];
        const prompts: string[] = [];
        const loras: string[] = [];
        const nodes: Record<string, { title: string, keys: string[], order: number }> = {};

        Object.keys(schema).forEach((key) => {
            const field = schema[key];
            const isImageUpload = field.widget === "upload" || field.widget === "image_upload" || (field.title && field.title.includes("LoadImage"));

            if (isImageUpload) {
                inputs.push(key);
                return;
            }

            const isStrictPrompt = field.x_class_type && (
                field.x_class_type.includes("CLIPTextEncode") ||
                field.x_class_type.includes("String Literal") ||
                field.x_class_type.includes("SimpleWildcards")
            );

            if (field.widget === "textarea" && isStrictPrompt) {
                prompts.push(key);
                return;
            }

            if (field.x_class_type === "LoraLoader" || (field.title && field.title.includes("LoraLoader"))) {
                loras.push(key);
                return;
            }

            let nodeId = field.x_node_id;
            let groupTitle = field.x_title;

            if (!nodeId) {
                nodeId = "default";
                groupTitle = "Configuration";
                const match = field.title?.match(/\((.+)\)$/);
                if (match) {
                    groupTitle = match[1];
                    nodeId = groupTitle;
                }
            }

            if (!nodes[nodeId]) {
                nodes[nodeId] = {
                    title: groupTitle || "Advanced",
                    keys: [],
                    order: parseInt(nodeId) || 999
                };
            }
            nodes[nodeId].keys.push(key);
        });

        prompts.sort((a, b) => {
            const nodeA = parseInt(schema[a].x_node_id || "0");
            const nodeB = parseInt(schema[b].x_node_id || "0");
            return nodeA - nodeB;
        });

        return { inputs, prompts, loras, nodes };
    }, [schema]);

    const renderField = (key: string) => {
        const field = schema[key];
        const isImageUpload = field.widget === "upload" || field.widget === "image_upload" || (field.title && field.title.includes("LoadImage"));
        const isActive = key === activeField;

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

            <Button type="submit" disabled={isLoading} className="w-full bg-slate-900 hover:bg-slate-800 text-white shadow-lg transition-all hover:scale-[1.02]">
                {isLoading ? "Generating..." : submitLabel}
            </Button>
        </form>
    );
}
