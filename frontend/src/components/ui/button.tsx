import * as React from "react"
import { cn } from "@/lib/utils"

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center whitespace-nowrap rounded-[calc(var(--radius)-4px)] text-sm font-medium transition-colors active:translate-y-[1px] disabled:pointer-events-none disabled:opacity-45"
    const variants = {
      default: "border border-transparent bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
      destructive: "border border-destructive/30 bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
      outline: "border border-border bg-surface text-foreground hover:bg-hover",
      secondary: "border border-border/70 bg-muted text-foreground hover:bg-hover",
      ghost: "border border-transparent bg-transparent text-muted-foreground hover:bg-hover hover:text-foreground",
    }
    const sizes = {
      default: "h-9 px-3.5",
      sm: "h-8 px-3 text-xs",
      lg: "h-10 px-5",
      icon: "h-9 w-9",
    }
    return (
      <button
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
