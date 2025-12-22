const PERFORMANCE_GUARD_KEY = "__sts_perf_measure_guard";

const isDataCloneError = (err: unknown) => {
  if (err instanceof DOMException && err.name === "DataCloneError") return true;
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("DataCloneError") || message.includes("Data cannot be cloned");
};

const stripDetail = (options: Record<string, unknown>) => {
  if (!("detail" in options)) return options;
  const { detail, ...rest } = options;
  return rest;
};

const guardPerformanceMeasure = () => {
  if (typeof performance === "undefined") return;
  const perfAny = performance as typeof performance & Record<string, unknown>;
  if (perfAny[PERFORMANCE_GUARD_KEY]) return;
  perfAny[PERFORMANCE_GUARD_KEY] = true;

  if (typeof performance.measure === "function") {
    const originalMeasure = performance.measure.bind(performance);
    const guardedMeasure = (
      name: string,
      startOrOptions?: string | PerformanceMeasureOptions,
      endMark?: string
    ) => {
      try {
        if (startOrOptions && typeof startOrOptions === "object") {
          const sanitized = stripDetail(startOrOptions as Record<string, unknown>);
          return originalMeasure(name, sanitized as PerformanceMeasureOptions);
        }
        return originalMeasure(name, startOrOptions as any, endMark as any);
      } catch (err) {
        if (isDataCloneError(err)) return undefined;
        throw err;
      }
    };

    try {
      performance.measure = guardedMeasure as typeof performance.measure;
    } catch {
      // Skip if the browser disallows patching.
    }
  }

  if (typeof performance.mark === "function") {
    const originalMark = performance.mark.bind(performance);
    const guardedMark = (name: string, options?: PerformanceMarkOptions) => {
      try {
        if (options && typeof options === "object") {
          const sanitized = stripDetail(options as Record<string, unknown>);
          return originalMark(name, sanitized as PerformanceMarkOptions);
        }
        return originalMark(name);
      } catch (err) {
        if (isDataCloneError(err)) return undefined;
        throw err;
      }
    };

    try {
      performance.mark = guardedMark as typeof performance.mark;
    } catch {
      // Skip if the browser disallows patching.
    }
  }
};

guardPerformanceMeasure();
