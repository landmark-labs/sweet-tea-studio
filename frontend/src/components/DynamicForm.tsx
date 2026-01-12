import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { Button } from "@/components/ui/button";
import { DraggablePanel } from "@/components/ui/draggable-panel";
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
import type { PromptItem, PromptRehydrationSnapshotV1, PromptRehydrationItemV1 } from "@/lib/types";
import { formDataAtom, formFieldAtom, setFormDataAtom } from "@/lib/atoms/formAtoms";
import { formatFloatDisplay } from "@/lib/formatters";
import { ChevronDown, ChevronUp, Palette, Pin, X } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSeparator, ContextMenuLabel } from "@/components/ui/context-menu";

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
    rehydrationItems?: PromptRehydrationItemV1[];
    rehydrationKey?: number;
    engineId?: string;
    projectSlug?: string;
    destinationFolder?: string;
    externalValueSyncKey?: number;
    mediaVariant?: "default" | "compact";
    hideLabel?: boolean;
    onMenuOpen?: (isOpen: boolean) => void;
    showPaletteToggle?: boolean;
    paletteSelected?: boolean;
    onPaletteToggle?: () => void;
    endAction?: React.ReactNode;
    variant?: "default" | "palette";
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

const resolveParamTitle = (fieldKey: string, field: Record<string, unknown>) => {
    const raw = String(field.title || fieldKey).trim();
    const match = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (!match) return raw;
    const base = (match[1] || "").trim();
    return base || raw;
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
    rehydrationItems,
    rehydrationKey,
    engineId,
    projectSlug,
    destinationFolder,
    externalValueSyncKey,
    mediaVariant = "default",
    hideLabel = false,
    onMenuOpen,
    showPaletteToggle = false,
    paletteSelected = false,
    onPaletteToggle,
    endAction,
    variant = "default",
}: FieldRendererProps) {
    const value = useAtomValue(formFieldAtom(fieldKey));
    const isMediaUpload = isMediaUploadField(fieldKey, field);
    const isPaletteVariant = variant === "palette";
    const fieldTitle = resolveParamTitle(fieldKey, field);

    const labelClassName = cn(
        isPaletteVariant ? "text-[9px] font-semibold text-violet-700 dark:text-foreground/90" : "text-xs text-foreground/80",
        isActive && (isPaletteVariant ? "text-violet-800 dark:text-foreground" : "text-blue-600 dark:text-primary font-semibold")
    );

    const controlClassName = cn(
        "flex-1 min-w-0",
        isPaletteVariant ? "h-6 text-[10px] bg-white/80 dark:bg-surface border-violet-200/60 dark:border-yellow-400" : "h-7 text-xs",
        isActive && "ring-1 ring-violet-400 border-violet-400 dark:ring-blue-400 dark:border-blue-400"
    );

    const paletteButton = showPaletteToggle && onPaletteToggle ? (
        <button
            type="button"
            className={cn(
                "h-5 w-5 rounded-md border flex items-center justify-center transition-colors",
                paletteSelected
                    ? "bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100 dark:bg-primary/15 dark:border-primary/30 dark:text-primary dark:hover:bg-primary/20"
                    : "bg-muted/30 border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
            title={paletteSelected ? "Remove from palette" : "Add to palette"}
            aria-label={paletteSelected ? "Remove from palette" : "Add to palette"}
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPaletteToggle();
            }}
        >
            <Palette className="h-3 w-3" />
        </button>
    ) : null;

    const wrapWithEndAction = (content: JSX.Element) => {
        if (!endAction) return content;
        const placeAtTop = isMediaUpload || field.widget === "textarea";
        return (
            <div className={cn("relative", isPaletteVariant ? "pr-5" : "pr-7")}>
                {content}
                <div
                    className={cn(
                        "absolute right-0",
                        placeAtTop ? "top-0.5" : "top-1/2 -translate-y-1/2"
                    )}
                >
                    {endAction}
                </div>
            </div>
        );
    };

    if (isMediaUpload) {
        const mediaKind = resolveMediaKind(fieldKey, field);

        return wrapWithEndAction(
            <div className="space-y-2">
                {!hideLabel && (
                    <div className="flex items-center gap-2">
                        {paletteButton}
                        <Label className={labelClassName}>{fieldTitle}</Label>
                    </div>
                )}
                {hideLabel && paletteButton && (
                    <div className="flex items-center gap-2">
                        {paletteButton}
                        <span className={cn("text-[10px] text-muted-foreground", isPaletteVariant && "text-violet-600 dark:text-foreground/80")}>{fieldTitle}</span>
                    </div>
                )}
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
        const canRehydrate = Boolean(rehydrationItems && rehydrationItems.length > 0);
        const shouldUsePromptEditor = Boolean(isPromptField || canRehydrate);
        const shouldShowLabelRow = !isPromptField || Boolean(paletteButton);
        return wrapWithEndAction(
            <div className="space-y-2">
                {shouldShowLabelRow && (
                    <div className="flex items-center gap-2">
                        {paletteButton}
                        <Label
                            htmlFor={fieldKey}
                            className={labelClassName}
                        >
                            {fieldTitle}
                        </Label>
                    </div>
                )}
                {shouldUsePromptEditor ? (
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
                        rehydrationItems={rehydrationItems}
                        rehydrationKey={rehydrationKey}
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
                            isPaletteVariant ? "text-[10px] font-mono transition-all min-h-[110px]" : "text-xs font-mono transition-all min-h-[150px]",
                            isActive && "ring-2 ring-blue-400 border-blue-400 bg-blue-50/20 dark:ring-ring dark:border-ring dark:bg-primary/10"
                        )}
                    />
                )}
            </div>
        );
    }

    if (field.widget === "toggle") {
        return wrapWithEndAction(
            <div className={cn("flex items-center justify-between", isPaletteVariant ? "py-1" : "py-2")}>
                <div className="flex items-center gap-2 min-w-0">
                    {paletteButton}
                    <Label
                        htmlFor={fieldKey}
                        className={cn(
                            "truncate",
                            labelClassName
                        )}
                    >
                        {fieldTitle}
                    </Label>
                </div>
                <div className="flex items-center gap-2">
                    <span className={cn("text-[10px] uppercase", isPaletteVariant ? "text-violet-600/80 dark:text-foreground/70" : "text-foreground/70")}>{value ? "Bypassed" : "Active"}</span>
                    <Switch
                        checked={!!value}
                        onCheckedChange={(c) => onToggleChange(fieldKey, Boolean(c))}
                        className={cn(value ? "bg-amber-500" : "bg-muted")}
                    />
                </div>
            </div>
        );
    }

    // Inline layout for non-prompt fields (label on left)
    const isNumberType = field.type === "integer" || field.type === "number" || field.type === "float";
    const rawVal = String(value ?? "");
    const currentVal = isNumberType ? formatFloatDisplay(rawVal) : rawVal;

    return wrapWithEndAction(
        <div className={cn("flex items-center", isPaletteVariant ? "py-0 gap-1" : "py-0.5 gap-2")}>
            <div className={cn("flex items-center gap-1 flex-shrink-0 min-w-0", isPaletteVariant ? "justify-start w-8" : "justify-end w-28")}>
                {paletteButton}
                <Label htmlFor={fieldKey} className={cn(isPaletteVariant ? "text-left" : "text-right", "truncate", labelClassName)}>
                    {fieldTitle}
                </Label>
            </div>
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
                            onOpenChange={onMenuOpen}
                        >
                            <SelectTrigger id={fieldKey} className={cn(controlClassName, "overflow-hidden")}>
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
                    className={controlClassName}
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
                "rounded-lg border bg-card p-3 space-y-3 shadow-sm transition-opacity",
                isBypassed && "opacity-60"
            )}
            data-node-inline
            data-node-prompt
            data-node-id={group.id}
            data-node-title={group.title}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wide">
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
                            <Switch
                                checked={Boolean(bypassValue)}
                                onCheckedChange={(c) => onToggleChange(group.bypassKey!, Boolean(c))}
                                className={cn(
                                    "h-3.5 w-6 data-[state=checked]:bg-amber-500 data-[state=unchecked]:bg-muted"
                                )}
                            />
                        </div>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
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
                        <div className="text-[10px] text-muted-foreground italic px-1">
                            Prompts hidden. Expand to edit.
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-[10px] text-muted-foreground italic px-1">
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
                "rounded-lg border bg-card p-3 space-y-3 shadow-sm transition-opacity",
                isBypassed && "opacity-60"
            )}
            data-node-inline
            data-node-media
            data-node-id={group.id}
            data-node-title={group.title}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wide">
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
                            <Switch
                                checked={Boolean(bypassValue)}
                                onCheckedChange={(c) => onToggleChange(group.bypassKey!, Boolean(c))}
                                className={cn(
                                    "h-3.5 w-6 data-[state=checked]:bg-amber-500 data-[state=unchecked]:bg-muted"
                                )}
                            />
                        </div>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
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
                <div className="text-[10px] text-muted-foreground italic px-1">
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
    allOnPalette: boolean;
    onHoverOpen: () => void;
    onFocusOpen: () => void;
    onHoverClose: () => void;
    onHoldOpen: () => void;
    onCloseImmediate: () => void;
    onTogglePaletteAll: () => void;
    renderField: (key: string) => JSX.Element;
    onToggleChange: (key: string, value: boolean) => void;
}

const NodeStackRow = React.memo(function NodeStackRow({
    group,
    stackId,
    isOpen,
    allOnPalette,
    onHoverOpen,
    onFocusOpen,
    onHoverClose,
    onHoldOpen,
    onCloseImmediate,
    onTogglePaletteAll,
    renderField,
    onToggleChange,
}: NodeStackRowProps) {
    const bypassValue = useAtomValue(formFieldAtom(group.bypassKey ?? BYPASS_PLACEHOLDER_KEY));
    const isBypassed = group.hasBypass && Boolean(bypassValue);
    const fieldsToRender = group.keys.filter(k => k !== group.bypassKey);
    const paramCount = fieldsToRender.length;
    const rowRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const shouldShowPopover = isOpen;

    const focusWithin = (target: Element | null) => {
        if (!target) return false;
        return Boolean(rowRef.current?.contains(target) || contentRef.current?.contains(target));
    };

    return (
        <Popover
            open={shouldShowPopover}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    onCloseImmediate();
                }
            }}
        >
            <PopoverAnchor asChild>
                <div
                    ref={rowRef}
                    className={cn(
                        "flex items-center justify-between rounded-lg border bg-card px-3 py-2 shadow-sm transition-colors",
                        isBypassed && "opacity-60",
                        isOpen && "border-blue-200 ring-1 ring-blue-100 dark:border-primary/40 dark:ring-primary/20"
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
                    onClick={onFocusOpen}
                    onFocus={onFocusOpen}
                    onBlur={(e) => {
                        if (focusWithin(e.relatedTarget as Element | null)) return;
                        onHoverClose();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onFocusOpen();
                        }
                    }}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-foreground/80 truncate">{group.title}</span>
                        {paramCount > 0 && (
                            <span className="text-[9px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                                {paramCount} params
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {group.hasBypass && group.bypassKey && (
                            <div className="flex items-center gap-2">
                                {isBypassed && (
                                    <span className="text-[9px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                                        Bypassed
                                    </span>
                                )}
                                <Switch
                                    checked={Boolean(bypassValue)}
                                    onCheckedChange={(c) => onToggleChange(group.bypassKey!, Boolean(c))}
                                    className={cn(
                                        "h-3.5 w-6 data-[state=checked]:bg-amber-500 data-[state=unchecked]:bg-muted"
                                    )}
                                />
                            </div>
                        )}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "h-7 w-7 text-muted-foreground hover:text-foreground",
                                allOnPalette && "text-blue-600"
                            )}
                            title={allOnPalette ? "Remove all from palette" : "Add all to palette"}
                            onClick={(e) => {
                                e.stopPropagation();
                                onTogglePaletteAll();
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
                className="w-[360px] max-h-[70vh] overflow-y-auto p-3 shadow-xl border-border/60"
                onPointerEnter={onHoldOpen}
                onPointerLeave={onHoverClose}
                onFocusCapture={onHoldOpen}
                onBlurCapture={(e) => {
                    if (focusWithin(e.relatedTarget as Element | null)) return;
                    onHoverClose();
                }}
                onOpenAutoFocus={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => e.preventDefault()}
            >
                <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wide">
                        {group.title}
                    </div>
                    <div className="flex items-center gap-2">
                        {group.hasBypass && group.bypassKey && (
                            <div className="flex items-center gap-2">
                                <Switch
                                    checked={Boolean(bypassValue)}
                                    onCheckedChange={(c) => onToggleChange(group.bypassKey!, Boolean(c))}
                                    className={cn(
                                        "h-3.5 w-6 data-[state=checked]:bg-amber-500 data-[state=unchecked]:bg-muted"
                                    )}
                                />
                            </div>
                        )}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "h-7 w-7 text-muted-foreground hover:text-foreground",
                                allOnPalette && "text-blue-600"
                            )}
                            title={allOnPalette ? "Remove all from palette" : "Add all to palette"}
                            onClick={(e) => {
                                e.stopPropagation();
                                onTogglePaletteAll();
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
                            <div className="text-[10px] text-muted-foreground italic px-1">
                                No parameters exposed for this node.
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-[10px] text-muted-foreground italic px-1">
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

    useEffect(() => {
        setPaletteHydrated(false);
        if (!paletteStorageKey) {
            setPaletteKeys([]);
            setPaletteHydrated(true);
            return;
        }
        try {
            const raw = localStorage.getItem(paletteStorageKey);
            if (!raw) {
                setPaletteKeys([]);
                setPaletteHydrated(true);
                return;
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                setPaletteKeys([]);
                setPaletteHydrated(true);
                return;
            }
            const next = parsed.filter((entry) => typeof entry === "string") as string[];
            setPaletteKeys(Array.from(new Set(next)));
        } catch (err) {
            console.warn("[palette] Failed to load palette contents", err);
            setPaletteKeys([]);
        } finally {
            setPaletteHydrated(true);
        }
    }, [paletteStorageKey, paletteSyncKey]);

    useEffect(() => {
        if (!schema || !paletteHydrated) return;
        if (Object.keys(schema).length === 0) return;
        setPaletteKeys((current) => current.filter((key) => key in schema));
    }, [paletteHydrated, schema]);

    useEffect(() => {
        if (!paletteStorageKey || !paletteHydrated) return;
        localStorage.setItem(paletteStorageKey, JSON.stringify(paletteKeys));
    }, [paletteHydrated, paletteKeys, paletteStorageKey]);

    const togglePaletteKey = useCallback((key: string) => {
        setPaletteKeys((current) => {
            const next = current.includes(key)
                ? current.filter((entry) => entry !== key)
                : [...current, key];
            if (paletteStorageKey && paletteHydrated) {
                localStorage.setItem(paletteStorageKey, JSON.stringify(next));
            }
            return next;
        });
    }, [paletteHydrated, paletteStorageKey]);

    const togglePaletteKeys = useCallback((keys: string[]) => {
        if (keys.length === 0) return;
        setPaletteKeys((current) => {
            const currentSet = new Set(current);
            const allSelected = keys.every((key) => currentSet.has(key));
            if (allSelected) {
                const removeSet = new Set(keys);
                const next = current.filter((key) => !removeSet.has(key));
                if (paletteStorageKey && paletteHydrated) {
                    localStorage.setItem(paletteStorageKey, JSON.stringify(next));
                }
                return next;
            }
            const next = [...current];
            keys.forEach((key) => {
                if (currentSet.has(key)) return;
                currentSet.add(key);
                next.push(key);
            });
            if (paletteStorageKey && paletteHydrated) {
                localStorage.setItem(paletteStorageKey, JSON.stringify(next));
            }
            return next;
        });
    }, [paletteHydrated, paletteStorageKey]);

    const removePaletteKeys = useCallback((keys: string[]) => {
        if (keys.length === 0) return;
        const removeSet = new Set(keys);
        setPaletteKeys((current) => {
            const next = current.filter((key) => !removeSet.has(key));
            if (paletteStorageKey && paletteHydrated) {
                localStorage.setItem(paletteStorageKey, JSON.stringify(next));
            }
            return next;
        });
    }, [paletteHydrated, paletteStorageKey]);

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
                    <div className="shadow-2xl border border-violet-200/60 bg-gradient-to-br from-white via-violet-50/30 to-fuchsia-50/40 dark:border-blue-500 dark:bg-surface/95 dark:from-surface dark:via-surface dark:to-surface ring-1 ring-violet-200/30 dark:ring-blue-500/30 backdrop-blur-md overflow-hidden rounded-xl w-80 max-w-[320px] text-[11px] text-foreground transition-shadow hover:shadow-violet-200/40">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-violet-100/50 bg-gradient-to-r from-violet-100/40 via-fuchsia-100/30 to-violet-100/40 dark:border-border/70 dark:bg-surface-raised/70 dark:from-surface-raised/70 dark:via-surface-raised/70 dark:to-surface-raised/70 cursor-move">
                            <div className="flex items-center gap-2">
                                <div className="p-1 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-sm">
                                    <Palette className="w-3 h-3 text-white" />
                                </div>
                                <span className="text-xs font-semibold bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent dark:text-foreground">palette</span>
                                {paletteKeys.length > 0 && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 font-semibold dark:bg-muted dark:text-muted-foreground">
                                        {paletteKeys.length}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5">
                                {onPaletteClose && (
                                    <button
                                        type="button"
                                        onClick={onPaletteClose}
                                        className="p-1 rounded-md hover:bg-violet-100/60 text-violet-400 hover:text-violet-600 transition-colors dark:hover:bg-muted/40 dark:text-muted-foreground dark:hover:text-foreground"
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
                                <div className="text-[10px] text-violet-500/80 dark:text-muted-foreground text-center py-4 px-2">
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
                                                    className="break-inside-avoid mb-1.5 border border-violet-200/50 hover:border-violet-300/70 dark:border-blue-500/70 dark:hover:border-blue-400 rounded-lg bg-gradient-to-br from-white to-violet-50/50 dark:from-surface-raised/50 dark:to-surface-raised/50 shadow-sm hover:shadow-md transition-all duration-200 cursor-default"
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
                    <h3 className="text-xs font-bold text-foreground tracking-wider font-['Space_Grotesk']">CORE PIPE CONTROLS</h3>
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
                    <h3 className="text-xs font-bold text-foreground tracking-wider font-['Space_Grotesk']">EXPANDED CONTROLS</h3>
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
