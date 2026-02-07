export interface GroupedGenerationParamItem {
  key: string;
  label: string;
  value: string;
}

export interface GroupedGenerationParamBlock {
  node: string;
  items: GroupedGenerationParamItem[];
}

const PROMPT_KEY_PATTERNS = [
  "cliptextencode",
  "positive_prompt",
  "negative_prompt",
  "positiveprompt",
  "negativeprompt",
  "caption",
  ".prompt",
  ".text",
];

const humanizeToken = (value: string): string => {
  const normalized = value.replace(/^_+|_+$/g, "").replace(/[_-]+/g, " ").trim();
  if (!normalized) return "general";
  return normalized
    .split(" ")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
};

const parseParamKey = (rawKey: string): { node: string; label: string } => {
  if (rawKey.includes(".")) {
    const [nodeToken, ...rest] = rawKey.split(".");
    return {
      node: humanizeToken(nodeToken),
      label: humanizeToken(rest.join(".")),
    };
  }
  if (rawKey.includes("__")) {
    const [nodeToken, ...rest] = rawKey.split("__");
    return {
      node: humanizeToken(nodeToken),
      label: humanizeToken(rest.join("__")),
    };
  }
  if (rawKey.includes(":")) {
    const [nodeToken, ...rest] = rawKey.split(":");
    return {
      node: humanizeToken(nodeToken),
      label: humanizeToken(rest.join(":")),
    };
  }
  return { node: "General", label: humanizeToken(rawKey) };
};

const toDisplayValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const asText = value.map((part) => String(part)).join(", ");
    return asText.length ? asText : null;
  }
  if (typeof value === "object") {
    try {
      const serialized = JSON.stringify(value);
      return serialized && serialized !== "{}" ? serialized : null;
    } catch {
      return null;
    }
  }
  return null;
};

export const isPromptLikeParamKey = (rawKey: string): boolean => {
  const key = rawKey.toLowerCase();
  if (key === "prompt" || key === "text") return true;
  return PROMPT_KEY_PATTERNS.some((token) => key.includes(token));
};

export const groupGenerationParamsByNode = (
  params: Record<string, unknown> | null | undefined
): GroupedGenerationParamBlock[] => {
  if (!params || typeof params !== "object") return [];

  const grouped = new Map<string, GroupedGenerationParamItem[]>();

  Object.entries(params).forEach(([rawKey, rawValue]) => {
    if (isPromptLikeParamKey(rawKey)) return;

    const displayValue = toDisplayValue(rawValue);
    if (!displayValue) return;

    const { node, label } = parseParamKey(rawKey);
    if (!grouped.has(node)) grouped.set(node, []);
    grouped.get(node)!.push({ key: rawKey, label, value: displayValue });
  });

  return Array.from(grouped.entries())
    .filter(([node]) => node.trim().toLowerCase() !== "general")
    .map(([node, items]) => ({
      node,
      items: items.sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.node.localeCompare(b.node));
};
