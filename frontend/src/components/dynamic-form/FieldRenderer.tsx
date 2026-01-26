import React from "react";
import { useAtomValue } from "jotai";
import { Palette } from "lucide-react";
import { ImageUpload } from "@/components/ImageUpload";
import { PromptAutocompleteTextarea } from "@/components/PromptAutocompleteTextarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formFieldAtom } from "@/lib/atoms/formAtoms";
import { formatFloatDisplay } from "@/lib/formatters";
import type { PromptItem, PromptRehydrationItemV1 } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isMediaUploadField, resolveMediaKind, resolveParamTitle } from "./fieldUtils";

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

export const FieldRenderer = React.memo(function FieldRenderer({
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
            // Allow natural typing for numeric fields; parse on blur.
            onValueChange(fieldKey, val);
          }}
          onBlur={(e) => {
            if (isNumberType) {
              const val = e.target.value;
              if (val === "" || val === "-" || val === "." || val === "-.") {
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
