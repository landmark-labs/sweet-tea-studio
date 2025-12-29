import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageUpload } from "@/components/ImageUpload";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { PromptAutocompleteTextarea } from "@/components/PromptAutocompleteTextarea";
import { api } from "@/lib/api";
import { PromptItem } from "@/lib/types";
import { formDataAtom, formFieldAtom, setFormDataAtom } from "@/lib/atoms/formAtoms";
import { ChevronDown, ChevronUp, Pin } from "lucide-react";

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
    mediaVariant?: "default" | "compact";
    hideLabel?: boolean;
}

const BYPASS_PLACEHOLDER_KEY = "__sts_bypass_placeholder__";
const NODE_HOVER_OPEN_DELAY = 150;
const NODE_HOVER_CLOSE_DELAY = 220;

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

const resolveNodeTitle = (field: Record<string, unknown>, fallback = "Configuration") => {
    const alias = typeof field.x_node_alias === "string" ? field.x_node_alias.trim() : "";
    if (alias) return alias;

    const explicit = typeof field.x_title === "string" ? field.x_title.trim() : "";
    if (explicit) return explicit;

    const title = String(field.title || "").trim();
    const match = title.match(/\(([^)]+)\)\s*$/);
    if (match && match[1]) return match[1];

    const classType = String(field.x_class_type || "").trim();
    if (classType) return classType;

    return title || fallback;
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
    mediaVariant = "default",
    hideLabel = false,
}: FieldRendererProps) {
    const value = useAtomValue(formFieldAtom(fieldKey));
    const isMediaUpload = isMediaUploadField(fieldKey, field);

    if (isMediaUpload) {
        const mediaKind = resolveMediaKind(fieldKey, field);

        return (
            <div className="space-y-2">
                {!hideLabel && <Label>{field.title || fieldKey}</Label>}
                <ImageUpload
                    value={value as string | undefined}
                    onChange={(val) => onValueChange(fieldKey, val)}
                    engineId={engineId}
                    options={field.enum}
                    projectSlug={projectSlug}
                    destinationFolder={destinationFolder}
                    mediaKind={mediaKind}
                    compact={mediaVariant === "compact"}
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
                        showAutocompleteToggle={false}
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

interface NodePromptGroupProps {
    group: GroupWithBypass;
    promptKeys: string[];
    nonPromptKeys: string[];
    isExpanded: boolean;
    onToggleExpanded: () => void;
    renderField: (key: string) => JSX.Element;
    onToggleChange: (key: string, value: boolean) => void;
}

const NodePromptGroup = React.memo(function NodePromptGroup({
    group,
    promptKeys,
    nonPromptKeys,
    isExpanded,
    onToggleExpanded,
    renderField,
    onToggleChange,
}: NodePromptGroupProps) {
    const bypassValue = useAtomValue(formFieldAtom(group.bypassKey ?? BYPASS_PLACEHOLDER_KEY));
    const isBypassed = group.hasBypass && Boolean(bypassValue);

    return (
        <div
            className={cn(
                "rounded-lg border bg-white p-3 space-y-3 shadow-sm transition-opacity",
                isBypassed && "opacity-60"
            )}
            data-node-inline
            data-node-prompt
            data-node-id={group.id}
            data-node-title={group.title}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase text-slate-500 tracking-wide">
                        {group.title}
                    </span>
                    {isBypassed && (
                        <span className="text-[9px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                            Bypassed
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {group.hasBypass && group.bypassKey && (
                        <div className="flex items-center gap-2">
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
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-slate-400 hover:text-slate-700"
                        onClick={onToggleExpanded}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? "Collapse prompts" : "Expand prompts"}
                    >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                </div>
            </div>
            {!isBypassed ? (
                <div className="space-y-3">
                    {nonPromptKeys.map(renderField)}
                    {isExpanded ? (
                        promptKeys.map(renderField)
                    ) : (
                        <div className="text-[10px] text-slate-400 italic px-1">
                            Prompts hidden. Expand to edit.
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-[10px] text-slate-400 italic px-1">
                    Node bypassed. Parameters hidden.
                </div>
            )}
        </div>
    );
});

interface NodeMediaGroupProps {
    group: GroupWithBypass;
    mediaKeys: string[];
    nonMediaKeys: string[];
    isExpanded: boolean;
    onToggleExpanded: () => void;
    renderField: (key: string) => JSX.Element;
    renderMediaField: (key: string, variant: "default" | "compact", hideLabel: boolean) => JSX.Element;
    onToggleChange: (key: string, value: boolean) => void;
}

const NodeMediaGroup = React.memo(function NodeMediaGroup({
    group,
    mediaKeys,
    nonMediaKeys,
    isExpanded,
    onToggleExpanded,
    renderField,
    renderMediaField,
    onToggleChange,
}: NodeMediaGroupProps) {
    const bypassValue = useAtomValue(formFieldAtom(group.bypassKey ?? BYPASS_PLACEHOLDER_KEY));
    const isBypassed = group.hasBypass && Boolean(bypassValue);

    return (
        <div
            className={cn(
                "rounded-lg border bg-white p-3 space-y-3 shadow-sm transition-opacity",
                isBypassed && "opacity-60"
            )}
            data-node-inline
            data-node-media
            data-node-id={group.id}
            data-node-title={group.title}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase text-slate-500 tracking-wide">
                        {group.title}
                    </span>
                    {isBypassed && (
                        <span className="text-[9px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                            Bypassed
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {group.hasBypass && group.bypassKey && (
                        <div className="flex items-center gap-2">
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
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-slate-400 hover:text-slate-700"
                        onClick={onToggleExpanded}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? "Collapse media settings" : "Expand media settings"}
                    >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                </div>
            </div>
            {!isBypassed ? (
                <div className="space-y-3">
                    {mediaKeys.map((key) => renderMediaField(key, isExpanded ? "default" : "compact", mediaKeys.length === 1 && nonMediaKeys.length === 0))}
                    {isExpanded && nonMediaKeys.length > 0 && (
                        <div className="space-y-3 pt-1">
                            {nonMediaKeys.map(renderField)}
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-[10px] text-slate-400 italic px-1">
                    Node bypassed. Parameters hidden.
                </div>
            )}
        </div>
    );
});

interface PinnedInspectorPanelProps {
    group: GroupWithBypass;
    scopeLabel: string;
    onUnpin: () => void;
    renderField: (key: string) => JSX.Element;
    onToggleChange: (key: string, value: boolean) => void;
    maxPanelHeight?: number;
}

const PinnedInspectorPanel = React.memo(function PinnedInspectorPanel({
    group,
    scopeLabel,
    onUnpin,
    renderField,
    onToggleChange,
    maxPanelHeight,
}: PinnedInspectorPanelProps) {
    const bypassValue = useAtomValue(formFieldAtom(group.bypassKey ?? BYPASS_PLACEHOLDER_KEY));
    const isBypassed = group.hasBypass && Boolean(bypassValue);
    const fieldsToRender = group.keys.filter(k => k !== group.bypassKey);

    return (
        <div
            className="rounded-lg border bg-white/95 shadow-lg backdrop-blur p-3 flex flex-col"
            style={{ maxHeight: maxPanelHeight ?? "70vh" }}
        >
            <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                        pinned inspector - {scopeLabel}
                    </div>
                    <div className="text-sm font-semibold text-slate-800 truncate">{group.title}</div>
                </div>
                <div className="flex items-center gap-2">
                    {group.hasBypass && group.bypassKey && (
                        <div className="flex items-center gap-2">
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
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-blue-600 hover:text-blue-700"
                        title="Unpin inspector"
                        onClick={onUnpin}
                    >
                        <Pin className="w-4 h-4" />
                    </Button>
                </div>
            </div>
            {!isBypassed ? (
                <div className="space-y-3 overflow-y-auto pr-1 min-h-0 flex-1 pb-1">
                    {fieldsToRender.length > 0 ? (
                        fieldsToRender.map(renderField)
                    ) : (
                        <div className="text-[10px] text-slate-400 italic px-1">
                            No parameters exposed for this node.
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-[10px] text-slate-400 italic px-1">
                    Node bypassed. Parameters hidden.
                </div>
            )}
        </div>
    );
});

interface NodeStackRowProps {
    group: GroupWithBypass;
    stackId: string;
    isOpen: boolean;
    isPinned: boolean;
    onHoverOpen: () => void;
    onFocusOpen: () => void;
    onHoverClose: () => void;
    onHoldOpen: () => void;
    onCloseImmediate: () => void;
    onTogglePin: () => void;
    renderField: (key: string) => JSX.Element;
    onToggleChange: (key: string, value: boolean) => void;
}

const NodeStackRow = React.memo(function NodeStackRow({
    group,
    stackId,
    isOpen,
    isPinned,
    onHoverOpen,
    onFocusOpen,
    onHoverClose,
    onHoldOpen,
    onCloseImmediate,
    onTogglePin,
    renderField,
    onToggleChange,
}: NodeStackRowProps) {
    const bypassValue = useAtomValue(formFieldAtom(group.bypassKey ?? BYPASS_PLACEHOLDER_KEY));
    const isBypassed = group.hasBypass && Boolean(bypassValue);
    const fieldsToRender = group.keys.filter(k => k !== group.bypassKey);
    const paramCount = fieldsToRender.length;
    const rowRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const shouldShowPopover = isOpen && !isPinned;

    const focusWithin = (target: Element | null) => {
        if (!target) return false;
        return Boolean(rowRef.current?.contains(target) || contentRef.current?.contains(target));
    };

    return (
        <Popover
            open={shouldShowPopover}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && !isPinned) {
                    onCloseImmediate();
                }
            }}
        >
            <PopoverAnchor asChild>
                <div
                    ref={rowRef}
                    className={cn(
                        "flex items-center justify-between rounded-lg border bg-white px-3 py-2 shadow-sm transition-colors",
                        isBypassed && "opacity-60",
                        isOpen && "border-blue-200 ring-1 ring-blue-100"
                    )}
                    data-node-stack-item
                    data-node-stack-id={stackId}
                    data-node-id={group.id}
                    data-node-title={group.title}
                    tabIndex={0}
                    role="button"
                    aria-haspopup="dialog"
                    aria-expanded={isOpen}
                    onPointerEnter={onHoverOpen}
                    onPointerLeave={onHoverClose}
                    onFocus={onFocusOpen}
                    onBlur={(e) => {
                        if (isPinned) return;
                        if (focusWithin(e.relatedTarget as Element | null)) return;
                        onHoverClose();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onTogglePin();
                        }
                    }}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-slate-700 truncate">{group.title}</span>
                        {paramCount > 0 && (
                            <span className="text-[10px] text-slate-400">
                                {paramCount} params
                            </span>
                        )}
                        {isBypassed && (
                            <span className="text-[9px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                                Bypassed
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {group.hasBypass && group.bypassKey && (
                            <div className="flex items-center gap-2">
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
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "h-7 w-7 text-slate-400 hover:text-slate-700",
                                isPinned && "text-blue-600"
                            )}
                            title={isPinned ? "Unpin inspector" : "Pin inspector"}
                            onClick={(e) => {
                                e.stopPropagation();
                                onTogglePin();
                            }}
                        >
                            <Pin className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            </PopoverAnchor>
            <PopoverContent
                ref={contentRef}
                side="right"
                align="start"
                sideOffset={12}
                className="w-[360px] max-h-[70vh] overflow-y-auto p-3 shadow-xl border-slate-200"
                onPointerEnter={onHoldOpen}
                onPointerLeave={onHoverClose}
                onFocusCapture={onHoldOpen}
                onBlurCapture={(e) => {
                    if (isPinned) return;
                    if (focusWithin(e.relatedTarget as Element | null)) return;
                    onHoverClose();
                }}
                onOpenAutoFocus={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => e.preventDefault()}
            >
                <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-semibold uppercase text-slate-500 tracking-wide">
                        {group.title}
                    </div>
                    <div className="flex items-center gap-2">
                        {group.hasBypass && group.bypassKey && (
                            <div className="flex items-center gap-2">
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
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "h-7 w-7 text-slate-400 hover:text-slate-700",
                                isPinned && "text-blue-600"
                            )}
                            title={isPinned ? "Unpin inspector" : "Pin inspector"}
                            onClick={(e) => {
                                e.stopPropagation();
                                onTogglePin();
                            }}
                        >
                            <Pin className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
                {!isBypassed ? (
                    <div className="space-y-3">
                        {paramCount > 0 ? (
                            fieldsToRender.map(renderField)
                        ) : (
                            <div className="text-[10px] text-slate-400 italic px-1">
                                No parameters exposed for this node.
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-[10px] text-slate-400 italic px-1">
                        Node bypassed. Parameters hidden.
                    </div>
                )}
            </PopoverContent>
        </Popover>
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

        const groupMap: Record<string, { id: string; title: string; keys: string[]; order: number }> = {};

        Object.keys(schema).forEach((key) => {
            if (strictCoreKeys.has(key)) return;
            const placement = groups.placements[key];
            if (!placement) return;
            if (placement.section === "inputs" && placement.source === "annotation") return;

            const groupId = String(placement.groupId || "default");
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

    const [activeStackId, setActiveStackId] = useState<string | null>(null);
    const [pinnedStackId, setPinnedStackId] = useState<string | null>(null);
    const openStackId = pinnedStackId ?? activeStackId;
    const hoverOpenTimerRef = useRef<NodeJS.Timeout | null>(null);
    const hoverCloseTimerRef = useRef<NodeJS.Timeout | null>(null);
    const [mediaExpanded, setMediaExpanded] = useState<Record<string, boolean>>({});
    const [promptExpanded, setPromptExpanded] = useState<Record<string, boolean>>({});
    const [pinnedPosition, setPinnedPosition] = useState<{
        top: number;
        left: number;
        maxPanelHeight: number;
    } | null>(null);
    const formRef = useRef<HTMLFormElement | null>(null);

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

    const requestOpenNode = useCallback((id: string, immediate = false) => {
        if (pinnedStackId && pinnedStackId !== id) return;
        clearHoverTimers();
        if (immediate) {
            setActiveStackId(id);
            return;
        }
        hoverOpenTimerRef.current = setTimeout(() => {
            setActiveStackId(id);
        }, NODE_HOVER_OPEN_DELAY);
    }, [clearHoverTimers, pinnedStackId]);

    const requestCloseNode = useCallback((id: string) => {
        if (pinnedStackId) return;
        clearHoverTimers();
        hoverCloseTimerRef.current = setTimeout(() => {
            setActiveStackId((current) => (current === id ? null : current));
        }, NODE_HOVER_CLOSE_DELAY);
    }, [clearHoverTimers, pinnedStackId]);

    const closeNodeImmediate = useCallback((id: string) => {
        if (pinnedStackId && pinnedStackId === id) return;
        clearHoverTimers();
        setActiveStackId((current) => (current === id ? null : current));
    }, [clearHoverTimers, pinnedStackId]);

    const holdNodeOpen = useCallback(() => {
        if (hoverCloseTimerRef.current) {
            clearTimeout(hoverCloseTimerRef.current);
            hoverCloseTimerRef.current = null;
        }
    }, []);

    const togglePinnedNode = useCallback((id: string) => {
        clearHoverTimers();
        setPinnedStackId((current) => {
            const next = current === id ? null : id;
            setActiveStackId(next ? id : null);
            return next;
        });
    }, [clearHoverTimers]);

    const unpinStack = useCallback(() => {
        clearHoverTimers();
        setPinnedStackId(null);
        setActiveStackId(null);
    }, [clearHoverTimers]);

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
        setPinnedStackId(null);
        setMediaExpanded({});
        setPromptExpanded({});
    }, [schema]);

    useEffect(() => {
        if (!openStackId) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                clearHoverTimers();
                setActiveStackId(null);
                setPinnedStackId(null);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [clearHoverTimers, openStackId]);

    useEffect(() => {
        return () => clearHoverTimers();
    }, [clearHoverTimers]);

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

    const renderMediaField = useCallback((key: string, mediaVariant: "default" | "compact", hideLabel: boolean) => {
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
                mediaVariant={mediaVariant}
                hideLabel={hideLabel}
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

    const pinnedGroupInfo = useMemo(() => {
        if (!pinnedStackId) return null;
        const [scope, id] = pinnedStackId.split(":");
        const list = scope === "core" ? coreGroups : stackGroupsWithMeta;
        const group = list.find((entry) => entry.id === id);
        if (!group) return null;
        return {
            group,
            scopeLabel: scope === "core" ? "core controls" : "expanded controls",
        };
    }, [coreGroups, pinnedStackId, stackGroupsWithMeta]);

    useEffect(() => {
        if (!pinnedGroupInfo) {
            setPinnedPosition(null);
            return;
        }

        const container = formRef.current?.parentElement || (document.querySelector("[data-configurator-scroll]") as HTMLElement | null);
        if (!container) {
            setPinnedPosition(null);
            return;
        }

        const panelWidth = 360;
        const minPanelHeight = 420;
        const updatePosition = () => {
            const rect = container.getBoundingClientRect();
            const fallbackLeft = rect.right + 12;
            const maxLeft = window.innerWidth - panelWidth - 12;
            const left = Math.max(12, Math.min(fallbackLeft, maxLeft));
            const preferredTop = rect.top + rect.height * 0.55;
            const maxTop = window.innerHeight - minPanelHeight - 12;
            const top = Math.max(rect.top + 12, Math.min(preferredTop, maxTop));
            const maxPanelHeight = Math.max(minPanelHeight, window.innerHeight - top - 24);
            setPinnedPosition({ top, left, maxPanelHeight });
        };

        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [pinnedGroupInfo]);

    if (!schema) return null;

    return (
        <form onSubmit={handleSubmit} className="space-y-6 pb-20">
            {pinnedGroupInfo && pinnedPosition && createPortal(
                <div
                    className="pointer-events-none z-50"
                    style={{ position: "fixed", top: pinnedPosition.top, left: pinnedPosition.left, width: 360 }}
                >
                    <div className="pointer-events-auto">
                        <PinnedInspectorPanel
                            group={pinnedGroupInfo.group}
                            scopeLabel={pinnedGroupInfo.scopeLabel}
                            onUnpin={unpinStack}
                            renderField={renderField}
                            onToggleChange={handleToggleChange}
                            maxPanelHeight={pinnedPosition.maxPanelHeight}
                        />
                    </div>
                </div>,
                document.body
            )}
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
                    <div className="flex flex-col gap-3" data-core-stack>
                        {coreGroups.map((group) => {
                            const stackId = `core:${group.id}`;
                            const contentKeys = group.keys.filter((key) => key !== group.bypassKey);
                            const mediaKeys = contentKeys.filter((key) => isMediaUploadField(key, schema[key]));
                            const nonMediaKeys = contentKeys.filter((key) => !isMediaUploadField(key, schema[key]));
                            const promptKeys = contentKeys.filter((key) => promptKeySet.has(key));
                            const nonPromptKeys = contentKeys.filter((key) => !promptKeySet.has(key));
                            const hasPromptField = promptKeys.length > 0;
                            const hasMediaField = mediaKeys.length > 0;
                            const isOpen = openStackId === stackId;
                            const isPinned = pinnedStackId === stackId;

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
                                    isPinned={isPinned}
                                    onHoverOpen={() => requestOpenNode(stackId)}
                                    onFocusOpen={() => requestOpenNode(stackId, true)}
                                    onHoverClose={() => requestCloseNode(stackId)}
                                    onHoldOpen={holdNodeOpen}
                                    onCloseImmediate={() => closeNodeImmediate(stackId)}
                                    onTogglePin={() => togglePinnedNode(stackId)}
                                    renderField={renderField}
                                    onToggleChange={handleToggleChange}
                                />
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="space-y-3 p-4 bg-white rounded-lg border border-slate-200">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">EXPANDED CONTROLS</h3>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">hover a node to edit</span>
                </div>
                {stackGroupsWithMeta.length === 0 ? (
                    <div className="text-xs text-slate-400 italic py-1">
                        No expanded controls configured.
                    </div>
                ) : (
                    <div className="flex flex-col gap-2" data-expanded-stack>
                        {stackGroupsWithMeta.map((group) => {
                            const stackId = `expanded:${group.id}`;
                            const contentKeys = group.keys.filter((key) => key !== group.bypassKey);
                            const mediaKeys = contentKeys.filter((key) => isMediaUploadField(key, schema[key]));
                            const nonMediaKeys = contentKeys.filter((key) => !isMediaUploadField(key, schema[key]));
                            const promptKeys = contentKeys.filter((key) => promptKeySet.has(key));
                            const nonPromptKeys = contentKeys.filter((key) => !promptKeySet.has(key));
                            const hasPromptField = promptKeys.length > 0;
                            const hasMediaField = mediaKeys.length > 0;
                            const isOpen = openStackId === stackId;
                            const isPinned = pinnedStackId === stackId;

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
                                    isPinned={isPinned}
                                    onHoverOpen={() => requestOpenNode(stackId)}
                                    onFocusOpen={() => requestOpenNode(stackId, true)}
                                    onHoverClose={() => requestCloseNode(stackId)}
                                    onHoldOpen={holdNodeOpen}
                                    onCloseImmediate={() => closeNodeImmediate(stackId)}
                                    onTogglePin={() => togglePinnedNode(stackId)}
                                    renderField={renderField}
                                    onToggleChange={handleToggleChange}
                                />
                            );
                        })}
                    </div>
                )}
            </div>
        </form>
    );
});
