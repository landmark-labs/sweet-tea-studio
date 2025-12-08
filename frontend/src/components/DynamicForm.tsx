import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageUpload } from "@/components/ImageUpload";

interface DynamicFormProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSubmit: (data: any) => void;
    isLoading?: boolean;
    persistenceKey?: string;
    engineId?: string;
}

export function DynamicForm({ schema, onSubmit, isLoading, persistenceKey, engineId }: DynamicFormProps) {
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

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(formData);
    };

    if (!schema) return <div className="text-gray-500">No parameters available</div>;

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {Object.keys(schema).map((key) => {
                const field = schema[key];

                if (field.widget === "upload") {
                    return (
                        <div key={key} className="space-y-2">
                            <Label htmlFor={key}>{field.title || key}</Label>
                            <ImageUpload
                                value={formData[key]}
                                onChange={(val) => handleChange(key, val)}
                                engineId={engineId}
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
                                rows={4}
                            />
                        </div>
                    );
                }

                return (
                    <div key={key} className="space-y-2">
                        <Label htmlFor={key}>{field.title || key}</Label>
                        {field.enum ? (
                            <Select
                                value={String(formData[key] || "")}
                                onValueChange={(val) => handleChange(key, val)}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder={field.default ? String(field.default) : "Select..."} />
                                </SelectTrigger>
                                <SelectContent>
                                    {field.enum.map((opt: string) => (
                                        <SelectItem key={opt} value={opt}>
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
                            />
                        )}
                    </div>
                );
            })}
            <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? "Generating..." : "Generate & Upscale"}
            </Button>
        </form>
    );
}
