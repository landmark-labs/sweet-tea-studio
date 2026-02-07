import * as React from "react"
import { cn } from "@/lib/utils"

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, ...props }, ref) => {
        return (
            <textarea
                className={cn(
                    "flex min-h-[92px] w-full rounded-[calc(var(--radius)-4px)] border border-input bg-surface px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus:border-ring disabled:cursor-not-allowed disabled:opacity-45",
                    className
                )}
                ref={ref}
                {...props}
            />
        )
    }
)
Textarea.displayName = "Textarea"

export { Textarea }
