import * as React from "react";

import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "outline";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        variant === "default"
          ? "bg-slate-900 text-white border-slate-900"
          : "bg-white text-slate-700 border-slate-200",
        className
      )}
      {...props}
    />
  );
}
