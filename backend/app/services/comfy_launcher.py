"""
ComfyUI Launcher Service.
Provides ability to detect, configure, and launch ComfyUI from Sweet Tea Studio.
"""
import asyncio
import os
import signal
import subprocess
import time
import tempfile
import psutil
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
        self._log_file: Optional[Path] = None
        self._log_handle = None

    def get_logs(self, lines: int = 100) -> str:
        """Get the tail of the log file."""
        if not self._log_file or not self._log_file.exists():
            # Fallback to temp dir guess if not yet launched
            log_path = Path(tempfile.gettempdir()) / "comfyui_sweet_tea.log"
            if not log_path.exists():
                return ""
            return self._tail_file(log_path, lines)
        
        return self._tail_file(self._log_file, lines)

    def _tail_file(self, path: Path, n: int) -> str:
        """Read last n lines of a file."""
        try:
            # Simple implementation for small N
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                # Read all lines is expensive if file is huge, but seek is complex with variably sized lines
                # For a tail of 100-500 lines, reading mostly works unless file is GBs. 
                # Optimization: seek to end minus X bytes.
                
                f.seek(0, 2)
                fsize = f.tell()
                f.seek(max(fsize - 100000, 0), 0) # Read last 100KB
                lines_data = f.readlines()
                return "".join(lines_data[-n:])
        except Exception:
            return "Error reading log file"
    
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
    
    def _find_process_by_port(self, port: int) -> Optional[psutil.Process]:
        """Find the process listening on a specific port."""
        for proc in psutil.process_iter(['pid', 'name']):
            if proc.pid == 0:
                continue
            try:
                for conn in proc.connections(kind='inet'):
                    if conn.laddr.port == port and conn.status == psutil.CONN_LISTEN:
                        return proc
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass
        return None

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
        # Check managed child process
        if self._process is not None:
            if self._process.poll() is None:
                return True

        # Check for any process on the configured port
        if self._config and self._config.port:
            proc = self._find_process_by_port(self._config.port)
            if proc:
                return True
        return False

    def _cooldown_remaining(self) -> float:
        """How much cooldown time is left before we allow another toggle."""
        elapsed = time.time() - self._last_action_at
        remaining = self._cooldown_seconds - elapsed
        return max(0.0, remaining)

    def get_status(self) -> dict:
        """Return detailed status for the managed process."""
        config = self.get_config()
        running = self.is_running()
        
        pid = None
        if self._process and self._process.poll() is None:
            pid = self._process.pid
        elif running and config.port:
             proc = self._find_process_by_port(config.port)
             if proc:
                 pid = proc.pid

        return {
            "running": running,
            "pid": pid,
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

                # Setup logging
                log_dir = Path(tempfile.gettempdir())
                self._log_file = log_dir / "comfyui_sweet_tea.log"
                
                # Open log file in append mode
                self._log_handle = open(self._log_file, "a", encoding="utf-8")
                self._log_handle.write(f"\n\n--- ComfyUI Launch {datetime.now().isoformat()} ---\n")
                self._log_handle.flush()

                self._process = subprocess.Popen(
                    cmd,
                    cwd=config.path,
                    stdout=self._log_handle,
                    stderr=subprocess.STDOUT,  # Redirect stderr to stdout
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
                # If we have a handle, use it
                if self._process:
                    if os.name == 'nt':
                        self._process.terminate()
                    else:
                        self._process.send_signal(signal.SIGTERM)
                    try:
                        self._process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        self._process.kill()
                        self._process.wait()
                
                # Double check if something is still listening on the port (orphaned process)
                config = self.get_config()
                if config and config.port:
                    proc = self._find_process_by_port(config.port)
                    if proc:
                        proc.terminate()
                        try:
                             proc.wait(timeout=5)
                        except psutil.TimeoutExpired:
                             proc.kill()

                self._last_action_at = time.time()
                self._last_error = None
                return {"success": True, "message": "ComfyUI stopped"}

            except Exception as e:
                self._last_action_at = time.time()
                self._last_error = str(e)
                return {"success": False, "error": self._last_error}
            finally:
                self._process = None
                if self._log_handle:
                    try:
                        self._log_handle.close()
                    except:
                        pass
                    self._log_handle = None


# Global launcher instance
comfy_launcher = ComfyUILauncher()
