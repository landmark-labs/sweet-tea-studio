# ComfyUI connectivity watchdog

Sweet Tea Studio now tracks the availability of the configured ComfyUI engine and surfaces downtime everywhere jobs are submitted.

## How it works

- `ComfyClient` sends lightweight HTTP pings and WebSocket pings with exponential backoff reconnects when streaming results.
- A background `ComfyWatchdog` polls each active engine, doubling the delay between checks while ComfyUI is unreachable (up to 60 seconds).
- Engine health is exposed via `GET /api/v1/engines/health` and cached in memory so the UI can block job submission while ComfyUI is offline.

## UI behavior

- Prompt Studio shows a red banner when the selected engine is down and disables the **Generate** button until a healthy check comes back.
- Job creation returns `503 Service Unavailable` with the last connection error while the watchdog is in backoff.

## Smoke tests

Run the automated smoke suite to verify startup behavior when ComfyUI is missing or restarts mid-run:

- Backend watchdog and job gatekeeping:
  - `cd backend && pytest tests/test_comfy_watchdog.py::test_watchdog_marks_engine_unhealthy`
  - `cd backend && pytest tests/test_comfy_watchdog.py::test_watchdog_recovers_after_restart`
  - `cd backend && pytest tests/test_comfy_watchdog.py::test_job_submission_blocked_when_offline`

These tests mock ComfyUI responses; no live ComfyUI process is required.
