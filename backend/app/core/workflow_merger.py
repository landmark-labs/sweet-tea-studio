
import logging
from typing import Dict, Any, Tuple

logger = logging.getLogger(__name__)

class WorkflowMerger:
    """Utility for stitching two ComfyUI workflow graphs together safely."""

    @staticmethod
    def merge(graph_a: Dict[str, Any], graph_b: Dict[str, Any]) -> Dict[str, Any]:
        """
        Merges graph_b (Target) INTO graph_a (Source).
        Effectively: Source -> Target.
        
        Logic:
        1. Keep Source IDs as is.
        2. Offset Target IDs by a safe margin (e.g. max(Source) + 1000).
        3. Identify "Bridge" points:
           - Source: Look for SaveImage or PreviewImage. The input image primarily.
           - Target: Look for LoadImage.
        4. Rewire:
           - Find what Source's Image Saver was connected to (e.g. VAE Decode output).
           - Find what Target's LoadImage was connected to (e.g. VAE Encode input).
           - Connect Source Output -> Target Input directly.
           - Remove Target's LoadImage node.
        """

        # 1. ID Re-Mapping
        merged_graph = {}

        # Helper to get max ID
        def get_max_id(g):
            if not g: return 0
            # Some graphs include non-numeric keys for metadata; filter them out to
            # avoid ValueErrors while computing the highest node id.
            ids = [int(k) for k in g.keys() if str(k).isdigit()] # Filters out potentially weird keys
            return max(ids) if ids else 0

        max_a = get_max_id(graph_a)
        # Offset target ids beyond the source id range so links cannot collide even
        # if the graphs were previously part of the same pipeline.
        offset = max_a + 100  # Safety buffer
        
        # Copy Source Nodes
        for nid, node in graph_a.items():
            merged_graph[nid] = node
            
        # Map Target Nodes
        target_map = {} # old_id -> new_id
        
        for nid, node in graph_b.items():
            new_id = str(int(nid) + offset)
            target_map[nid] = new_id
            
            # Deep copy node to modify
            import copy
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
                        # The link might point to a node we have not visited yet; apply
                        # the same offset math to preserve connectivity without
                        # waiting for a second pass.
                        val[0] = str(int(old_link_node_id) + offset)
                        
            merged_graph[new_id] = new_node

        # 2. Stitching Logic
        # Goal: Find Source Output (Image) -> Target Input (Image) replacement.
        
        source_bridge_output = None # (node_id, slot_index)
        target_bridge_input_nodes = [] # List of (node_id, input_name) that NEED the image
        
        # A. Find Source Bridge (The Image Producer)
        # Heuristic: Find a SaveImage/PreviewImage node in Source.
        # Take its "images" input link. That link leads to the actual Producer (e.g. VAE Decode).
        # We want to connect THAT Producer to the Target.
        
        # Find Last Node in Source
        # For now, just look for first SaveImageWebSocket or SaveImage
        source_saver_id = None
        for nid, node in graph_a.items():
            if node.get("class_type") in ["SaveImage", "PreviewImage", "SaveImageWebSocket"]:
                source_saver_id = nid
                break
        
        if source_saver_id:
            # Check what drives this saver
            saver_inputs = graph_a[source_saver_id].get("inputs", {})
            image_link = saver_inputs.get("images")
            if isinstance(image_link, list):
                # We found the source! 
                # image_link is [producer_id, slot_index]
                source_bridge_output = (image_link[0], image_link[1])
                logger.info(f"Merging: Found Source Bridge at {source_bridge_output}")
                
                # Optional: Remove the Source's Saver/Previewer?
                # Maybe keep it so user can see intermediate result? 
                # Let's KEEP it for now.
        
        # B. Find Target Bridge (The Image Consumer)
        # Heuristic: Find LoadImage node in Target.
        # Find who connects TO this LoadImage? No, LoadImage is a source.
        # Find who READS FROM this LoadImage.
        
        target_loader_old_id = None
        for nid, node in graph_b.items():
             if node.get("class_type") == "LoadImage":
                 target_loader_old_id = nid
                 break
        
        if target_loader_old_id:
            target_loader_new_id = str(int(target_loader_old_id) + offset)
            
            # Now search merged_graph for nodes that link TO target_loader_new_id
            for nid, node in merged_graph.items():
                if int(nid) < offset: continue # Skip source nodes
                
                inputs = node.get("inputs", {})
                for input_name, val in inputs.items():
                    if isinstance(val, list):
                        # val is [link_node_id, link_slot_index]
                        if str(val[0]) == target_loader_new_id:
                            # FOUND A CONSUMER
                            target_bridge_input_nodes.append((nid, input_name))
            
            # Remove the LoadImage node from merged graph (it's replaced by connection)
            if target_loader_new_id in merged_graph:
                del merged_graph[target_loader_new_id]
                logger.info(f"Merging: Removed Target LoadImage node {target_loader_new_id}")

        # 3. Apply Connection
        if source_bridge_output and target_bridge_input_nodes:
            for (consumer_node_id, input_name) in target_bridge_input_nodes:
                # Update input to point to Source Producer
                merged_graph[consumer_node_id]["inputs"][input_name] = [
                    str(source_bridge_output[0]), 
                    source_bridge_output[1]
                ]
            logger.info(f"Merging: Successfully stitched {len(target_bridge_input_nodes)} connections.")
        else:
            logger.warning("Merging: Could not auto-detect bridge points. Returning disconnected merge.")

        return merged_graph
