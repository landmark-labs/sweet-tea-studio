import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageUpload } from "@/components/ImageUpload";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
}

export function DynamicForm({ schema, onSubmit, isLoading, persistenceKey, engineId, submitLabel = "Generate & Upscale" }: DynamicFormProps) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [formData, setFormData] = useState<any>({});

    // Initialize defaults or load from storage
    useEffect(() => {
        if (schema) {
            // Check storage first
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

            // Merge defaults with stored data (stored takes precedence)
            setFormData({ ...defaults, ...(storedData || {}) });
        }
    }, [schema, persistenceKey]);

    const handleChange = (key: string, value: string | number) => {
        setFormData((prev: any) => {
            const next = { ...prev, [key]: value };
            if (persistenceKey) {
                localStorage.setItem(persistenceKey, JSON.stringify(next));
            }
            return next;
        });
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

            // 1. Inputs (LoadImage)
            if (isImageUpload) {
                inputs.push(key);
                return;
            }

            // 2. Prompts (Textarea) - Only group strict "Prompt" nodes (CLIPTextEncode, String Literal)
            // Other textareas (filenames, complex logic) should stay with their node.
            const isStrictPrompt = field.x_class_type && (
                field.x_class_type.includes("CLIPTextEncode") ||
                field.x_class_type.includes("String Literal") ||
                field.x_class_type.includes("SimpleWildcards") // Common one
            );

            if (field.widget === "textarea" && isStrictPrompt) {
                prompts.push(key);
                return;
            }

            // 3. LoRAs
            if (field.x_class_type === "LoraLoader" || (field.title && field.title.includes("LoraLoader"))) {
                loras.push(key);
                return;
            }

            // 4. Group by Node
            // Use x_node_id or title prefix fallback or "Advanced"
            let nodeId = field.x_node_id;
            let groupTitle = field.x_title;

            // Fallback for legacy schemas without x_ metadata
            if (!nodeId) {
                // Heuristic: "seed (KSampler)" -> extract "KSampler" or full grouping
                // Just group by explicit group title if we had one, or generic "Configuration"
                nodeId = "default";
                groupTitle = "Configuration";

                // Try to extract from title
                const match = field.title?.match(/\((.+)\)$/);
                if (match) {
                    groupTitle = match[1];
                    nodeId = groupTitle; // Use title as ID for grouping
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

        // Sort prompts by Node ID order if possible
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
                    <Label htmlFor={key}>{field.title || key}</Label>
                    <Textarea
                        id={key}
                        value={formData[key] || ""}
                        onChange={(e) => handleChange(key, e.target.value)}
                        placeholder={field.default ? String(field.default) : ""}
                        rows={3}
                        className="text-xs font-mono"
                    />
                </div>
            );
        }

        return (
            <div key={key} className="space-y-2">
                <Label htmlFor={key} className="text-xs text-slate-500">{field.title || key}</Label>
                {field.enum ? (
                    <Select
                        value={String(formData[key] || "")}
                        onValueChange={(val) => handleChange(key, val)}
                    >
                        <SelectTrigger className="w-full h-8 text-xs">
                            <SelectValue placeholder={field.default ? String(field.default) : "Select..."} />
                        </SelectTrigger>
                        <SelectContent>
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
                        type={field.type === "integer" ? "number" : "text"}
                        value={formData[key] || ""}
                        onChange={(e) =>
                            handleChange(
                                key,
                                field.type === "integer"
                                    ? parseInt(e.target.value) || 0
                                    : e.target.value
                            )
                        }
                        placeholder={field.default ? String(field.default) : ""}
                        className="h-8 text-xs"
                    />
                )}
            </div>
        );
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(formData);
    };

    if (!schema) return <div className="text-gray-500">No parameters available</div>;

    const sortedNodeIds = Object.keys(groups.nodes).sort((a, b) => groups.nodes[a].order - groups.nodes[b].order);

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* 1. Global Inputs (Images) */}
            {groups.inputs.length > 0 && (
                <div className="space-y-4 p-1">
                    {groups.inputs.map(renderField)}
                </div>
            )}

            <Accordion type="multiple" collapsible className="w-full" defaultValue={["prompts", "loras"]}>
                {/* 2. Prompts */}
                {groups.prompts.length > 0 && (
                    <AccordionItem value="prompts">
                        <AccordionTrigger className="text-sm font-semibold hover:no-underline">Prompts & Text</AccordionTrigger>
                        <AccordionContent className="space-y-4 pt-2 px-1">
                            {groups.prompts.map(renderField)}
                        </AccordionContent>
                    </AccordionItem>
                )}

                {/* 3. LoRAs */}
                {groups.loras.length > 0 && (
                    <AccordionItem value="loras">
                        <AccordionTrigger className="text-sm font-semibold hover:no-underline">LoRA Models</AccordionTrigger>
                        <AccordionContent className="space-y-4 pt-2 px-1">
                            {/* Group by node title for LoRAs if we want, but flat list is fine per user request "solution for LoRAs" */}
                            {groups.loras.map(renderField)}
                        </AccordionContent>
                    </AccordionItem>
                )}

                {/* 4. Advanced Nodes */}
                {sortedNodeIds.map(nodeId => {
                    const group = groups.nodes[nodeId];
                    return (
                        <AccordionItem value={`node-${nodeId}`} key={nodeId}>
                            <AccordionTrigger className="text-sm font-semibold hover:no-underline text-slate-600">
                                {group.title}
                            </AccordionTrigger>
                            <AccordionContent className="space-y-3 pt-2 px-1 border-l-2 ml-1 pl-3 border-slate-100">
                                {group.keys.map(renderField)}
                            </AccordionContent>
                        </AccordionItem>
                    )
                })}
            </Accordion>

            <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? "Generating..." : submitLabel}
            </Button>
        </form>
    );
}
