const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".mpg", ".mpeg"]);

const getExtension = (value: string) => {
    const dot = value.lastIndexOf(".");
    return dot >= 0 ? value.slice(dot).toLowerCase() : "";
};

const extractPath = (value?: string | null) => {
    if (!value) return "";
    if (value.includes("?path=")) {
        try {
            const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
            const url = new URL(value, origin);
            const pathParam = url.searchParams.get("path");
            if (pathParam) return pathParam;
        } catch {
            // Fall through to raw value
        }
    }
    return value;
};

export const isVideoFile = (path?: string | null, filename?: string | null) => {
    const candidate = filename && filename.includes(".") ? filename : extractPath(path);
    if (!candidate) return false;
    return VIDEO_EXTENSIONS.has(getExtension(candidate));
};
