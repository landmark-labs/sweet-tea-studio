import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { UndoRedoProvider } from './lib/undoRedo'

const PERFORMANCE_GUARD_KEY = "__sts_perf_measure_guard";

const guardPerformanceMeasure = () => {
  if (typeof performance === "undefined" || typeof performance.measure !== "function") return;
  const perfAny = performance as typeof performance & Record<string, unknown>;
  if (perfAny[PERFORMANCE_GUARD_KEY]) return;
  perfAny[PERFORMANCE_GUARD_KEY] = true;
  const original = performance.measure.bind(performance);

  const guardedMeasure = (
    name: string,
    startOrOptions?: string | PerformanceMeasureOptions,
    endMark?: string
  ) => {
    try {
      return original(name, startOrOptions as any, endMark as any);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isDataClone = err instanceof DOMException && err.name === "DataCloneError";
      if (isDataClone || message.includes("DataCloneError") || message.includes("Data cannot be cloned")) {
        return undefined;
      }
      throw err;
    }
  };

  try {
    performance.measure = guardedMeasure as typeof performance.measure;
  } catch {
    // If the browser disallows patching, skip the guard.
  }
};

guardPerformanceMeasure();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UndoRedoProvider>
      <App />
    </UndoRedoProvider>
  </StrictMode>,
)
