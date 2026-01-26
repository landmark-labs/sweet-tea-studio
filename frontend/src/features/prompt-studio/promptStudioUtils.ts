import { type PromptItem, type PromptRehydrationItemV1, type PromptRehydrationSnapshotV1 } from "@/lib/types";
import { loadPromptRehydrationSnapshot, savePromptRehydrationSnapshot } from "@/lib/persistedState";

type PromptStudioRehydrationStateV1 = {
  v: 1;
  workflowId: string;
  snapshot: PromptRehydrationSnapshotV1 | null;
  at: number;
};

export const isPromptRehydrationSnapshotV1 = (value: unknown): value is PromptRehydrationSnapshotV1 => {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<PromptRehydrationSnapshotV1>;
  if (snapshot.version !== 1) return false;
  if (!snapshot.fields || typeof snapshot.fields !== "object") return false;
  return true;
};

export const readPromptStudioRehydrationSnapshot = async (
  workflowId: string
): Promise<PromptRehydrationSnapshotV1 | null> => {
  if (!workflowId) return null;
  try {
    const raw = await loadPromptRehydrationSnapshot(workflowId);
    if (!raw || typeof raw !== "object") return null;
    const parsed = raw as Partial<PromptStudioRehydrationStateV1> | null;
    if (!parsed || parsed.v !== 1) return null;
    const snapshot = parsed.snapshot;
    if (snapshot === null) return null;
    return isPromptRehydrationSnapshotV1(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
};

export const persistPromptStudioRehydrationSnapshot = (
  workflowId: string,
  snapshot: PromptRehydrationSnapshotV1 | null
) => {
  if (!workflowId) return;
  if (!snapshot) {
    void savePromptRehydrationSnapshot(workflowId, null);
    return;
  }
  const state: PromptStudioRehydrationStateV1 = {
    v: 1,
    workflowId,
    snapshot,
    at: Date.now(),
  };
  void savePromptRehydrationSnapshot(workflowId, state);
};

export const isPersistableSchemaKey = (key: string) =>
  !key.startsWith("__") || key.startsWith("__bypass_");

export const buildSchemaDefaults = (schema: Record<string, any>) => {
  const defaults: Record<string, unknown> = {};
  Object.entries(schema || {}).forEach(([key, field]) => {
    if (isPersistableSchemaKey(key) && field?.default !== undefined) {
      defaults[key] = field.default;
    }
  });
  return defaults;
};

export const filterParamsForSchema = (
  schema: Record<string, any>,
  params: Record<string, unknown> | null | undefined
) => {
  const filtered: Record<string, unknown> = {};
  if (!params || typeof params !== "object") return filtered;
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) return;
    // Always preserve __bypass_ keys from job_params for regeneration
    // These keys may not exist in the schema at runtime but are still valid
    if (key.startsWith("__bypass_")) {
      filtered[key] = value;
      return;
    }
    if (isPersistableSchemaKey(key) && key in schema) {
      filtered[key] = value;
    }
  });
  return filtered;
};

export const normalizeParamsWithDefaults = (
  schema: Record<string, any>,
  params: Record<string, unknown>
) => {
  const normalized: Record<string, unknown> = { ...params };
  Object.entries(schema || {}).forEach(([key, field]) => {
    if (!isPersistableSchemaKey(key)) return;
    if (field?.default === undefined) return;

    const value = normalized[key];
    if (value === undefined || value === null) {
      normalized[key] = field.default;
      return;
    }

    if (Array.isArray(field.enum)) {
      const defaultValue = field.default;
      const valueStr = typeof value === "string" ? value : String(value);
      const trimmed = valueStr.trim();
      const enumHasEmpty = field.enum.includes("");
      const isEmpty = trimmed.length === 0;

      // Only reset if value is truly empty - preserve values that exist even if not
      // in static enum list. This allows regeneration with samplers/schedulers/models
      // that were valid at generation time but may not be in the hardcoded enum.
      // DynamicForm handles showing "stale" values, ComfyUI validates at execution.
      if (isEmpty && !enumHasEmpty) {
        normalized[key] = defaultValue;
      }
    }
  });
  return normalized;
};

export const filterPromptRehydrationSnapshot = (
  snapshot: PromptRehydrationSnapshotV1 | null | undefined,
  params: Record<string, unknown>,
  library: PromptItem[]
): PromptRehydrationSnapshotV1 | null => {
  if (!snapshot || snapshot.version !== 1 || !snapshot.fields || typeof snapshot.fields !== "object") {
    return null;
  }

  const fields: Record<string, PromptRehydrationItemV1[]> = {};
  const libraryById = new Map(library.map((snippet) => [snippet.id, snippet]));

  Object.entries(snapshot.fields).forEach(([fieldKey, items]) => {
    if (typeof (params as any)?.[fieldKey] !== "string") return;
    if (!Array.isArray(items) || items.length === 0) return;

    // Only persist snippet links for blocks that currently match the live snippet content.
    // If a block is showing historical ("frozen") content, treat it as plain text for this generation.
    const normalized: PromptRehydrationItemV1[] = items.map((item) => {
      if (item?.type !== "block" || typeof item?.sourceId !== "string" || !item.sourceId) {
        return item;
      }

      const liveSnippet = libraryById.get(item.sourceId);
      if (!liveSnippet || liveSnippet.type !== "block") {
        return { type: "text", content: item.content };
      }

      if (item.content !== liveSnippet.content) {
        return { type: "text", content: item.content };
      }

      return item;
    });

    const hasLiveLinkedSnippet = normalized.some(
      (item) => item?.type === "block" && typeof item?.sourceId === "string" && item.sourceId.length > 0
    );
    if (!hasLiveLinkedSnippet) return;

    fields[fieldKey] = normalized;
  });

  if (Object.keys(fields).length === 0) return null;
  return { version: 1, fields };
};
