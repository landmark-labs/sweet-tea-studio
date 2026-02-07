import type { PromptItem } from "@/lib/types";
import { stripDarkVariantClasses } from "@/lib/utils";

// Expanded snippet palette with high diversity to avoid frequent recycling.
// We keep >=24 distinct tones so repeated colors are uncommon in normal usage.
export const SNIPPET_COLORS = [
  "bg-rose-100/85 border-rose-300/80 text-rose-900",
  "bg-pink-100/85 border-pink-300/80 text-pink-900",
  "bg-fuchsia-100/85 border-fuchsia-300/80 text-fuchsia-900",
  "bg-purple-100/85 border-purple-300/80 text-purple-900",
  "bg-violet-100/85 border-violet-300/80 text-violet-900",
  "bg-indigo-100/85 border-indigo-300/80 text-indigo-900",
  "bg-blue-100/85 border-blue-300/80 text-blue-900",
  "bg-sky-100/85 border-sky-300/80 text-sky-900",
  "bg-cyan-100/85 border-cyan-300/80 text-cyan-900",
  "bg-teal-100/85 border-teal-300/80 text-teal-900",
  "bg-emerald-100/85 border-emerald-300/80 text-emerald-900",
  "bg-green-100/85 border-green-300/80 text-green-900",
  "bg-lime-100/85 border-lime-300/80 text-lime-900",
  "bg-yellow-100/85 border-yellow-300/80 text-yellow-900",
  "bg-amber-100/85 border-amber-300/80 text-amber-900",
  "bg-orange-100/85 border-orange-300/80 text-orange-900",
  "bg-red-100/85 border-red-300/80 text-red-900",
  "bg-rose-200/70 border-rose-400/70 text-rose-950",
  "bg-pink-200/70 border-pink-400/70 text-pink-950",
  "bg-fuchsia-200/70 border-fuchsia-400/70 text-fuchsia-950",
  "bg-purple-200/70 border-purple-400/70 text-purple-950",
  "bg-indigo-200/70 border-indigo-400/70 text-indigo-950",
  "bg-blue-200/70 border-blue-400/70 text-blue-950",
  "bg-cyan-200/70 border-cyan-400/70 text-cyan-950",
  "bg-teal-200/70 border-teal-400/70 text-teal-950",
  "bg-emerald-200/70 border-emerald-400/70 text-emerald-950",
  "bg-green-200/70 border-green-400/70 text-green-950",
  "bg-lime-200/70 border-lime-400/70 text-lime-950",
  "bg-amber-200/70 border-amber-400/70 text-amber-950",
  "bg-orange-200/70 border-orange-400/70 text-orange-950",
];

const SNIPPET_COLOR_SET = new Set(SNIPPET_COLORS);

function hashToUint32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicPaletteColor(seed: string): string {
  return SNIPPET_COLORS[hashToUint32(seed) % SNIPPET_COLORS.length];
}

export function normalizeSnippetColor(
  rawColor: string | null | undefined,
  seed = "",
): string {
  const stripped = stripDarkVariantClasses(rawColor).trim();
  if (SNIPPET_COLOR_SET.has(stripped)) return stripped;

  const colorSeed = seed || stripped || "snippet";
  return deterministicPaletteColor(colorSeed);
}

export function getSnippetColorSeed(snippet: Partial<PromptItem>, fallback = ""): string {
  return `${snippet.id || ""}|${snippet.sourceId || ""}|${snippet.label || ""}|${snippet.content || fallback}`;
}

/**
 * Get the next color for a new snippet.
 * Chooses randomly from unused colors first, then randomly from the full palette once exhausted.
 */
export function getNextSnippetColor(existingSnippets: PromptItem[]): string {
  const usedColors = new Set(
    existingSnippets
      .filter((snippet) => snippet.type === "block")
      .map((snippet) => normalizeSnippetColor(snippet.color, getSnippetColorSeed(snippet)))
  );
  const unusedColors = SNIPPET_COLORS.filter((color) => !usedColors.has(color));
  const pool = unusedColors.length > 0 ? unusedColors : SNIPPET_COLORS;
  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
}

export function getSnippetHighlightBgClasses(rawColor: string | null | undefined, seed = ""): string {
  const normalized = normalizeSnippetColor(rawColor, seed);
  const bgTokens = normalized.split(/\s+/g).filter((token) => token.startsWith("bg-"));
  return bgTokens.join(" ") || "bg-muted";
}
