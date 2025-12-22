import { PromptItem } from "@/lib/types";

type SnippetEntry = {
  snippet: PromptItem;
  content: string;
  length: number;
  order: number;
};

export type SnippetIndex = {
  entries: SnippetEntry[];
  byFirstChar: Map<string, SnippetEntry[]>;
};

export type SnippetMatch = {
  start: number;
  end: number;
  snippet: PromptItem;
  order: number;
  length: number;
};

export function buildSnippetIndex(snippets: PromptItem[]): SnippetIndex {
  const entries: SnippetEntry[] = [];
  snippets.forEach((snippet, order) => {
    if (snippet.type !== "block") return;
    const content = snippet.content || "";
    if (!content) return;
    entries.push({ snippet, content, length: content.length, order });
  });

  const byFirstChar = new Map<string, SnippetEntry[]>();
  for (const entry of entries) {
    const firstChar = entry.content[0];
    const bucket = byFirstChar.get(firstChar);
    if (bucket) {
      bucket.push(entry);
    } else {
      byFirstChar.set(firstChar, [entry]);
    }
  }

  return { entries, byFirstChar };
}

export function findSnippetMatches(
  text: string,
  index: SnippetIndex,
  options: { maxMatches?: number } = {}
): SnippetMatch[] | null {
  if (!text || index.entries.length === 0) return [];
  const matches: SnippetMatch[] = [];
  const maxMatches = options.maxMatches ?? 0;

  for (let i = 0; i < text.length; i += 1) {
    const candidates = index.byFirstChar.get(text[i]);
    if (!candidates) continue;
    for (const entry of candidates) {
      if (i + entry.length > text.length) continue;
      if (!text.startsWith(entry.content, i)) continue;
      matches.push({
        start: i,
        end: i + entry.length,
        snippet: entry.snippet,
        order: entry.order,
        length: entry.length,
      });
      if (maxMatches > 0 && matches.length > maxMatches) {
        return null;
      }
    }
  }

  return matches;
}

export function selectNonOverlappingMatches(
  matches: SnippetMatch[],
  options: { preferLongest?: boolean } = {}
): SnippetMatch[] {
  if (!matches.length) return [];
  const preferLongest = options.preferLongest ?? false;

  let candidates: SnippetMatch[];
  if (preferLongest) {
    const bestByStart = new Map<number, SnippetMatch>();
    for (const match of matches) {
      const existing = bestByStart.get(match.start);
      if (!existing || match.length > existing.length) {
        bestByStart.set(match.start, match);
      }
    }
    candidates = Array.from(bestByStart.values()).sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return b.length - a.length;
    });
  } else {
    candidates = matches.slice().sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      if (a.order !== b.order) return a.order - b.order;
      return b.length - a.length;
    });
  }

  const selected: SnippetMatch[] = [];
  let lastEnd = 0;
  for (const match of candidates) {
    if (match.start >= lastEnd) {
      selected.push(match);
      lastEnd = match.end;
    }
  }

  return selected;
}
