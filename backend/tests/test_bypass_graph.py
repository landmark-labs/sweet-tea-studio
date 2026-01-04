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
