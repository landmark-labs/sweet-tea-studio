"""
ComfyUI Launcher Service.
Provides ability to detect, configure, and launch ComfyUI from Sweet Tea Studio.
"""
import asyncio
import os
import signal
import subprocess
import time
from pathlib import Path
from typing import Optional, List
from dataclasses import dataclass
from datetime import datetime
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
        self._lock = asyncio.Lock()
        self._last_action_at: float = 0.0
        self._last_error: Optional[str] = None
        self._cooldown_seconds = 3.0
    
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
        if self._config.args is None:
            self._config.args = []
        return self._config

    def set_config(self, path: Optional[str], args: Optional[str]) -> dict:
        """Set a user-provided ComfyUI path and arguments."""
        config = LaunchConfig(args=[])

        if path:
            if not self._is_valid_comfyui_path(path):
                return {"success": False, "error": "Invalid ComfyUI path"}

            config.path = path
            config.is_available = True
            config.detection_method = "user_provided"
            config.python_path = self._find_python_for_comfyui(path)
        else:
            config = self.detect_comfyui()

        if args is not None:
            config.args = args.split() if args.strip() else []

        self._config = config

        return {
            "success": True,
            "config": config,
            "error": None if config.is_available else "ComfyUI not detected",
        }
    
    def is_running(self) -> bool:
        """Check if the managed ComfyUI process is running."""
        if self._process is None:
            return False
        return self._process.poll() is None

    def _cooldown_remaining(self) -> float:
        """How much cooldown time is left before we allow another toggle."""
        elapsed = time.time() - self._last_action_at
        remaining = self._cooldown_seconds - elapsed
        return max(0.0, remaining)

    def get_status(self) -> dict:
        """Return detailed status for the managed process."""
        config = self.get_config()
        return {
            "running": self.is_running(),
            "pid": self._process.pid if self._process else None,
            "available": config.is_available,
            "path": config.path,
            "detection_method": config.detection_method,
            "last_error": self._last_error,
            "last_action_at": datetime.fromtimestamp(self._last_action_at).isoformat()
            if self._last_action_at
            else None,
            "cooldown_remaining": round(self._cooldown_remaining(), 1),
        }
    
    async def launch(self, extra_args: Optional[List[str]] = None) -> dict:
        """Launch ComfyUI as a subprocess."""
        async with self._lock:
            config = self.get_config()

            cooldown_remaining = self._cooldown_remaining()
            if cooldown_remaining > 0:
                return {
                    "success": False,
                    "error": f"ComfyUI toggle is cooling down. Try again in {cooldown_remaining:.1f}s",
                    "cooldown_remaining": round(cooldown_remaining, 1),
                }

            if not config.is_available:
                self._last_error = "ComfyUI installation not found"
                return {
                    "success": False,
                    "error": self._last_error,
                    "detection_method": config.detection_method,
                }

            if self.is_running():
                return {
                    "success": True,
                    "message": "ComfyUI is already running",
                    "pid": self._process.pid,
                }

            try:
                python_exe = config.python_path or "python"
                main_py = str(Path(config.path) / "main.py")

                cmd = [python_exe, main_py]

                cmd.extend(["--port", str(config.port)])

                settings_args = getattr(settings, 'COMFYUI_ARGS', '')
                if settings_args:
                    cmd.extend(settings_args.split())

                if config.args:
                    cmd.extend(config.args)

                if extra_args:
                    cmd.extend(extra_args)

                self._process = subprocess.Popen(
                    cmd,
                    cwd=config.path,
                    # Use DEVNULL to prevent blocking - PIPE buffers fill up and block the process
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                )

                # Give it a bit more time to crash if there's an immediate error
                await asyncio.sleep(2)

                if self._process.poll() is not None:
                    exit_code = self._process.returncode
                    self._last_error = f"ComfyUI process exited immediately with code {exit_code}. Check ComfyUI logs or try running manually."
                    self._last_action_at = time.time()
                    return {
                        "success": False,
                        "error": self._last_error,
                    }

                self._last_action_at = time.time()
                self._last_error = None
                return {
                    "success": True,
                    "message": "ComfyUI launched successfully",
                    "pid": self._process.pid,
                    "path": config.path,
                }

            except Exception as e:
                self._last_error = str(e)
                self._last_action_at = time.time()
                return {
                    "success": False,
                    "error": self._last_error,
                }
    
    async def stop(self) -> dict:
        """Stop the managed ComfyUI process."""
        async with self._lock:
            cooldown_remaining = self._cooldown_remaining()
            if cooldown_remaining > 0:
                return {
                    "success": False,
                    "error": f"ComfyUI toggle is cooling down. Try again in {cooldown_remaining:.1f}s",
                    "cooldown_remaining": round(cooldown_remaining, 1),
                }

            if not self.is_running():
                self._last_action_at = time.time()
                self._last_error = None
                return {"success": True, "message": "ComfyUI was not running"}

            try:
                if os.name == 'nt':
                    self._process.terminate()
                else:
                    self._process.send_signal(signal.SIGTERM)

                try:
                    self._process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                    self._process.wait()

                self._last_action_at = time.time()
                self._last_error = None
                return {"success": True, "message": "ComfyUI stopped"}

            except Exception as e:
                self._last_action_at = time.time()
                self._last_error = str(e)
                return {"success": False, "error": self._last_error}
            finally:
                self._process = None


# Global launcher instance
comfy_launcher = ComfyUILauncher()
