"""
ComfyUI Diagnostics Module
==========================
Drop-in diagnostic wrapper for tracking all ComfyUI communication.

Provides detailed logging of:
- Request payloads sent to ComfyUI (final graph structure)
- WebSocket messages received (progress, errors, previews)
- Parameter validation issues (missing/empty values)
- Execution timeline and errors

Usage:
    1. Import the diagnostic client in jobs.py:
       from app.core.comfy_diagnostics import DiagnosticComfyClient as ComfyClient
    
    2. Run generations and check:
       - backend/logs/comfy_diagnostics.log (structured log)
       - backend/logs/sent_graphs/ (individual graph JSON files)
       - backend/logs/ws_messages/ (WebSocket message history)
"""

import json
import os
import time
import struct
import base64
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional, Callable
# Conditional import - allows running analysis without full dependencies
try:
    from app.core.comfy_client import ComfyClient, ComfyConnectionError, ComfyResponseError
    HAS_COMFY_CLIENT = True
except ImportError:
    HAS_COMFY_CLIENT = False
    ComfyClient = object  # Placeholder for type hints
    class ComfyConnectionError(Exception): pass
    class ComfyResponseError(Exception): pass

# Log directory setup
LOG_DIR = Path(__file__).parent.parent.parent / "logs"
GRAPH_DIR = LOG_DIR / "sent_graphs"
WS_DIR = LOG_DIR / "ws_messages"
MAIN_LOG = LOG_DIR / "comfy_diagnostics.log"
MAX_WS_MESSAGES = int(os.getenv("SWEET_TEA_DIAG_MAX_WS_MESSAGES", "2000"))

# Ensure directories exist
LOG_DIR.mkdir(exist_ok=True)
GRAPH_DIR.mkdir(exist_ok=True)
WS_DIR.mkdir(exist_ok=True)


def _ts() -> str:
    """Compact timestamp for log lines."""
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


def _log(msg: str, level: str = "INFO"):
    """Append to main log file and print."""
    line = f"[{_ts()}] [{level}] {msg}"
    print(line)
    with open(MAIN_LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def validate_graph(graph: Dict[str, Any]) -> List[str]:
    """
    Validate a ComfyUI graph for common issues.
    Returns list of warning/error messages.
    """
    issues = []
    
    # Known critical input types that often cause failures
    CRITICAL_INPUTS = {
        "ckpt_name": "Checkpoint",
        "sampler_name": "Sampler", 
        "scheduler": "Scheduler",
        "vae_name": "VAE",
        "lora_name": "LoRA",
    }
    
    for node_id, node in graph.items():
        node_type = node.get("class_type", "Unknown")
        inputs = node.get("inputs", {})
        
        # Check for empty/null critical inputs
        for input_key, input_val in inputs.items():
            # Skip connection references (lists like [node_id, slot])
            if isinstance(input_val, list):
                continue
                
            # Check for empty strings or None
            if input_val is None or (isinstance(input_val, str) and input_val.strip() == ""):
                friendly_name = CRITICAL_INPUTS.get(input_key, input_key)
                issues.append(f"Node {node_id} ({node_type}): '{input_key}' ({friendly_name}) is EMPTY")
            
            # Check for placeholder values
            if isinstance(input_val, str) and input_val in ["None", "null", "undefined"]:
                issues.append(f"Node {node_id} ({node_type}): '{input_key}' has placeholder value '{input_val}'")
    
    return issues


class DiagnosticComfyClient(ComfyClient):
    """
    Wrapper around ComfyClient that logs all communication.
    Drop-in replacement - just change the import.
    """
    
    def __init__(self, engine):
        super().__init__(engine)
        self._current_job_id: Optional[str] = None
        self._ws_messages: List[Dict] = []
        self._start_time: Optional[float] = None
        _log(f"DiagnosticComfyClient initialized for engine: {engine.base_url}")
    
    def queue_prompt(self, prompt: Dict[str, Any]) -> str:
        """Submit workflow with full logging."""
        self._start_time = time.time()
        self._ws_messages = []
        
        # Generate unique job ID for this submission
        job_id = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        self._current_job_id = job_id
        
        _log(f"=" * 60, "INFO")
        _log(f"NEW GENERATION REQUEST - Job ID: {job_id}", "INFO")
        _log(f"=" * 60, "INFO")
        
        # Validate before sending
        issues = validate_graph(prompt)
        if issues:
            _log(f"⚠️  VALIDATION WARNINGS ({len(issues)} issues found):", "WARN")
            for issue in issues:
                _log(f"   - {issue}", "WARN")
        else:
            _log("✅ Graph validation passed - all critical inputs populated", "INFO")
        
        # Save the graph to file for inspection
        graph_file = GRAPH_DIR / f"{job_id}_graph.json"
        with open(graph_file, "w", encoding="utf-8") as f:
            json.dump(prompt, f, indent=2, default=str)
        _log(f"📄 Graph saved to: {graph_file}", "INFO")
        
        # Log graph summary
        node_types = [n.get("class_type", "Unknown") for n in prompt.values()]
        _log(f"📊 Graph contains {len(prompt)} nodes: {', '.join(set(node_types))}", "INFO")
        
        # Log critical parameter values
        for node_id, node in prompt.items():
            node_type = node.get("class_type", "")
            inputs = node.get("inputs", {})
            
            # Log checkpoint loader details
            if "Checkpoint" in node_type or "Load" in node_type:
                _log(f"   🔧 [{node_id}] {node_type}:", "INFO")
                for k, v in inputs.items():
                    if not isinstance(v, list):
                        _log(f"      {k}: {repr(v)}", "INFO")
            
            # Log sampler details
            if "Sampler" in node_type or "KSampler" in node_type:
                _log(f"   🎲 [{node_id}] {node_type}:", "INFO")
                for k in ["seed", "sampler_name", "scheduler", "steps", "cfg"]:
                    if k in inputs and not isinstance(inputs[k], list):
                        _log(f"      {k}: {repr(inputs[k])}", "INFO")
        
        try:
            prompt_id = super().queue_prompt(prompt)
            _log(f"✅ Queued successfully. ComfyUI prompt_id: {prompt_id}", "INFO")
            return prompt_id
        except ComfyResponseError as e:
            _log(f"❌ ComfyUI REJECTED the graph: {e}", "ERROR")
            # Parse and log the error details
            try:
                error_text = str(e)
                if "node_type" in error_text.lower() or "input" in error_text.lower():
                    _log("   This appears to be a node type or input validation error", "ERROR")
            except:
                pass
            raise
        except ComfyConnectionError as e:
            _log(f"❌ Connection failed: {e}", "ERROR")
            raise
    
    def get_images(self, prompt_id: str, progress_callback: Optional[Callable] = None) -> List[Dict[str, Any]]:
        """Get images with full WebSocket message logging."""
        
        def logging_callback(data: Dict):
            """Wrapper callback that logs then passes through."""
            elapsed = time.time() - (self._start_time or time.time())
            
            # Store message
            msg_record = {
                "elapsed_s": round(elapsed, 2),
                "data": data
            }
            self._ws_messages.append(msg_record)
            if len(self._ws_messages) > MAX_WS_MESSAGES:
                self._ws_messages = self._ws_messages[-MAX_WS_MESSAGES:]
            
            msg_type = data.get("type", "unknown")
            
            # Log based on message type
            if msg_type == "progress":
                prog_data = data.get("data", {})
                value = prog_data.get("value", 0)
                max_val = prog_data.get("max", 1)
                pct = (value / max_val * 100) if max_val else 0
                _log(f"📈 Progress: {value}/{max_val} ({pct:.0f}%) @ {elapsed:.1f}s", "INFO")
            
            elif msg_type == "executing":
                node_id = data.get("data", {}).get("node")
                if node_id:
                    _log(f"⚙️  Executing node: {node_id} @ {elapsed:.1f}s", "INFO")
                else:
                    _log(f"⚙️  Execution starting @ {elapsed:.1f}s", "INFO")
            
            elif msg_type == "execution_start":
                _log(f"🚀 Execution started @ {elapsed:.1f}s", "INFO")
            
            elif msg_type == "execution_cached":
                nodes = data.get("data", {}).get("nodes", [])
                _log(f"💾 Cached nodes: {nodes} @ {elapsed:.1f}s", "INFO")
            
            elif msg_type == "execution_error":
                err_data = data.get("data", {})
                node_id = err_data.get("node_id", "?")
                node_type = err_data.get("node_type", "?")
                exc_msg = err_data.get("exception_message", "Unknown")
                _log(f"❌ EXECUTION ERROR in node {node_id} ({node_type}): {exc_msg}", "ERROR")
                _log(f"   Full error data: {json.dumps(err_data, indent=2, default=str)}", "ERROR")
            
            elif msg_type == "preview":
                blob = data.get("data", {}).get("blob", "")
                blob_size = len(blob) if blob else 0
                _log(f"🖼️  Preview received ({blob_size} bytes) @ {elapsed:.1f}s", "INFO")
            
            elif msg_type == "status":
                status = data.get("status", data.get("data", {}).get("status", {}))
                _log(f"📋 Status: {status} @ {elapsed:.1f}s", "INFO")
            
            else:
                _log(f"📨 WS Message [{msg_type}]: {json.dumps(data, default=str)[:200]}", "DEBUG")
            
            # Call through to original callback if provided
            if progress_callback:
                progress_callback(data)
        
        try:
            _log(f"🎧 Starting to listen for prompt_id: {prompt_id}", "INFO")
            images = super().get_images(prompt_id, progress_callback=logging_callback)
            
            elapsed = time.time() - (self._start_time or time.time())
            _log(f"✅ Generation complete! {len(images)} images received in {elapsed:.1f}s", "INFO")
            
            # Log image details
            for i, img in enumerate(images):
                _log(f"   Image {i+1}: {img.get('filename', 'unknown')} ({img.get('type', '?')})", "INFO")
            
            # Save WebSocket message history
            ws_file = WS_DIR / f"{self._current_job_id}_ws.json"
            with open(ws_file, "w", encoding="utf-8") as f:
                json.dump(self._ws_messages, f, indent=2, default=str)
            _log(f"📄 WS history saved to: {ws_file}", "INFO")
            
            return images
            
        except ComfyResponseError as e:
            _log(f"❌ Execution error: {e}", "ERROR")
            # Save partial WS history
            ws_file = WS_DIR / f"{self._current_job_id}_ws_error.json"
            with open(ws_file, "w", encoding="utf-8") as f:
                json.dump(self._ws_messages, f, indent=2, default=str)
            raise
        
        except ComfyConnectionError as e:
            _log(f"❌ Connection lost: {e}", "ERROR")
            ws_file = WS_DIR / f"{self._current_job_id}_ws_disconnected.json"
            with open(ws_file, "w", encoding="utf-8") as f:
                json.dump(self._ws_messages, f, indent=2, default=str)
            raise


# Convenience function to analyze recent logs
def analyze_recent_failures(limit: int = 5):
    """Analyze the most recent generation attempts and summarize issues."""
    print("\n" + "=" * 60)
    print("RECENT GENERATION ANALYSIS")
    print("=" * 60)
    
    # Find recent graphs
    graphs = sorted(GRAPH_DIR.glob("*.json"), reverse=True)[:limit]
    
    for graph_file in graphs:
        job_id = graph_file.stem.replace("_graph", "")
        print(f"\n📁 Job: {job_id}")
        
        with open(graph_file) as f:
            graph = json.load(f)
        
        issues = validate_graph(graph)
        if issues:
            print(f"   ⚠️  {len(issues)} validation issues:")
            for issue in issues[:5]:
                print(f"      - {issue}")
        else:
            print("   ✅ Graph validated OK")
        
        # Check for corresponding WS log
        ws_file = WS_DIR / f"{job_id}_ws.json"
        ws_error_file = WS_DIR / f"{job_id}_ws_error.json"
        
        if ws_error_file.exists():
            print("   ❌ Ended with ERROR")
            with open(ws_error_file) as f:
                ws_msgs = json.load(f)
            for msg in ws_msgs:
                if msg.get("data", {}).get("type") == "execution_error":
                    print(f"      Error: {msg['data'].get('data', {}).get('exception_message', '?')}")
        elif ws_file.exists():
            print("   ✅ Completed successfully")
        else:
            print("   ❓ No WS log found (may have failed early)")
    
    print("\n" + "=" * 60)


if __name__ == "__main__":
    analyze_recent_failures()
