# Monitoring & Preview UX

## Performance HUD

- Location: fixed to the lower-right corner of the app (`<PerformanceHUD />`).
- Data source: `GET /api/v1/monitoring/metrics` (psutil + `nvidia-smi` sampling on the backend).
- Refresh interval: 3 seconds by default (configurable via the `refreshMs` prop).
- Fallbacks: shows "No GPU detected" when GPUs are absent and displays `sampling...` for disk bandwidth until two samples have been collected. Errors are surfaced inline in the HUD.

## Generation Feed

- Location: floating card in the lower-left of Prompt Studio (`<GenerationFeed />`).
- Data source: WebSocket job stream updates (status/progress) merged with the latest image path when a job completes.
- Behavior: tracks up to the last 8 jobs, updates in real time, and links to the most recent preview.

## Prompt Library Quick Panel

- Location: toggle from the Configuration header; floats over the studio on the right edge.
- Purpose: keep saved prompts visible while editing forms. Shares the same search + apply behaviors as the inline library list.
