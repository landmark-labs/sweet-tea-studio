import * as React from "react"
import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
    HTMLButtonElement,
    React.ComponentPropsWithoutRef<"button"> & { checked?: boolean; onCheckedChange?: (checked: boolean) => void }
>(({ className, checked, onCheckedChange, ...props }, ref) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        data-state={checked ? "checked" : "unchecked"}
        className={cn(
            "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:bg-primary data-[state=unchecked]:bg-secondary",
            className
        )}
        onClick={() => onCheckedChange?.(!checked)}
        ref={ref}
        {...props}
    >
        <span
            data-state={checked ? "checked" : "unchecked"}
            className={cn(
                "pointer-events-none block h-4 w-4 rounded-full shadow-sm ring-1 ring-border/60 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5 data-[state=checked]:bg-primary-foreground data-[state=unchecked]:bg-foreground"
            )}
        />
    </button>
))
Switch.displayName = "Switch"

export { Switch }
