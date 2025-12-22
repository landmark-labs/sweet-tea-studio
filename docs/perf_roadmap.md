# Performance Roadmap

Goal: keep prompt typing and snippet actions (drag, add, reorder) responsive and stable.
Targets: P95 input-to-paint < 50ms for ~2000-char prompts, 60fps during snippet interactions.

## Phase 0 - Baseline and instrumentation
[x] Add perf sampling helpers in `frontend/src/lib/clientDiagnostics.ts`.
[x] Log prompt input latency (input to next frame) in `frontend/src/components/PromptAutocompleteTextarea.tsx`.
[x] Log snippet action latency (drag/add/remove) in `frontend/src/components/PromptConstructor.tsx`.
[x] Log prompt reconciliation duration in `frontend/src/components/PromptConstructor.tsx`.
[x] Capture baseline P50/P95 for prompt input and snippet actions.
[ ] Capture React Profiler traces for PromptStudio during typing and snippet drag (deferred).
[ ] Identify top 3 slow commits and document them here (deferred).

### Baseline snapshot (client_diagnostics.jsonl)
- perf_prompt_input_latency: n=66 min=22ms p50=130ms p90=446ms p95=702ms p99=1323ms max=1473ms
- perf_snippet_action_latency: n=7 min=106ms p50=185ms p90=223ms p95=240ms p99=254ms max=257ms (low sample count)
- perf_prompt_reconcile: no samples yet (needs more usage)

## Phase 1 - Jotai state isolation
[x] Introduce form state atoms (atomFamily) keyed by field.
[x] Migrate DynamicForm to field-level subscriptions (no full-form updates on keystroke).
[x] Add atom persistence (idle or batched) for per-field values.
[x] Ensure undo/redo registration still works with Jotai updates.

## Phase 2 - PromptConstructor + Highlighting
[x] Pre-index snippet library for reconciliation (avoid O(n*m) per keystroke).
[x] Defer or workerize reconcile work (idle or Web Worker).
[x] Move highlight computation to idle or worker; cap work for long prompts.

## Phase 3 - UI interaction perf
[x] Virtualize snippet library and gallery lists.
[x] Stabilize handlers/props to minimize re-render cascades.
[x] Reduce large prop churn in PromptStudio (memoized subcomponents).

## Phase 4 - Backend perf
[ ] Persist width/height and file-exists at ingest time (avoid per-request IO).
[ ] Add gallery indexes / FTS for search.
[ ] Cache monitoring metrics server-side (avoid per-request nvidia-smi).

## Notes / Decisions
- Jotai will own UI state only; persisted project/job data continues to live in SQLite via backend APIs.
- Instrumentation is throttled and sampled to avoid adding overhead during typing.
