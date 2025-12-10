"""
ComfyUI Launcher Service.
Provides ability to detect, configure, and launch ComfyUI from Sweet Tea Studio.
"""
import asyncio
import os
import subprocess
import signal
from pathlib import Path
from typing import Optional, List
from dataclasses import dataclass
from app.core.config import settings


@dataclass
class LaunchConfig:
    """Configuration for launching ComfyUI."""
    path: Optional[str] = None  # Path to ComfyUI directory
    python_path: Optional[str] = None  # Python executable path
    args: List[str] = None  # Additional arguments
    port: int = 8188  # ComfyUI port
    is_available: bool = False  # Whether ComfyUI can be launched
    detection_method: str = ""  # How we found ComfyUI


class ComfyUILauncher:
    """Manages ComfyUI process lifecycle."""
    
    def __init__(self):
        self._process: Optional[subprocess.Popen] = None
        self._config: Optional[LaunchConfig] = None
    
    def detect_comfyui(self) -> LaunchConfig:
        """Detect ComfyUI installation paths."""
        config = LaunchConfig(args=[])
        
        # Check environment variable first
        env_path = os.environ.get("COMFYUI_PATH")
        if env_path and self._is_valid_comfyui_path(env_path):
            config.path = env_path
            config.is_available = True
            config.detection_method = "environment_variable"
            config.python_path = self._find_python_for_comfyui(env_path)
            self._config = config
            return config
        
        # Check settings
        settings_path = getattr(settings, 'COMFYUI_PATH', None)
        if settings_path and self._is_valid_comfyui_path(settings_path):
            config.path = settings_path
            config.is_available = True
            config.detection_method = "settings"
            config.python_path = self._find_python_for_comfyui(settings_path)
            self._config = config
            return config
        
        # Try common paths
        possible_paths = [
            Path.home() / "ComfyUI",
            Path("C:/Users/jkoti/sd/Data/Packages/ComfyUI"),
            Path("/workspace/ComfyUI"),
            Path("~/stable-diffusion/ComfyUI").expanduser(),
        ]
        
        for p in possible_paths:
            if self._is_valid_comfyui_path(str(p)):
                config.path = str(p)
                config.is_available = True
                config.detection_method = f"path_scan:{p}"
                config.python_path = self._find_python_for_comfyui(str(p))
                self._config = config
                return config
        
        # Not found
        config.is_available = False
        config.detection_method = "not_found"
        self._config = config
        return config
    
    def _is_valid_comfyui_path(self, path_str: str) -> bool:
        """Check if a path contains a valid ComfyUI installation."""
        path = Path(path_str)
        if not path.exists():
            return False
        
        # Check for main.py (the entry point)
        main_py = path / "main.py"
        if main_py.exists():
            return True
        
        # Check for comfy folder (core modules)
        comfy_folder = path / "comfy"
        if comfy_folder.exists() and comfy_folder.is_dir():
            return True
        
        return False
    
    def _find_python_for_comfyui(self, comfyui_path: str) -> Optional[str]:
        """Find the appropriate Python executable for ComfyUI."""
        comfy_dir = Path(comfyui_path)
        
        # Check for venv in ComfyUI directory
        venv_candidates = [
            comfy_dir / "venv" / "Scripts" / "python.exe",  # Windows
            comfy_dir / "venv" / "bin" / "python",  # Linux/Mac
            comfy_dir / ".venv" / "Scripts" / "python.exe",
            comfy_dir / ".venv" / "bin" / "python",
        ]
        
        for venv in venv_candidates:
            if venv.exists():
                return str(venv)
        
        # Check parent directory for venv (common setup)
        parent_venv = [
            comfy_dir.parent / "venv" / "Scripts" / "python.exe",
            comfy_dir.parent / "venv" / "bin" / "python",
        ]
        
        for venv in parent_venv:
            if venv.exists():
                return str(venv)
        
        # Fall back to system Python
        return "python"
    
    def get_config(self) -> LaunchConfig:
        """Get current launch configuration."""
        if not self._config:
            return self.detect_comfyui()
        return self._config
    
    def is_running(self) -> bool:
        """Check if the managed ComfyUI process is running."""
        if self._process is None:
            return False
        return self._process.poll() is None
    
    async def launch(self, extra_args: Optional[List[str]] = None) -> dict:
        """Launch ComfyUI as a subprocess."""
        config = self.get_config()
        
        if not config.is_available:
            return {
                "success": False,
                "error": "ComfyUI installation not found",
                "detection_method": config.detection_method,
            }
        
        if self.is_running():
            return {
                "success": True,
                "message": "ComfyUI is already running",
                "pid": self._process.pid,
            }
        
        try:
            # Build command
            python_exe = config.python_path or "python"
            main_py = str(Path(config.path) / "main.py")
            
            cmd = [python_exe, main_py]
            
            # Add port argument
            cmd.extend(["--port", str(config.port)])
            
            # Add settings args
            settings_args = getattr(settings, 'COMFYUI_ARGS', '')
            if settings_args:
                cmd.extend(settings_args.split())
            
            # Add extra args
            if extra_args:
                cmd.extend(extra_args)
            
            # Launch process
            self._process = subprocess.Popen(
                cmd,
                cwd=config.path,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                # Don't create console window on Windows
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
            )
            
            # Wait a moment to check if it started successfully
            await asyncio.sleep(1)
            
            if self._process.poll() is not None:
                # Process already exited
                _, stderr = self._process.communicate()
                return {
                    "success": False,
                    "error": f"ComfyUI failed to start: {stderr.decode()[:500]}",
                }
            
            return {
                "success": True,
                "message": "ComfyUI launched successfully",
                "pid": self._process.pid,
                "path": config.path,
            }
        
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
    
    def stop(self) -> dict:
        """Stop the managed ComfyUI process."""
        if not self.is_running():
            return {"success": True, "message": "ComfyUI was not running"}
        
        try:
            # Send graceful shutdown signal
            if os.name == 'nt':
                self._process.terminate()
            else:
                self._process.send_signal(signal.SIGTERM)
            
            # Wait for process to end
            try:
                self._process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                # Force kill if it doesn't respond
                self._process.kill()
                self._process.wait()
            
            return {"success": True, "message": "ComfyUI stopped"}
        
        except Exception as e:
            return {"success": False, "error": str(e)}
        finally:
            self._process = None


# Global launcher instance
comfy_launcher = ComfyUILauncher()
