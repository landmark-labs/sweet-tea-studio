import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function stripDarkVariantClasses(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .split(/\s+/g)
    .filter(Boolean)
    .filter((token) => !token.startsWith("dark:"))
    .join(" ");
}
