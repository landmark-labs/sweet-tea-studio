"""
Default Starter Workflows

Provides two simplified starter pipes for new users who have no existing workflows.
These use only core ComfyUI nodes to ensure compatibility with any installation.
"""

# Basic Text-to-Image workflow
# Flow: Checkpoint -> CLIP Encode (pos/neg) -> KSampler -> VAE Decode -> Preview
DEFAULT_T2I_WORKFLOW = {
    "graph": {
        "1": {
            "inputs": {
                "ckpt_name": "v1-5-pruned-emaonly.safetensors"
            },
            "class_type": "CheckpointLoaderSimple",
            "_meta": {
                "title": "Load Checkpoint"
            }
        },
        "2": {
            "inputs": {
                "text": "",
                "clip": ["1", 1]
            },
            "class_type": "CLIPTextEncode",
            "_meta": {
                "title": "Positive Prompt"
            }
        },
        "3": {
            "inputs": {
                "text": "",
                "clip": ["1", 1]
            },
            "class_type": "CLIPTextEncode",
            "_meta": {
                "title": "Negative Prompt"
            }
        },
        "4": {
            "inputs": {
                "width": 512,
                "height": 512,
                "batch_size": 1
            },
            "class_type": "EmptyLatentImage",
            "_meta": {
                "title": "Empty Latent Image"
            }
        },
        "5": {
            "inputs": {
                "seed": -1,
                "steps": 20,
                "cfg": 7,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0]
            },
            "class_type": "KSampler",
            "_meta": {
                "title": "KSampler"
            }
        },
        "6": {
            "inputs": {
                "samples": ["5", 0],
                "vae": ["1", 2]
            },
            "class_type": "VAEDecode",
            "_meta": {
                "title": "VAE Decode"
            }
        },
        "7": {
            "inputs": {
                "images": ["6", 0]
            },
            "class_type": "PreviewImage",
            "_meta": {
                "title": "Preview Image"
            }
        }
    },
    "input_schema": {
        "CheckpointLoaderSimple#1.ckpt_name": {
            "type": "string",
            "title": "checkpoint",
            "default": "v1-5-pruned-emaonly.safetensors",
            "enum": [],
            "x_node_id": "1",
            "x_class_type": "CheckpointLoaderSimple",
            "x_title": "Load Checkpoint",
            "x_core": True
        },
        "CLIPTextEncode#2.text": {
            "type": "string",
            "title": "positive prompt",
            "default": "",
            "widget": "textarea",
            "x_node_id": "2",
            "x_class_type": "CLIPTextEncode",
            "x_title": "Positive Prompt",
            "x_core": True
        },
        "CLIPTextEncode#3.text": {
            "type": "string",
            "title": "negative prompt",
            "default": "",
            "widget": "textarea",
            "x_node_id": "3",
            "x_class_type": "CLIPTextEncode",
            "x_title": "Negative Prompt",
            "x_core": True
        },
        "EmptyLatentImage#4.width": {
            "type": "integer",
            "title": "width",
            "default": 512,
            "minimum": 64,
            "maximum": 8192,
            "x_node_id": "4",
            "x_class_type": "EmptyLatentImage",
            "x_title": "Empty Latent Image",
            "x_core": True
        },
        "EmptyLatentImage#4.height": {
            "type": "integer",
            "title": "height",
            "default": 512,
            "minimum": 64,
            "maximum": 8192,
            "x_node_id": "4",
            "x_class_type": "EmptyLatentImage",
            "x_title": "Empty Latent Image",
            "x_core": True
        },
        "EmptyLatentImage#4.batch_size": {
            "type": "integer",
            "title": "batch size",
            "default": 1,
            "minimum": 1,
            "maximum": 64,
            "x_node_id": "4",
            "x_class_type": "EmptyLatentImage",
            "x_title": "Empty Latent Image",
            "x_core": True
        },
        "KSampler#5.seed": {
            "type": "integer",
            "title": "seed",
            "default": -1,
            "minimum": -1,
            "maximum": 18446744073709551615,
            "x_node_id": "5",
            "x_class_type": "KSampler",
            "x_title": "KSampler",
            "x_core": True
        },
        "KSampler#5.steps": {
            "type": "integer",
            "title": "steps",
            "default": 20,
            "minimum": 1,
            "maximum": 10000,
            "x_node_id": "5",
            "x_class_type": "KSampler",
            "x_title": "KSampler",
            "x_core": True
        },
        "KSampler#5.cfg": {
            "type": "number",
            "title": "cfg",
            "default": 7,
            "minimum": 0,
            "maximum": 100,
            "step": 0.1,
            "x_node_id": "5",
            "x_class_type": "KSampler",
            "x_title": "KSampler",
            "x_core": True
        },
        "KSampler#5.sampler_name": {
            "type": "string",
            "title": "sampler",
            "default": "euler",
            "enum": [
                "euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral",
                "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral",
                "dpmpp_sde", "dpmpp_2m", "dpmpp_2m_sde", "ddim", "uni_pc"
            ],
            "x_node_id": "5",
            "x_class_type": "KSampler",
            "x_title": "KSampler",
            "x_core": True
        },
        "KSampler#5.scheduler": {
            "type": "string",
            "title": "scheduler",
            "default": "normal",
            "enum": ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform"],
            "x_node_id": "5",
            "x_class_type": "KSampler",
            "x_title": "KSampler",
            "x_core": True
        },
        "KSampler#5.denoise": {
            "type": "number",
            "title": "denoise",
            "default": 1.0,
            "minimum": 0,
            "maximum": 1,
            "step": 0.01,
            "x_node_id": "5",
            "x_class_type": "KSampler",
            "x_title": "KSampler",
            "x_core": True
        },
        "__node_order": ["1", "2", "3", "4", "5", "6", "7"]
    },
    "node_mapping": {
        "CheckpointLoaderSimple#1.ckpt_name": {"node_id": "1", "field": "inputs.ckpt_name"},
        "CLIPTextEncode#2.text": {"node_id": "2", "field": "inputs.text"},
        "CLIPTextEncode#3.text": {"node_id": "3", "field": "inputs.text"},
        "EmptyLatentImage#4.width": {"node_id": "4", "field": "inputs.width"},
        "EmptyLatentImage#4.height": {"node_id": "4", "field": "inputs.height"},
        "EmptyLatentImage#4.batch_size": {"node_id": "4", "field": "inputs.batch_size"},
        "KSampler#5.seed": {"node_id": "5", "field": "inputs.seed"},
        "KSampler#5.steps": {"node_id": "5", "field": "inputs.steps"},
        "KSampler#5.cfg": {"node_id": "5", "field": "inputs.cfg"},
        "KSampler#5.sampler_name": {"node_id": "5", "field": "inputs.sampler_name"},
        "KSampler#5.scheduler": {"node_id": "5", "field": "inputs.scheduler"},
        "KSampler#5.denoise": {"node_id": "5", "field": "inputs.denoise"}
    }
}


# Basic Image-to-Image workflow
# Flow: LoadImage + Checkpoint -> VAE Encode -> KSampler -> VAE Decode -> Preview
DEFAULT_I2I_WORKFLOW = {
    "graph": {
        "1": {
            "inputs": {
                "ckpt_name": "v1-5-pruned-emaonly.safetensors"
            },
            "class_type": "CheckpointLoaderSimple",
            "_meta": {
                "title": "Load Checkpoint"
            }
        },
        "2": {
            "inputs": {
                "image": ""
            },
            "class_type": "LoadImage",
            "_meta": {
                "title": "Load Image"
            }
        },
        "3": {
            "inputs": {
                "pixels": ["2", 0],
                "vae": ["1", 2]
            },
            "class_type": "VAEEncode",
            "_meta": {
                "title": "VAE Encode"
            }
        },
        "4": {
            "inputs": {
                "text": "",
                "clip": ["1", 1]
            },
            "class_type": "CLIPTextEncode",
            "_meta": {
                "title": "Positive Prompt"
            }
        },
        "5": {
            "inputs": {
                "text": "",
                "clip": ["1", 1]
            },
            "class_type": "CLIPTextEncode",
            "_meta": {
                "title": "Negative Prompt"
            }
        },
        "6": {
            "inputs": {
                "seed": -1,
                "steps": 20,
                "cfg": 7,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 0.75,
                "model": ["1", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["3", 0]
            },
            "class_type": "KSampler",
            "_meta": {
                "title": "KSampler"
            }
        },
        "7": {
            "inputs": {
                "samples": ["6", 0],
                "vae": ["1", 2]
            },
            "class_type": "VAEDecode",
            "_meta": {
                "title": "VAE Decode"
            }
        },
        "8": {
            "inputs": {
                "images": ["7", 0]
            },
            "class_type": "PreviewImage",
            "_meta": {
                "title": "Preview Image"
            }
        }
    },
    "input_schema": {
        "CheckpointLoaderSimple#1.ckpt_name": {
            "type": "string",
            "title": "checkpoint",
            "default": "v1-5-pruned-emaonly.safetensors",
            "enum": [],
            "x_node_id": "1",
            "x_class_type": "CheckpointLoaderSimple",
            "x_title": "Load Checkpoint",
            "x_core": True
        },
        "LoadImage#2.image": {
            "type": "string",
            "title": "input image",
            "default": "",
            "widget": "image_upload",
            "enum": [],
            "x_node_id": "2",
            "x_class_type": "LoadImage",
            "x_title": "Load Image",
            "x_core": True
        },
        "CLIPTextEncode#4.text": {
            "type": "string",
            "title": "positive prompt",
            "default": "",
            "widget": "textarea",
            "x_node_id": "4",
            "x_class_type": "CLIPTextEncode",
            "x_title": "Positive Prompt",
            "x_core": True
        },
        "CLIPTextEncode#5.text": {
            "type": "string",
            "title": "negative prompt",
            "default": "",
            "widget": "textarea",
            "x_node_id": "5",
            "x_class_type": "CLIPTextEncode",
            "x_title": "Negative Prompt",
            "x_core": True
        },
        "KSampler#6.seed": {
            "type": "integer",
            "title": "seed",
            "default": -1,
            "minimum": -1,
            "maximum": 18446744073709551615,
            "x_node_id": "6",
            "x_class_type": "KSampler",
            "x_title": "KSampler",
            "x_core": True
        },
        "KSampler#6.steps": {
            "type": "integer",
            "title": "steps",
            "default": 20,
            "minimum": 1,
            "maximum": 10000,
            "x_node_id": "6",
            "x_class_type": "KSampler",
            "x_title": "KSampler",
            "x_core": True
        },
        "KSampler#6.cfg": {
            "type": "number",
            "title": "cfg",
            "default": 7,
            "minimum": 0,
            "maximum": 100,
            "step": 0.1,
            "x_node_id": "6",
            "x_class_type": "KSampler",
            "x_title": "KSampler",
            "x_core": True
        },
        "KSampler#6.sampler_name": {
            "type": "string",
            "title": "sampler",
            "default": "euler",
            "enum": [
                "euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral",
                "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral",
                "dpmpp_sde", "dpmpp_2m", "dpmpp_2m_sde", "ddim", "uni_pc"
            ],
            "x_node_id": "6",
            "x_class_type": "KSampler",
            "x_title": "KSampler",
            "x_core": True
        },
        "KSampler#6.scheduler": {
            "type": "string",
            "title": "scheduler",
            "default": "normal",
            "enum": ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform"],
            "x_node_id": "6",
            "x_class_type": "KSampler",
            "x_title": "KSampler",
            "x_core": True
        },
        "KSampler#6.denoise": {
            "type": "number",
            "title": "denoise",
            "default": 0.75,
            "minimum": 0,
            "maximum": 1,
            "step": 0.01,
            "x_node_id": "6",
            "x_class_type": "KSampler",
            "x_title": "KSampler",
            "x_core": True
        },
        "__node_order": ["1", "2", "3", "4", "5", "6", "7", "8"]
    },
    "node_mapping": {
        "CheckpointLoaderSimple#1.ckpt_name": {"node_id": "1", "field": "inputs.ckpt_name"},
        "LoadImage#2.image": {"node_id": "2", "field": "inputs.image"},
        "CLIPTextEncode#4.text": {"node_id": "4", "field": "inputs.text"},
        "CLIPTextEncode#5.text": {"node_id": "5", "field": "inputs.text"},
        "KSampler#6.seed": {"node_id": "6", "field": "inputs.seed"},
        "KSampler#6.steps": {"node_id": "6", "field": "inputs.steps"},
        "KSampler#6.cfg": {"node_id": "6", "field": "inputs.cfg"},
        "KSampler#6.sampler_name": {"node_id": "6", "field": "inputs.sampler_name"},
        "KSampler#6.scheduler": {"node_id": "6", "field": "inputs.scheduler"},
        "KSampler#6.denoise": {"node_id": "6", "field": "inputs.denoise"}
    }
}
