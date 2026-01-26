// Shared path helpers to normalize Windows and POSIX paths.

export const normalizePath = (path: string) => (path || "").replace(/\\/g, "/");

export const splitPathSegments = (path: string) =>
  normalizePath(path)
    .split("/")
    .filter(Boolean);

export const getBasename = (path: string, fallback: string = "") => {
  const segments = splitPathSegments(path);
  if (segments.length === 0) return fallback;
  return segments[segments.length - 1] || fallback;
};
