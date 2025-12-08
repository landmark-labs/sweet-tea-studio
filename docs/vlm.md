# Vision Language Model (VLM) runtime

The backend exposes a lightweight service wrapper around a 7B–9B VLM (default: `Qwen/Qwen2-VL-7B-Instruct`). It is intentionally defensive: if the model or GPU is unavailable the API will still respond with a placeholder caption so the UI does not hang.

Two backends are supported:

- **`transformers`** (default) with optional 4-bit/8-bit quantization via bitsandbytes.
- **`vllm`** for higher throughput when running a compatible multi-modal checkpoint (install `vllm` separately to keep the base dependency set lean).

## Configuration

Environment variables (`.env` or process env) control runtime behavior:

- `VLM_MODEL_ID` – Hugging Face model id (default `Qwen/Qwen2-VL-7B-Instruct`).
- `VLM_BACKEND` – `transformers` (default) or `vllm`.
- `VLM_QUANTIZATION` – `4bit`, `8bit`, or `none` to bypass quantization (default `4bit`).
- `VLM_DTYPE` – torch dtype string, e.g., `bfloat16` (default) or `float16`.
- `VLM_DEVICE` – override automatic device map (e.g., `cuda:0`).
- `VLM_MAX_CONCURRENCY` – soft cap for simultaneous caption calls (defaults to `2`, also used to size the vLLM engine queue).
- `VLM_MAX_NEW_TOKENS` – generation limit per caption (defaults to `128`).
- `VLM_PROMPT` – system prompt for caption generation.

## Quantization guidance (24–32 GB GPUs)

- Prefer **4-bit** quantization for the 7B model on 24 GB GPUs; reserve 2–3 GB for FastAPI and other processes.
- Use **8-bit** when scheduling concurrent requests (`VLM_MAX_CONCURRENCY=2`) on a 32 GB card to reduce memory pressure from activations.
- Skip quantization only for debugging or CPU fallback scenarios; throughput will be significantly lower.
- `VLM_MAX_CONCURRENCY` should remain at `1`–`2` for single-GPU setups to prevent OOM during generation.

## Health check

`GET /api/v1/vlm/health` returns model id, backend, quantization, and whether the weights loaded, allowing orchestration layers to ensure the runtime is ready before enabling caption requests.
