import io
import logging
import os
from dataclasses import dataclass
from threading import BoundedSemaphore
from typing import Dict, List, Optional

from PIL import Image

logger = logging.getLogger(__name__)


@dataclass
class VLMConfig:
    model_id: str
    backend: str = "transformers"
    quantization: str = "4bit"
    dtype: str = "bfloat16"
    prompt: str = "Describe the image with a concise caption and ranked tags."
    max_new_tokens: int = 128
    max_concurrency: int = 2
    device: Optional[str] = None
    enabled: bool = True


class VLMService:
    """Simple VLM wrapper with optional quantization."""

    def __init__(self, config: VLMConfig):
        self.config = config
        self._model = None
        self._processor = None
        self._sampling_params = None
        self._status: Dict[str, object] = {"loaded": False, "backend": config.backend}
        self._semaphore = BoundedSemaphore(max(1, config.max_concurrency))

    def _load_transformers(self):
        try:
            from transformers import (
                AutoModelForCausalLM,
                AutoProcessor,
                BitsAndBytesConfig,
            )
            import torch
        except ImportError as exc:  # pragma: no cover - optional dependency
            logger.warning("Transformers not installed: %s", exc)
            self._status["error"] = "transformers_not_installed"
            return

        quant_config = None
        if self.config.quantization in {"4bit", "8bit"}:
            use_4bit = self.config.quantization == "4bit"
            quant_config = BitsAndBytesConfig(
                load_in_4bit=use_4bit,
                load_in_8bit=not use_4bit,
                bnb_4bit_compute_dtype=getattr(torch, self.config.dtype, torch.bfloat16),
            )

        device_map = "auto"
        if self.config.device:
            device_map = {"": self.config.device}

        logger.info("Loading VLM model %s with %s quantization", self.config.model_id, self.config.quantization)
        try:
            self._model = AutoModelForCausalLM.from_pretrained(
                self.config.model_id,
                device_map=device_map,
                torch_dtype=getattr(torch, self.config.dtype, torch.bfloat16),
                quantization_config=quant_config,
                trust_remote_code=True,
            )
            self._processor = AutoProcessor.from_pretrained(self.config.model_id, trust_remote_code=True)
            self._status["loaded"] = True
            self._status["model_id"] = self.config.model_id
            self._status.pop("error", None)
        except Exception as exc:  # pragma: no cover - runtime failure
            logger.error("Failed to load VLM: %s", exc)
            self._status["error"] = str(exc)
            self._model = None
            self._processor = None

    def _load_vllm(self):
        try:
            from vllm import LLM, SamplingParams
            from transformers import AutoProcessor
        except ImportError as exc:  # pragma: no cover - optional dependency
            logger.warning("vLLM not installed: %s", exc)
            self._status["error"] = "vllm_not_installed"
            return

        try:
            self._processor = AutoProcessor.from_pretrained(self.config.model_id, trust_remote_code=True)
            self._model = LLM(
                model=self.config.model_id,
                dtype=self.config.dtype,
                max_num_seqs=self.config.max_concurrency,
            )
            self._sampling_params = SamplingParams(max_tokens=self.config.max_new_tokens)
            self._status["loaded"] = True
            self._status["model_id"] = self.config.model_id
            self._status.pop("error", None)
        except Exception as exc:  # pragma: no cover - runtime failure
            logger.error("Failed to load vLLM backend: %s", exc)
            self._status["error"] = str(exc)
            self._model = None
            self._processor = None
            self._sampling_params = None

    def ensure_loaded(self):
        if not self.config.enabled:
            self._status["error"] = "disabled"
            return

        if self._model is None or self._processor is None:
            if self.config.backend == "vllm":
                self._load_vllm()
            else:
                self._load_transformers()

    def _extract_tags(self, caption: str) -> List[str]:
        cleaned = caption.replace("#", " ").replace(".", " ").replace(",", " ")
        tokens = [t.strip().lower() for t in cleaned.split() if len(t.strip()) > 2]
        seen = set()
        tags: List[str] = []
        for token in tokens:
            if token not in seen and token.isalpha():
                seen.add(token)
                tags.append(token)
            if len(tags) >= 15:
                break
        return tags

    def generate_caption(self, image_bytes: bytes) -> Dict[str, object]:
        """Generate a caption with optional ranked tags."""
        self.ensure_loaded()

        caption = ""
        tags: List[str] = []
        used_backend = self._status.get("backend", "unknown")

        try:
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        except Exception:
            return {"caption": "Invalid image", "ranked_tags": [], "model": self.config.model_id, "backend": used_backend}

        with self._semaphore:
            if self._model and self._processor and self._status.get("loaded"):
                try:
                    prompt = self.config.prompt
                    if self.config.backend == "vllm" and self._sampling_params is not None:
                        outputs = self._model.generate(
                            {
                                "prompt": prompt,
                                "multi_modal_data": {"image": image},
                            },
                            sampling_params=self._sampling_params,
                        )
                        if outputs and outputs[0].outputs:
                            caption = outputs[0].outputs[0].text.strip()
                    else:
                        inputs = self._processor(text=prompt, images=image, return_tensors="pt")
                        if hasattr(inputs, "to"):
                            inputs = inputs.to(self._model.device)
                        generation = self._model.generate(
                            **inputs,
                            max_new_tokens=self.config.max_new_tokens,
                        )
                        caption = self._processor.batch_decode(generation, skip_special_tokens=True)[0].strip()
                    tags = self._extract_tags(caption)
                except Exception as exc:  # pragma: no cover - runtime failure
                    logger.error("Caption generation failed: %s", exc)
                    caption = "Captioning failed."
            else:
                # Lightweight heuristic fallback
                caption = "Vision model unavailable; manual caption needed."

        return {
            "caption": caption,
            "ranked_tags": tags,
            "model": self.config.model_id,
            "backend": used_backend,
        }

    def tags_to_prompt(self, tags: List[str]) -> str:
        trimmed = [t.strip() for t in tags if t.strip()]
        if not trimmed:
            return ""
        emphasized = [f"{tag}" for tag in trimmed]
        return ", ".join(emphasized)

    def status(self) -> Dict[str, object]:
        return {
            **self._status,
            "quantization": self.config.quantization,
            "max_concurrency": self.config.max_concurrency,
            "max_new_tokens": self.config.max_new_tokens,
        }


def load_vlm_from_env() -> VLMService:
    model_id = os.getenv("VLM_MODEL_ID", "Qwen/Qwen2-VL-7B-Instruct")
    backend = os.getenv("VLM_BACKEND", "transformers")
    quantization = os.getenv("VLM_QUANTIZATION", "4bit")
    dtype = os.getenv("VLM_DTYPE", "bfloat16")
    prompt = os.getenv("VLM_PROMPT", "Describe the image in one detailed sentence, listing key subjects and styles.")
    concurrency = int(os.getenv("VLM_MAX_CONCURRENCY", "2"))
    max_new_tokens = int(os.getenv("VLM_MAX_NEW_TOKENS", "128"))
    device = os.getenv("VLM_DEVICE")
    enabled = os.getenv("VLM_ENABLED", "true").lower() not in {"false", "0"}

    cfg = VLMConfig(
        model_id=model_id,
        backend=backend,
        quantization=quantization,
        dtype=dtype,
        prompt=prompt,
        max_new_tokens=max_new_tokens,
        max_concurrency=concurrency,
        device=device,
        enabled=enabled,
    )
    return VLMService(cfg)


vlm_service = load_vlm_from_env()
