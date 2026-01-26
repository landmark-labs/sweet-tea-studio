"""
ComfyUI Launcher Service.
Provides ability to detect, configure, and launch ComfyUI from Sweet Tea Studio.
"""
import asyncio
import json
import os
import signal
import socket
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
        # Port check cache for faster is_running() calls
        self._port_check_cache: dict = {"result": None, "timestamp": 0}
        self._port_cache_ttl = 2.0  # Cache for 2 seconds
        self._config_path = settings.meta_dir / "comfyui_config.json"
        try:
            settings.ensure_dirs()
            self._config_path.parent.mkdir(parents=True, exist_ok=True)
        except Exception:
            # Directory creation failures should not crash the launcher; will retry on save.
            pass
        self._config = self._load_config_from_disk() or self._config

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
   
    def _load_config_from_disk(self) -> Optional[LaunchConfig]:
        """Load persisted ComfyUI config if present."""
        try:
            if not self._config_path.exists():
                return None
            with open(self._config_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)

            config = LaunchConfig(
                path=data.get("path"),
                python_path=data.get("python_path"),
                args=data.get("args") or [],
                port=data.get("port", 8188),
                detection_method=data.get("detection_method", "saved_config"),
            )

            if config.path and self._is_valid_comfyui_path(config.path):
                config.is_available = True
                # Re-evaluate python path in case environments changed
                config.python_path = config.python_path or self._find_python_for_comfyui(config.path)
            else:
                config.is_available = False

            return config
        except Exception as exc:
            print(f"Failed to load ComfyUI config: {exc}")
            return None

    def _save_config_to_disk(self, config: LaunchConfig) -> None:
        """Persist the current ComfyUI config for future sessions."""
        try:
            self._config_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self._config_path, "w", encoding="utf-8") as fh:
                json.dump(
                    {
                        "path": config.path,
                        "python_path": config.python_path,
                        "args": config.args or [],
                        "port": config.port,
                        "detection_method": config.detection_method,
                    },
                    fh,
                    ensure_ascii=False,
                    indent=2,
                )
        except Exception as exc:
            print(f"Failed to persist ComfyUI config: {exc}")

    def _resolve_cached_config(self) -> Optional[LaunchConfig]:
        """Return an in-memory or on-disk config if available."""
        if self._config:
            return self._config
        loaded = self._load_config_from_disk()
        if loaded:
            self._config = loaded
        return loaded

    def detect_comfyui(self) -> LaunchConfig:
        """Detect ComfyUI installation paths."""
        cached = self._resolve_cached_config()
        cached_unavailable = cached if cached and not cached.is_available else None
        if cached and cached.is_available:
            return cached

        config = LaunchConfig(args=[])
        
        # Check environment variable first
        env_path = os.environ.get("COMFYUI_PATH")
        if env_path and self._is_valid_comfyui_path(env_path):
            config.path = env_path
            config.is_available = True
            config.detection_method = "environment_variable"
            config.python_path = self._find_python_for_comfyui(env_path)
            self._config = config
            self._save_config_to_disk(config)
            return config
        
        # Check settings
        settings_path = getattr(settings, 'COMFYUI_PATH', None)
        if settings_path and self._is_valid_comfyui_path(settings_path):
            config.path = settings_path
            config.is_available = True
            config.detection_method = "settings"
            config.python_path = self._find_python_for_comfyui(settings_path)
            self._config = config
            self._save_config_to_disk(config)
            return config
        
        # Try common paths
        possible_paths = [
            Path.home() / "ComfyUI",
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
                self._save_config_to_disk(config)
                return config
        
        # Not found
        if cached_unavailable:
            self._config = cached_unavailable
            self._save_config_to_disk(cached_unavailable)
            return cached_unavailable

        config.is_available = False
        config.detection_method = "not_found"
        self._config = config
        self._save_config_to_disk(config)
        return config

    def _is_port_in_use(self, port: int) -> bool:
        """Fast check if a port is in use via socket (no process iteration)."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.1)
                result = s.connect_ex(('127.0.0.1', port))
                return result == 0  # 0 means connection succeeded (port in use)
        except Exception:
            return False
    
    def _find_process_by_port(self, port: int) -> Optional[psutil.Process]:
        """Find the process listening on a specific port (cached for 2s)."""
        now = time.time()
        
        # Check cache first
        if now - self._port_check_cache["timestamp"] < self._port_cache_ttl:
            return self._port_check_cache["result"]
        
        # First, do a fast socket check - if port not in use, no need to scan processes
        if not self._is_port_in_use(port):
            self._port_check_cache = {"result": None, "timestamp": now}
            return None
        
        # Port is in use - scan processes (slow but only when needed)
        for proc in psutil.process_iter(['pid', 'name']):
            if proc.pid == 0:
                continue
            try:
                for conn in proc.connections(kind='inet'):
                    if conn.laddr.port == port and conn.status == psutil.CONN_LISTEN:
                        self._port_check_cache = {"result": proc, "timestamp": now}
                        return proc
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass
        
        self._port_check_cache = {"result": None, "timestamp": now}
        return None


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
        config = self._resolve_cached_config() or self.detect_comfyui()
        if config.args is None:
            config.args = []
        self._config = config
        return config

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
        self._save_config_to_disk(config)

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

    def is_externally_running(self) -> bool:
        """Check if ComfyUI is running on the port but not managed by us."""
        # If we have our own process handle and it's alive, it's not external
        if self._process is not None and self._process.poll() is None:
            return False
        
        # Check if something is on the port
        config = self._resolve_cached_config() or self.detect_comfyui()
        if config and config.port:
            proc = self._find_process_by_port(config.port)
            if proc:
                # Something is listening, but we don't have a subprocess handle
                return True
        return False

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

    async def adopt(self) -> dict:
        """
        Adopt an externally-started ComfyUI process.
        
        Stops the external process and relaunches it with log capture so that
        Sweet Tea Studio has visibility into console output.
        """
        async with self._lock:
            if not self.is_externally_running():
                return {
                    "success": False,
                    "adopted": False,
                    "message": "No external ComfyUI process to adopt"
                }
            
            config = self._resolve_cached_config() or self.detect_comfyui()
            if not config or not config.port:
                return {
                    "success": False,
                    "adopted": False,
                    "error": "Cannot determine ComfyUI configuration"
                }
            
            # Find and stop the external process
            proc = self._find_process_by_port(config.port)
            if not proc:
                return {
                    "success": False,
                    "adopted": False,
                    "error": "External process disappeared before adoption"
                }
            
            external_pid = proc.pid
            print(f"[ComfyUI Adopt] Stopping external ComfyUI process (PID: {external_pid})...")
            
            try:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except psutil.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)
            except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
                return {
                    "success": False,
                    "adopted": False,
                    "error": f"Failed to stop external process: {e}"
                }
            
            # Clear port cache after stopping
            self._port_check_cache = {"result": None, "timestamp": 0}
            
            # Brief pause to ensure port is released
            await asyncio.sleep(1)
        
        # Launch with log capture (outside the lock to avoid nested lock)
        print("[ComfyUI Adopt] Relaunching ComfyUI with log capture...")
        result = await self.launch()
        
        if result.get("success"):
            print(f"[ComfyUI Adopt] Successfully adopted ComfyUI (new PID: {result.get('pid')})")
            return {
                "success": True,
                "adopted": True,
                "message": f"Adopted external ComfyUI (was PID {external_pid}, now PID {result.get('pid')})",
                "previous_pid": external_pid,
                "new_pid": result.get("pid")
            }
        else:
            return {
                "success": False,
                "adopted": False,
                "error": f"Stopped external process but failed to relaunch: {result.get('error')}",
                "previous_pid": external_pid
            }


# Global launcher instance
comfy_launcher = ComfyUILauncher()
