from app.services.job_processor import apply_bypass_to_graph


def test_bypass_rewires_matching_type_output():
    graph = {
        "10": {
            "class_type": "LoadImage",
            "inputs": {"image": "example.png"},
        },
        "11": {
            "class_type": "ImageScaleBy",
            "inputs": {"image": ["10", 0], "scale": 0.5},
        },
        "12": {
            "class_type": "SomeConsumer",
            "inputs": {"image": ["11", 0]},
        },
    }

    object_info = {
        "ImageScaleBy": {
            "input": {
                "required": {
                    "image": ["IMAGE", {}],
                    "scale": ["FLOAT", {"default": 1.0}],
                }
            },
            "output": ["IMAGE"],
        }
    }

    apply_bypass_to_graph(graph, ["11"], object_info=object_info)

    assert "11" not in graph
    assert graph["12"]["inputs"]["image"] == ["10", 0]


def test_bypass_disconnects_when_no_type_match():
    graph = {
        "2": {
            "class_type": "ImageScaleBy",
            "inputs": {"image": ["10", 0], "scale": 1.0},
        },
        "3": {
            "class_type": "CLIPVisionEncode",
            "inputs": {"clip_vision": ["4", 0], "image": ["2", 0]},
        },
        "5": {
            "class_type": "WanFirsttoLastFrame",
            "inputs": {"clip_vision": ["3", 0]},
        },
    }

    object_info = {
        "ImageScaleBy": {
            "input": {"required": {"image": ["IMAGE", {}], "scale": ["FLOAT", {"default": 1.0}]}},
            "output": ["IMAGE"],
        },
        "CLIPVisionEncode": {
            "input": {"required": {"clip_vision": ["CLIP_VISION", {}], "image": ["IMAGE", {}]}},
            "output": ["CLIP_VISION_OUTPUT"],
        },
    }

    apply_bypass_to_graph(graph, ["3"], object_info=object_info)

    assert "3" not in graph
    assert "clip_vision" not in graph["5"]["inputs"]


def test_bypass_disconnects_when_node_type_missing_from_object_info():
    graph = {
        "10": {
            "class_type": "LoadImage",
            "inputs": {"image": "example.png"},
        },
        "11": {
            "class_type": "CustomScaleNode",
            "inputs": {"image": ["10", 0]},
        },
        "12": {
            "class_type": "SomeConsumer",
            "inputs": {"image": ["11", 0]},
        },
    }

    object_info = {
        # Intentionally omit CustomScaleNode to simulate missing object_info.
        "LoadImage": {"output": ["IMAGE"], "input": {"required": {"image": ["IMAGE", {}]}}},
        "SomeConsumer": {"input": {"required": {"image": ["IMAGE", {}]}}, "output": ["IMAGE"]},
    }

    apply_bypass_to_graph(graph, ["11"], object_info=object_info)

    assert "11" not in graph
    assert "image" not in graph["12"]["inputs"]


def test_bypass_cascade_multiple_nodes():
    """
    Bypass multiple nodes in a chain: A → B → C → D where B and C are bypassed.
    
    Graph: LoadImage (10) → ImageScale (11) → ImageScale (12) → Consumer (13)
    Bypass nodes 11 and 12. Consumer should point directly to LoadImage (10).
    """
    graph = {
        "10": {"class_type": "LoadImage", "inputs": {"image": "test.png"}},
        "11": {"class_type": "ImageScale", "inputs": {"image": ["10", 0], "scale": 0.5}},
        "12": {"class_type": "ImageScale", "inputs": {"image": ["11", 0], "scale": 0.5}},
        "13": {"class_type": "SomeConsumer", "inputs": {"image": ["12", 0]}},
    }

    object_info = {
        "ImageScale": {
            "input": {"required": {"image": ["IMAGE", {}], "scale": ["FLOAT", {}]}},
            "output": ["IMAGE"],
        }
    }

    apply_bypass_to_graph(graph, ["11", "12"], object_info=object_info)

    # Both bypassed nodes should be removed
    assert "11" not in graph
    assert "12" not in graph
    # Consumer should point directly to LoadImage, skipping both scaled nodes
    assert graph["13"]["inputs"]["image"] == ["10", 0]


def test_bypass_cascade_with_type_mismatch():
    """
    Cascade bypass where the middle node has a type mismatch.
    
    Graph: LoadImage (10) → ImageScale (11) → CLIPVisionEncode (12) → Consumer (13)
    CLIPVisionEncode: IMAGE input → CLIP_VISION_OUTPUT output (no pass-through possible)
    
    When bypassing both 11 and 12, consumer's clip_vision input should be disconnected
    because there's no valid pass-through path.
    """
    graph = {
        "10": {"class_type": "LoadImage", "inputs": {"image": "test.png"}},
        "11": {"class_type": "ImageScale", "inputs": {"image": ["10", 0], "scale": 0.5}},
        "12": {"class_type": "CLIPVisionEncode", "inputs": {"image": ["11", 0], "clip_vision": ["50", 0]}},
        "13": {"class_type": "SomeConsumer", "inputs": {"clip_vision_output": ["12", 0]}},
    }

    object_info = {
        "ImageScale": {
            "input": {"required": {"image": ["IMAGE", {}], "scale": ["FLOAT", {}]}},
            "output": ["IMAGE"],
        },
        "CLIPVisionEncode": {
            "input": {"required": {"image": ["IMAGE", {}], "clip_vision": ["CLIP_VISION", {}]}},
            "output": ["CLIP_VISION_OUTPUT"],
        },
    }

    apply_bypass_to_graph(graph, ["11", "12"], object_info=object_info)

    # Both bypassed nodes should be removed
    assert "11" not in graph
    assert "12" not in graph
    # Consumer's input should be disconnected (no valid pass-through for CLIP_VISION_OUTPUT)
    assert "clip_vision_output" not in graph["13"]["inputs"]



def test_bypass_does_not_passthrough_any_typed_inputs():
    graph = {
        "1": {
            "class_type": "IntConstant",
            "inputs": {"value": 7},
        },
        "2": {
            "class_type": "CustomToImage",
            "inputs": {"value": ["1", 0]},
        },
        "3": {
            "class_type": "SomeConsumer",
            "inputs": {"image": ["2", 0]},
        },
    }

    object_info = {
        "IntConstant": {"output": ["INT"], "input": {"required": {"value": ["INT", {"default": 0}]}}},
        "CustomToImage": {"output": ["IMAGE"], "input": {"required": {"value": ["ANY", {}]}}},
        "SomeConsumer": {"input": {"required": {"image": ["IMAGE", {}]}}, "output": ["IMAGE"]},
    }

    apply_bypass_to_graph(graph, ["2"], object_info=object_info)

    assert "2" not in graph
    assert "image" not in graph["3"]["inputs"]


def test_bypass_controlnet_apply_preserves_positive_negative_outputs():
    """
    Regression: ControlNetApplyAdvanced outputs two CONDITIONING values (positive, negative).

    When bypassed, Sweet Tea must not map *both* outputs to the first conditioning input.
    The bypass pass-through should preserve the slot semantics:
      output[0] -> positive input
      output[1] -> negative input
    """
    graph = {
        "10": {"class_type": "PosCond", "inputs": {}},
        "11": {"class_type": "NegCond", "inputs": {}},
        "12": {"class_type": "ControlNet", "inputs": {}},
        "13": {"class_type": "LoadImage", "inputs": {"image": "example.png"}},
        "20": {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": ["10", 0],
                "negative": ["11", 0],
                "control_net": ["12", 0],
                "image": ["13", 0],
            },
        },
        "30": {
            "class_type": "UltimateConsumer",
            "inputs": {
                "positive": ["20", 0],
                "negative": ["20", 1],
            },
        },
    }

    object_info = {
        "ControlNetApplyAdvanced": {
            "input": {
                "required": {
                    "positive": ["CONDITIONING", {}],
                    "negative": ["CONDITIONING", {}],
                    "control_net": ["CONTROL_NET", {}],
                    "image": ["IMAGE", {}],
                }
            },
            "output": ["CONDITIONING", "CONDITIONING"],
            "output_name": ["positive", "negative"],
        }
    }

    apply_bypass_to_graph(graph, ["20"], object_info=object_info)

    assert "20" not in graph
    assert graph["30"]["inputs"]["positive"] == ["10", 0]
    assert graph["30"]["inputs"]["negative"] == ["11", 0]


def test_bypass_wan_optional_end_inputs_disconnected():
    """
    Regression for Wan workflows where the end-image branch is bypassed.

    In this graph, the bypassed nodes have inputs ordered such that the first
    linked input is *not* the one matching the output type (e.g. width/height
    before images). Bypass should still disconnect Wan optional end inputs
    instead of rewiring them to INT/CLIP_VISION links.
    """
    graph = {
        "376": {"class_type": "easy int", "inputs": {"value": 1280}},
        "377": {"class_type": "easy int", "inputs": {"value": 720}},
        "480": {"class_type": "LoadImage", "inputs": {"image": "null_frame2.png"}},
        "264": {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": "clip.safetensors"}},
        # Deliberately order inputs: width/height first, images last.
        "167": {
            "class_type": "easy imageScaleDown",
            "inputs": {
                "width": ["376", 0],
                "height": ["377", 0],
                "crop": "center",
                "images": ["480", 0],
            },
        },
        # Deliberately order inputs: crop first, then clip_vision, then image.
        "265": {
            "class_type": "CLIPVisionEncode",
            "inputs": {
                "crop": "center",
                "clip_vision": ["264", 0],
                "image": ["167", 0],
            },
        },
        "297": {
            "class_type": "WanFirstLastFrameToVideo",
            "inputs": {
                "end_image": ["167", 0],
                "clip_vision_end_image": ["265", 0],
            },
        },
    }

    object_info = {
        "LoadImage": {
            "input": {"required": {"image": [["example.png"], {}]}},
            "output": ["IMAGE", "MASK"],
        },
        "easy imageScaleDown": {
            "input": {
                "required": {
                    "images": ["IMAGE", {}],
                    "width": ["INT", {}],
                    "height": ["INT", {}],
                    "crop": [["disabled", "center"], {}],
                }
            },
            "output": ["IMAGE"],
        },
        "CLIPVisionEncode": {
            "input": {
                "required": {
                    "clip_vision": ["CLIP_VISION", {}],
                    "image": ["IMAGE", {}],
                    "crop": [["center", "none"], {}],
                }
            },
            "output": ["CLIP_VISION_OUTPUT"],
        },
        "CLIPVisionLoader": {
            "input": {"required": {"clip_name": [["clip.safetensors"], {}]}},
            "output": ["CLIP_VISION"],
        },
        "easy int": {"input": {"required": {"value": ["INT", {}]}}, "output": ["INT"]},
        "WanFirstLastFrameToVideo": {
            "input": {
                "required": {"width": ["INT", {}], "height": ["INT", {}]},
                "optional": {"end_image": ["IMAGE", {}], "clip_vision_end_image": ["CLIP_VISION_OUTPUT", {}]},
            },
            "output": ["LATENT"],
        },
    }

    apply_bypass_to_graph(graph, ["480", "167", "265"], object_info=object_info)

    assert "480" not in graph
    assert "167" not in graph
    assert "265" not in graph
    assert "end_image" not in graph["297"]["inputs"]
    assert "clip_vision_end_image" not in graph["297"]["inputs"]
