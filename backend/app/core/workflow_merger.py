
import copy
import logging
from dataclasses import dataclass, field
from typing import Dict, Any, List, Tuple, Optional

logger = logging.getLogger(__name__)

# Node types that can serve as image output bridges (source workflow)
IMAGE_OUTPUT_NODE_TYPES = [
    "SaveImage",
    "PreviewImage", 
    "SaveImageWebSocket",
    "VHS_VideoCombine",  # Video output node
]

# Node types that can serve as image input bridges (target workflow)
IMAGE_INPUT_NODE_TYPES = [
    "LoadImage",
    "LoadImageMask",
    "VHS_LoadVideo",
    "VHS_LoadImages",
    "LoadImageFromBase64",
]


@dataclass
class MergeResult:
    """Result of a workflow merge operation."""
    graph: Dict[str, Any]
    success: bool
    source_bridge_found: bool
    target_bridge_found: bool
    connections_made: int
    removed_nodes: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


class WorkflowMerger:
    """Utility for stitching two ComfyUI workflow graphs together safely."""

    @staticmethod
    def merge(graph_a: Dict[str, Any], graph_b: Dict[str, Any]) -> MergeResult:
        """
        Merges graph_b (Target) INTO graph_a (Source).
        Effectively: Source -> Target.
        
        Logic:
        1. Keep Source IDs as is.
        2. Offset Target IDs by a safe margin (e.g. max(Source) + 100).
        3. Identify "Bridge" points:
           - Source: Look for SaveImage, PreviewImage, or video output nodes.
           - Target: Look for LoadImage, LoadImageMask, VHS_LoadVideo, or similar.
        4. Rewire:
           - Find what Source's Image Saver was connected to (e.g. VAE Decode output).
           - Find what Target's Image Loader was connected to (e.g. VAE Encode input).
           - Connect Source Output -> Target Input directly.
           - Remove Target's Image Loader node.
           
        Returns:
            MergeResult with the merged graph and status information.
        """
        warnings: List[str] = []
        removed_nodes: List[str] = []

        # 1. ID Re-Mapping
        merged_graph: Dict[str, Any] = {}

        def get_max_id(g: Dict[str, Any]) -> int:
            if not g:
                return 0
            # Some graphs include non-numeric keys for metadata; filter them out
            ids = [int(k) for k in g.keys() if str(k).isdigit()]
            return max(ids) if ids else 0

        max_a = get_max_id(graph_a)
        offset = max_a + 100  # Safety buffer
        
        # Copy Source Nodes
        for nid, node in graph_a.items():
            merged_graph[nid] = copy.deepcopy(node)
            
        # Map Target Nodes
        target_map: Dict[str, str] = {}  # old_id -> new_id
        
        for nid, node in graph_b.items():
            new_id = str(int(nid) + offset)
            target_map[nid] = new_id
            
            new_node = copy.deepcopy(node)
            
            # Remap inputs (links) if they are lists
            inputs = new_node.get("inputs", {})
            for key, val in inputs.items():
                if isinstance(val, list) and len(val) == 2:
                    # It's a link: [node_id, slot_index]
                    old_link_node_id = str(val[0])
                    if old_link_node_id in target_map:
                        val[0] = target_map[old_link_node_id]
                    else:
                        # Apply offset for nodes not yet visited
                        val[0] = str(int(old_link_node_id) + offset)
                        
            merged_graph[new_id] = new_node

        # 2. Stitching Logic
        source_bridge_output: Optional[Tuple[str, int]] = None  # (node_id, slot_index)
        target_bridge_input_nodes: List[Tuple[str, str]] = []  # List of (node_id, input_name)
        
        # A. Find Source Bridge (The Image Producer)
        # Heuristic: Find an image output node in Source.
        # Take its "images" input link. That link leads to the actual Producer.
        source_saver_id: Optional[str] = None
        for nid, node in graph_a.items():
            if node.get("class_type") in IMAGE_OUTPUT_NODE_TYPES:
                source_saver_id = nid
                break
        
        if source_saver_id:
            saver_inputs = graph_a[source_saver_id].get("inputs", {})
            # Try common input names for image data
            image_link = saver_inputs.get("images") or saver_inputs.get("image") or saver_inputs.get("video")
            if isinstance(image_link, list) and len(image_link) >= 2:
                source_bridge_output = (str(image_link[0]), image_link[1])
                logger.info(f"Merging: Found Source Bridge at node {source_bridge_output[0]}, slot {source_bridge_output[1]}")
        
        if not source_bridge_output:
            warnings.append("Could not find a SaveImage/PreviewImage node in the source workflow to use as output bridge.")
        
        # B. Find Target Bridge (The Image Consumer)
        # Heuristic: Find an image loader node in Target.
        # Find all nodes that READS FROM this loader.
        target_loader_old_id: Optional[str] = None
        target_loader_class: Optional[str] = None
        for nid, node in graph_b.items():
            class_type = node.get("class_type")
            if class_type in IMAGE_INPUT_NODE_TYPES:
                target_loader_old_id = nid
                target_loader_class = class_type
                break
        
        if target_loader_old_id:
            target_loader_new_id = str(int(target_loader_old_id) + offset)
            
            # Search merged_graph for nodes that reference target_loader_new_id
            for nid, node in merged_graph.items():
                try:
                    if int(nid) < offset:
                        continue  # Skip source nodes
                except ValueError:
                    continue
                
                inputs = node.get("inputs", {})
                for input_name, val in inputs.items():
                    if isinstance(val, list) and len(val) >= 2:
                        # val is [link_node_id, link_slot_index]
                        if str(val[0]) == target_loader_new_id:
                            target_bridge_input_nodes.append((nid, input_name))
            
            # Remove the Image Loader node (replaced by direct connection)
            if target_loader_new_id in merged_graph:
                del merged_graph[target_loader_new_id]
                removed_nodes.append(target_loader_new_id)
                logger.info(f"Merging: Removed Target {target_loader_class} node {target_loader_new_id}")
        
        if not target_loader_old_id:
            warnings.append("Could not find a LoadImage or similar node in the target workflow to use as input bridge.")

        # 3. Apply Connection
        connections_made = 0
        if source_bridge_output and target_bridge_input_nodes:
            for (consumer_node_id, input_name) in target_bridge_input_nodes:
                # Update input to point to Source Producer
                # Use slot 0 as the standard IMAGE output slot
                merged_graph[consumer_node_id]["inputs"][input_name] = [
                    str(source_bridge_output[0]), 
                    0  # Always use slot 0 (IMAGE output) to avoid MASK slot issues
                ]
                connections_made += 1
            logger.info(f"Merging: Successfully stitched {connections_made} connections.")
        else:
            if source_bridge_output and not target_bridge_input_nodes:
                warnings.append("Found source output but no nodes in target consume from the image loader.")
            logger.warning("Merging: Could not auto-detect bridge points. Returning disconnected merge.")

        success = connections_made > 0
        
        return MergeResult(
            graph=merged_graph,
            success=success,
            source_bridge_found=source_bridge_output is not None,
            target_bridge_found=target_loader_old_id is not None,
            connections_made=connections_made,
            removed_nodes=removed_nodes,
            warnings=warnings,
        )
