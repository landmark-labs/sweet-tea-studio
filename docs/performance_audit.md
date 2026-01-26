# Performance Audit (2026-01-05)

This repo already contains an actionable performance plan in `docs/perf_roadmap.md`. This note complements it with a “what to look at next” checklist and the concrete changes made in this pass to reduce UI “stickiness”.

## Symptoms that commonly present as “stickiness”

- **Main-thread stalls** (long tasks) while typing/dragging/scrolling: typically expensive render work, synchronous storage writes, heavy JSON work, or large list reconciliation.
- **High-frequency re-renders** of big subtrees caused by referentially-unstable props (new arrays/functions per parent render).
- **Undo/redo stack churn** (recording on every keystroke) causing additional allocations and context updates.
- **Async burst “catch-up”** when background tabs queue state updates, then flush on visibility restore.

## High-confidence optimization avenues

### Frontend: React render + state churn

1. **Stabilize props for memoized heavy components**
   - Ensure `React.memo` can actually bail out: avoid inline lambdas and avoid rebuilding arrays/objects in parent renders.
2. **Eliminate pathological work inside render**
   - Avoid `JSON.stringify` for “contains X” checks in render paths.
   - Avoid O(n²) patterns in maps (e.g., `slice(0, idx).filter(...)`).
3. **Ensure text inputs don’t fight global undo/redo**
   - When a text input is focused, global undo should not intercept (native input undo should win).
4. **Throttle/coalesce high-rate updates**
   - WebSocket progress, preview frames, and scroll handlers should be coalesced (RAF) and/or throttled.

### Backend: avoid per-job overhead spikes

1. **Reduce per-job database overhead**
   - Batch inserts for per-node timing data.
2. **Watch for “debug” features that accidentally become always-on**
   - Graph dumps, heavy logs, and per-request system queries can add jitter.

## Implemented in this pass

### `frontend/src/features/prompt-studio/PromptStudioPage.tsx`

- **Stop re-render cascades into `ImageViewer`, `ProjectGallery`, `MediaTray`, and `PromptConstructor`** during unrelated state updates by:
  - Memoizing the `images` array passed into `ImageViewer`.
  - Converting inline callback props to stable `useCallback` handlers (`onImageUpdate`, `onDelete`, `onSelectImage`, `onShowInViewer`, `onFinish`).

### `frontend/src/components/PromptConstructor.tsx`

- **Fix O(n²) text index calculation** in canvas rendering (previously computed via `slice(...).filter(...)` per item).
- **Make canvas item handlers stable** so `React.memo` on `SortableItem` can bail out instead of re-rendering every item.
- **Avoid per-keystroke global undo/redo churn** while editing text segments by routing focus state through `setTextInputFocused` and not recording history for those keystrokes.

### `frontend/src/components/ProjectGallery.tsx`

- **Remove repeated `JSON.stringify(workflow.graph_json)`** in the context menu path and replace with a memoized, structural scan of node `class_type`.

### `frontend/src/components/ImageViewer.tsx`

- **Reuse the same workflow-compatibility test** as `ProjectGallery` (no stringify required).

### `frontend/src/components/MediaTray.tsx`

- Wrap the component in `React.memo` so it doesn’t re-render on every `PromptStudio` update when its props are unchanged.

### `frontend/src/lib/workflowGraph.ts`

- Added a small shared helper to detect whether a workflow graph contains specific node `class_type` values without stringifying the entire graph.

### `backend/app/services/job_processor.py`

- **Batch insert node timing rows** (`session.add_all`) and avoid repeated indexing into `execution_metrics.node_timings[0]`.

## Suggested next profiling steps (to pinpoint any remaining stickiness)

1. **React Profiler**
   - Capture interactions in PromptStudio:
     - prompt typing (textarea focus),
     - drag/reorder snippets,
     - open ProjectGallery context menu,
     - generation progress updates.
   - Look for “why did this render” (prop identity changes, context updates).
2. **Chrome Performance panel**
   - Identify long tasks > 50ms and inspect call stacks.
3. **Client diagnostics sampling**
   - Toggle/inspect `sts_client_diag_enabled` and review `logs/client_diagnostics.jsonl` (backend writes JSONL via `/monitoring/client-logs`).

