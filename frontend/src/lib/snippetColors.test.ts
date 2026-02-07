import { describe, expect, it } from "vitest";

import { SNIPPET_COLORS, getSnippetHighlightBgClasses, normalizeSnippetColor } from "./snippetColors";

describe("normalizeSnippetColor", () => {
  it("keeps known palette colors unchanged", () => {
    expect(normalizeSnippetColor(SNIPPET_COLORS[0], "seed")).toBe(SNIPPET_COLORS[0]);
  });

  it("coerces legacy hex colors into the palette", () => {
    const color = normalizeSnippetColor("#3b82f6", "legacy-default-snippet");
    expect(SNIPPET_COLORS).toContain(color);
  });

  it("coerces dark-only backgrounds into the palette", () => {
    const color = normalizeSnippetColor("bg-black border-cyan-500 text-cyan-200 dark:bg-black", "legacy-dark-snippet");
    expect(SNIPPET_COLORS).toContain(color);
  });
});

describe("getSnippetHighlightBgClasses", () => {
  it("always returns at least one bg-* class", () => {
    const bgClasses = getSnippetHighlightBgClasses("#ef4444", "legacy-highlight");
    expect(bgClasses).toMatch(/\bbg-/);
  });
});
