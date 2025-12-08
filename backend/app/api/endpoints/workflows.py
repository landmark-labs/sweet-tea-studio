from fastapi import APIRouter, HTTPException
from typing import List
from app.models.workflow import WorkflowTemplate

router = APIRouter()

# Seed a simple workflow for testing
fake_workflows_db = [
    WorkflowTemplate(
        id=1,
        name="Text2Img Base",
        description="Gen -> Upscale -> Final Workflow",
        graph_json={
          "3": {
            "inputs": {
              "seed": 123456789, 
              "steps": 20,
              "cfg": 8,
              "sampler_name": "euler",
              "scheduler": "normal",
              "denoise": 1,
              "model": ["4", 0],
              "positive": ["6", 0],
              "negative": ["7", 0],
              "latent_image": ["5", 0]
            },
            "class_type": "KSampler",
            "_meta": {"title": "KSampler"}
          },
          "4": {
            "inputs": {"ckpt_name": "hassakuXLIllustrious_v21fix.safetensors"},
            "class_type": "CheckpointLoaderSimple",
            "_meta": {"title": "Load Checkpoint"}
          },
          "5": {
            "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
            "class_type": "EmptyLatentImage",
            "_meta": {"title": "Empty Latent Image"}
          },
          "6": {
            "inputs": {"text": "beautiful scenery nature glass bottle landscape, purple galaxy bottle,", "clip": ["4", 1]},
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "CLIP Text Encode (Prompt)"}
          },
          "7": {
            "inputs": {"text": "text, watermark", "clip": ["4", 1]},
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "CLIP Text Encode (Negative Prompt)"}
          },
          "8": {
            "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
            "class_type": "VAEDecode",
            "_meta": {"title": "VAE Decode"}
          },
          "9": {
            "inputs": {"filename_prefix": "ComfyUI", "images": ["8", 0]},
            "class_type": "SaveImage",
            "_meta": {"title": "Save Image"}
          }
        },
        input_schema={
            "prompt": {"type": "string", "widget": "textarea", "title": "Positive Prompt", "default": "masterpiece, best quality"},
            "negative_prompt": {"type": "string", "widget": "textarea", "title": "Negative Prompt", "default": "lowres, bad anatomy"},
            "width": {"type": "integer", "title": "Width", "default": 1024},
            "height": {"type": "integer", "title": "Height", "default": 1024},
            "steps": {"type": "integer", "title": "Steps", "default": 20},
            "cfg": {"type": "number", "title": "CFG Scale", "default": 7.0},
            "seed": {"type": "integer", "title": "Seed", "default": -1},
            "sampler_name": {
                "type": "string", 
                "title": "Sampler", 
                "default": "euler",
                "enum": ["euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde", "ddim", "uni_pc", "uni_pc_bh2"]
            },
            "scheduler": {
                "type": "string", 
                "title": "Scheduler", 
                "default": "normal",
                "enum": ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform"]
            }
        },
        node_mapping={
            "prompt": {"node_id": "6", "field": "inputs.text"},
            "negative_prompt": {"node_id": "7", "field": "inputs.text"},
            "width": {"node_id": "5", "field": "inputs.width"},
            "height": {"node_id": "5", "field": "inputs.height"},
            "steps": {"node_id": "3", "field": "inputs.steps"},
            "cfg": {"node_id": "3", "field": "inputs.cfg"},
            "seed": {"node_id": "3", "field": "inputs.seed"},
            "sampler_name": {"node_id": "3", "field": "inputs.sampler_name"},
            "scheduler": {"node_id": "3", "field": "inputs.scheduler"}
        }
    ),
    WorkflowTemplate(
        id=2,
        name="Img2Img Base",
        description="Transform an existing image with prompt",
        graph_json={
          "3": {
            "inputs": {
              "seed": 123456789, 
              "steps": 20,
              "cfg": 8,
              "sampler_name": "euler",
              "scheduler": "normal",
              "denoise": 0.6,
              "model": ["4", 0],
              "positive": ["6", 0],
              "negative": ["7", 0],
              "latent_image": ["11", 0]
            },
            "class_type": "KSampler",
            "_meta": {"title": "KSampler"}
          },
          "4": {
            "inputs": {"ckpt_name": "hassakuXLIllustrious_v21fix.safetensors"},
            "class_type": "CheckpointLoaderSimple",
            "_meta": {"title": "Load Checkpoint"}
          },
          "6": {
            "inputs": {"text": "beautiful woman, cinematic lighting", "clip": ["4", 1]},
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "CLIP Text Encode (Prompt)"}
          },
          "7": {
            "inputs": {"text": "text, watermark, ugly", "clip": ["4", 1]},
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "CLIP Text Encode (Negative Prompt)"}
          },
          "8": {
            "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
            "class_type": "VAEDecode",
            "_meta": {"title": "VAE Decode"}
          },
          "9": {
            "inputs": {"filename_prefix": "ComfyUI_Img2Img", "images": ["8", 0]},
            "class_type": "SaveImage",
            "_meta": {"title": "Save Image"}
          },
          "10": {
            "inputs": {"image": "example.png", "upload": "image"},
            "class_type": "LoadImage",
            "_meta": {"title": "Load Image"}
          },
          "11": {
            "inputs": {"pixels": ["10", 0], "vae": ["4", 2]},
            "class_type": "VAEEncode",
            "_meta": {"title": "VAE Encode"}
          }
        },
        input_schema={
            "image": {"type": "string", "widget": "upload", "title": "Input Image"},
            "prompt": {"type": "string", "title": "Positive Prompt", "default": "masterpiece, best quality"},
            "negative_prompt": {"type": "string", "title": "Negative Prompt", "default": "lowres, bad anatomy"},
            "denoise": {"type": "number", "title": "Denoise Strength", "default": 0.6, "minimum": 0, "maximum": 1, "step": 0.01},
            "steps": {"type": "integer", "title": "Steps", "default": 20},
            "cfg": {"type": "number", "title": "CFG Scale", "default": 7.0},
            "seed": {"type": "integer", "title": "Seed", "default": -1},
            "sampler_name": {
                "type": "string", 
                "title": "Sampler", 
                "default": "euler",
                "enum": ["euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde", "ddim", "uni_pc", "uni_pc_bh2"]
            },
            "scheduler": {
                "type": "string", 
                "title": "Scheduler", 
                "default": "normal",
                "enum": ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform"]
            }
        },
        node_mapping={
            "image": {"node_id": "10", "field": "inputs.image"},
            "prompt": {"node_id": "6", "field": "inputs.text"},
            "negative_prompt": {"node_id": "7", "field": "inputs.text"},
            "denoise": {"node_id": "3", "field": "inputs.denoise"},
            "steps": {"node_id": "3", "field": "inputs.steps"},
            "cfg": {"node_id": "3", "field": "inputs.cfg"},
            "seed": {"node_id": "3", "field": "inputs.seed"},
            "sampler_name": {"node_id": "3", "field": "inputs.sampler_name"},
            "scheduler": {"node_id": "3", "field": "inputs.scheduler"}
        }
    )
]

@router.get("/", response_model=List[WorkflowTemplate])
def read_workflows(skip: int = 0, limit: int = 100):
    return fake_workflows_db[skip : skip + limit]

@router.get("/{workflow_id}", response_model=WorkflowTemplate)
def read_workflow(workflow_id: int):
    for workflow in fake_workflows_db:
        if workflow.id == workflow_id:
            return workflow
    raise HTTPException(status_code=404, detail="Workflow not found")
