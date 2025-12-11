export const SCHEMA_META_PREFIX = "__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function stripSchemaMeta(schema: Record<string, any> | null | undefined) {
    if (!schema) return {};
    return Object.fromEntries(
        Object.entries(schema).filter(([key]) => !key.startsWith(SCHEMA_META_PREFIX))
    );
}
