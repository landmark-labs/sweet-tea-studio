// Helper utilities for DynamicForm field rendering and grouping.

export const resolveMediaKind = (fieldKey: string, field: Record<string, unknown>) => {
  const explicit = typeof field.x_media_kind === "string" ? field.x_media_kind.toLowerCase() : null;
  if (explicit === "image" || explicit === "video") {
    return explicit;
  }

  const key = fieldKey.toLowerCase();
  const title = String(field.title || "").toLowerCase();
  const classType = String(field.x_class_type || "").toLowerCase();
  if (key.endsWith(".video") && classType.includes("loadvideo")) {
    return "video";
  }
  return "image";
};

export const resolveNodeTitle = (field: Record<string, unknown>, fallback = "Configuration") => {
  const alias = typeof field.x_node_alias === "string" ? field.x_node_alias.trim() : "";
  if (alias) return alias;

  const explicit = typeof field.x_title === "string" ? field.x_title.trim() : "";
  if (explicit) return explicit;

  const title = String(field.title || "").trim();
  const match = title.match(/\(([^)]+)\)\s*$/);
  if (match && match[1]) return match[1];

  const classType = String(field.x_class_type || "").trim();
  if (classType) return classType;

  return title || fallback;
};

export const resolveParamTitle = (fieldKey: string, field: Record<string, unknown>) => {
  const raw = String(field.title || fieldKey).trim();
  const match = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!match) return raw;
  const base = (match[1] || "").trim();
  return base || raw;
};

export const isMediaUploadField = (fieldKey: string, field: Record<string, unknown>) => {
  const key = fieldKey.toLowerCase();
  const title = String(field.title || "").toLowerCase();
  const classType = String(field.x_class_type || "").toLowerCase();
  const isExplicit =
    field.widget === "media_upload" ||
    field.widget === "image_upload" ||
    (field.widget === "upload" && resolveMediaKind(fieldKey, field) === "image");
  const isLoadImage = title.includes("loadimage");
  const isVideoInput = key.endsWith(".video") && classType.includes("loadvideo");
  const isStringLike = field.type === "string" || Array.isArray(field.enum);

  return (isExplicit || isLoadImage || isVideoInput) && isStringLike;
};
