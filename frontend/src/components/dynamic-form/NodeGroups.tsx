import React, { useRef } from "react";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronUp, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { formFieldAtom } from "@/lib/atoms/formAtoms";
import { cn } from "@/lib/utils";
import { BYPASS_PLACEHOLDER_KEY } from "./constants";
import type { GroupWithBypass } from "./types";

interface NodePromptGroupProps {
  group: GroupWithBypass;
  promptKeys: string[];
  nonPromptKeys: string[];
  isExpanded: boolean;
  onToggleExpanded: () => void;
  renderField: (key: string) => React.ReactElement;
  onToggleChange: (key: string, value: boolean) => void;
}

export const NodePromptGroup = React.memo(function NodePromptGroup({
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
  renderField: (key: string) => React.ReactElement;
  renderMediaField: (key: string, variant: "default" | "compact", hideLabel: boolean) => React.ReactElement;
  onToggleChange: (key: string, value: boolean) => void;
}

export const NodeMediaGroup = React.memo(function NodeMediaGroup({
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
  renderField: (key: string) => React.ReactElement;
  onToggleChange: (key: string, value: boolean) => void;
}

export const NodeStackRow = React.memo(function NodeStackRow({
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
