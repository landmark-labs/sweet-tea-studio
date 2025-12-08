import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronDown, Check } from "lucide-react"

const SelectContext = React.createContext<{
    value: string
    onValueChange: (value: string) => void
    open: boolean
    setOpen: (open: boolean) => void
    placeholder: React.ReactNode
    setPlaceholder: (placeholder: React.ReactNode) => void
    label: React.ReactNode
    setLabel: (label: React.ReactNode) => void
} | null>(null)

const Select = ({
    children,
    value,
    onValueChange,
}: {
    children: React.ReactNode
    value: string
    onValueChange: (value: string) => void
}) => {
    const [open, setOpen] = React.useState(false)
    const [placeholder, setPlaceholder] = React.useState<React.ReactNode>("")
    const [label, setLabel] = React.useState<React.ReactNode>("")

    return (
        <SelectContext.Provider
            value={{
                value,
                onValueChange,
                open,
                setOpen,
                placeholder,
                setPlaceholder,
                label,
                setLabel,
            }}
        >
            <div className="relative">{children}</div>
        </SelectContext.Provider>
    )
}

const SelectTrigger = React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    if (!context) throw new Error("SelectTrigger must be used within Select")

    return (
        <button
            ref={ref}
            onClick={() => context.setOpen(!context.open)}
            className={cn(
                "flex h-10 w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                className
            )}
            type="button"
            {...props}
        >
            {children}
            <ChevronDown className="h-4 w-4 opacity-50" />
        </button>
    )
})
SelectTrigger.displayName = "SelectTrigger"

const SelectValue = React.forwardRef<
    HTMLSpanElement,
    React.HTMLAttributes<HTMLSpanElement> & { placeholder?: string }
>(({ className, placeholder, children, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    if (!context) throw new Error("SelectValue must be used within Select")

    // Update placeholder context if provided
    React.useEffect(() => {
        if (placeholder) context.setPlaceholder(placeholder)
    }, [placeholder, context])

    // Priority: Children (Explicit) > Context Label (Selected from Item) > Placeholder
    const display = children || context.label || placeholder || context.placeholder

    return (
        <span
            ref={ref}
            className={cn("block truncate", className)}
            {...props}
        >
            {display}
        </span>
    )
})
SelectValue.displayName = "SelectValue"

const SelectContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    if (!context) throw new Error("SelectContent must be used within Select")

    if (!context.open) return null

    return (
        <div
            ref={ref}
            className={cn(
                "absolute z-50 min-w-[8rem] overflow-hidden rounded-md border border-slate-200 bg-white text-slate-950 shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 top-full mt-1 w-full",
                className
            )}
            {...props}
        >
            <div className="p-1">{children}</div>
        </div>
    )
})
SelectContent.displayName = "SelectContent"

const SelectItem = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & { value: string }
>(({ className, children, value, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    if (!context) throw new Error("SelectItem must be used within Select")

    const isSelected = context.value === value

    // If selected, update the label in parent context (for initial load if open)
    React.useEffect(() => {
        if (isSelected) {
            context.setLabel(children)
        }
    }, [isSelected, children, context])

    const handleSelect = (e: React.MouseEvent | React.PointerEvent) => {
        // Prevent default to avoid focus issues
        e.preventDefault()
        context.onValueChange(value)
        context.setLabel(children)
        context.setOpen(false)
    }

    return (
        <div
            ref={ref}
            onClick={handleSelect}
            className={cn(
                "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-slate-100 focus:bg-slate-100 focus:text-slate-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 cursor-pointer",
                className
            )}
            {...props}
        >
            <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                {isSelected && <Check className="h-4 w-4" />}
            </span>
            <span className="truncate">{children}</span>
        </div>
    )
})
SelectItem.displayName = "SelectItem"

export { Select, SelectTrigger, SelectContent, SelectItem, SelectValue }
