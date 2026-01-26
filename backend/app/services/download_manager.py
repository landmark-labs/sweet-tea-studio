"""Download manager service for model downloads from HuggingFace and Civitai."""

import os
import re
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Callable, Literal
from urllib.parse import urlparse, unquote

import httpx

# huggingface_hub for repo/directory downloads
try:
    from huggingface_hub import snapshot_download, hf_hub_download
    HF_HUB_AVAILABLE = True
except ImportError:
    HF_HUB_AVAILABLE = False
    print("[DownloadManager] huggingface_hub not installed, repo downloads will be limited")


# Will be set by models.py to avoid circular import
_get_models_root_fn: Callable[[], Path] | None = None

# Aria2c configuration
ARIA2C_DOWNLOAD_URL = "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip"
_aria2c_path: Path | None = None


def set_models_root_getter(fn: Callable[[], Path]) -> None:
    """Set the function used to get the models root directory."""
    global _get_models_root_fn
    _get_models_root_fn = fn


def _get_models_root() -> Path:
    """Get the models root directory using the registered getter."""
    if _get_models_root_fn is None:
        raise RuntimeError("Models root getter not initialized")
    return _get_models_root_fn()


def _get_sweet_tea_dir() -> Path:
    """Get the sweet_tea directory inside ComfyUI."""
    models_root = _get_models_root()
    # Go up from models/ to ComfyUI/
    comfyui_dir = models_root.parent
    sweet_tea_dir = comfyui_dir / "sweet_tea"
    sweet_tea_dir.mkdir(parents=True, exist_ok=True)
    return sweet_tea_dir


def _get_aria2c_path() -> Path | None:
    """Get path to aria2c executable, downloading if needed."""
    global _aria2c_path
    
    # Return cached path if valid
    if _aria2c_path and _aria2c_path.exists():
        return _aria2c_path
    
    # Check in sweet_tea folder
    sweet_tea_dir = _get_sweet_tea_dir()
    aria2c_exe = sweet_tea_dir / "aria2c.exe"
    
    if aria2c_exe.exists():
        _aria2c_path = aria2c_exe
        return _aria2c_path
    
    # Check if aria2c is in system PATH
    try:
        result = subprocess.run(
            ["aria2c", "--version"],
            capture_output=True,
            timeout=5
        )
        if result.returncode == 0:
            _aria2c_path = Path("aria2c")  # Use system aria2c
            return _aria2c_path
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    
    # Need to download aria2c
    return None


def _download_aria2c() -> Path | None:
    """Download aria2c to the sweet_tea folder."""
    global _aria2c_path

    # Only auto-download the Windows build. On other platforms we rely on PATH.
    if os.name != "nt":
        return None
    
    sweet_tea_dir = _get_sweet_tea_dir()
    aria2c_exe = sweet_tea_dir / "aria2c.exe"
    zip_path = sweet_tea_dir / "aria2c.zip"
    
    try:
        print("[DownloadManager] Downloading aria2c for faster downloads...")
        
        with httpx.Client(follow_redirects=True, timeout=60.0) as client:
            response = client.get(ARIA2C_DOWNLOAD_URL)
            response.raise_for_status()
            
            with open(zip_path, "wb") as f:
                f.write(response.content)
        
        # Extract aria2c.exe from the zip
        with zipfile.ZipFile(zip_path, 'r') as zf:
            # Find aria2c.exe in the archive
            for name in zf.namelist():
                if name.endswith("aria2c.exe"):
                    # Extract just the exe file
                    with zf.open(name) as src, open(aria2c_exe, "wb") as dst:
                        dst.write(src.read())
                    break
        
        # Clean up zip
        zip_path.unlink()
        
        if aria2c_exe.exists():
            print(f"[DownloadManager] aria2c downloaded to {aria2c_exe}")
            _aria2c_path = aria2c_exe
            return _aria2c_path
    except Exception as e:
        print(f"[DownloadManager] Failed to download aria2c: {e}")
        # Clean up on failure
        if zip_path.exists():
            zip_path.unlink()
    
    return None


class DownloadStatus(str, Enum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class DownloadJob:
    """Represents a single download job."""
    job_id: str
    url: str
    target_folder: str
    target_path: Path | None = None
    filename: str = ""
    status: DownloadStatus = DownloadStatus.QUEUED
    progress: float = 0.0
    downloaded_bytes: int = 0
    total_bytes: int = 0
    speed: str = ""
    eta: str = ""
    error: str | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)
    
    def to_dict(self) -> dict:
        """Convert to JSON-serializable dict."""
        return {
            "job_id": self.job_id,
            "url": self.url,
            "target_folder": self.target_folder,
            "filename": self.filename,
            "status": self.status.value,
            "progress": self.progress,
            "downloaded_bytes": self.downloaded_bytes,
            "total_bytes": self.total_bytes,
            "speed": self.speed,
            "eta": self.eta,
            "error": self.error,
        }


def _detect_source(url: str) -> Literal["huggingface", "civitai", "unknown"]:
    """Detect whether URL is from HuggingFace or Civitai."""
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    
    if "huggingface.co" in host or "hf.co" in host:
        return "huggingface"
    if "civitai.com" in host:
        return "civitai"
    
    # Check if it's a repo ID format (org/model)
    if "/" in url and "://" not in url:
        parts = url.strip().split("/")
        if len(parts) == 2 and all(p for p in parts):
            return "huggingface"  # Treat repo IDs as HuggingFace
    
    return "unknown"


def _format_bytes(bytes_val: int) -> str:
    """Format bytes as human-readable string."""
    for unit in ["B", "KB", "MB", "GB"]:
        if bytes_val < 1024:
            return f"{bytes_val:.1f} {unit}"
        bytes_val /= 1024
    return f"{bytes_val:.1f} TB"


def _format_speed(bytes_per_sec: float) -> str:
    """Format download speed."""
    return f"{_format_bytes(int(bytes_per_sec))}/s"


def _format_eta(seconds: float) -> str:
    """Format ETA as human-readable string."""
    if seconds < 0 or seconds > 86400:  # > 1 day
        return "calculating..."
    
    if seconds < 60:
        return f"{int(seconds)}s"
    if seconds < 3600:
        mins = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{mins}m {secs}s"
    
    hours = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    return f"{hours}h {mins}m"


def _extract_filename_from_url(url: str) -> str:
    """Extract filename from URL or content-disposition."""
    parsed = urlparse(url)
    path = unquote(parsed.path)
    
    # For HuggingFace blob URLs like /org/repo/blob/main/file.safetensors
    if "/blob/" in path or "/resolve/" in path:
        return path.split("/")[-1]
    
    # For Civitai URLs, filename often in path
    if path:
        filename = path.split("/")[-1]
        if "." in filename:
            return filename
    
    return f"model_{uuid.uuid4().hex[:8]}.safetensors"


def _convert_hf_url_to_download(url: str) -> str:
    """Convert HuggingFace blob URL to raw download URL."""
    # Convert blob URLs to resolve URLs for direct download
    # e.g., https://huggingface.co/org/repo/blob/main/file.safetensors
    # to    https://huggingface.co/org/repo/resolve/main/file.safetensors
    return url.replace("/blob/", "/resolve/")


# Common model file extensions for detection
MODEL_FILE_EXTENSIONS = {
    ".safetensors", ".gguf", ".bin", ".pt", ".pth", ".ckpt", 
    ".onnx", ".pb", ".h5", ".tflite", ".mlmodel"
}


def _is_direct_file_url(url: str) -> bool:
    """Check if URL points to a specific file (has a file extension).
    
    Direct file URLs should use aria2c for fast multi-connection downloads.
    Examples that return True:
    - https://huggingface.co/org/repo/resolve/main/model.safetensors
    - https://huggingface.co/org/repo/blob/main/file.gguf
    
    Examples that return False:
    - https://huggingface.co/org/repo-name
    - org/model-name (repo ID)
    """
    parsed = urlparse(url)
    path = unquote(parsed.path).lower()
    
    # Check if path ends with a known model file extension
    for ext in MODEL_FILE_EXTENSIONS:
        if path.endswith(ext):
            return True
    
    # Also check for /resolve/ or /blob/ patterns with a file at the end
    if "/resolve/" in path or "/blob/" in path:
        filename = path.split("/")[-1]
        if "." in filename:
            return True
    
    return False


def _is_hf_repo_id(input_str: str) -> bool:
    """Check if input is a HuggingFace repo ID (org/model format).
    
    Examples that return True:
    - unsloth/Qwen3-14B-GGUF
    - stabilityai/stable-diffusion-3.5-large
    
    Examples that return False:
    - https://huggingface.co/org/repo
    - just-a-name (no slash)
    """
    # If it contains ://, it's a URL not a repo ID
    if "://" in input_str:
        return False
    
    # Repo IDs are in format org/model or user/model
    parts = input_str.strip().split("/")
    if len(parts) == 2 and all(p for p in parts):
        # Both parts should be non-empty and alphanumeric with dashes/underscores
        return all(re.match(r'^[\w\-\.]+$', p) for p in parts)
    
    return False


def _extract_repo_id_from_hf_url(url: str) -> str | None:
    """Extract repo ID from a HuggingFace URL.
    
    Examples:
    - https://huggingface.co/org/model -> org/model
    - https://huggingface.co/org/model/tree/main -> org/model
    """
    parsed = urlparse(url)
    if "huggingface.co" not in parsed.netloc and "hf.co" not in parsed.netloc:
        return None
    
    path = parsed.path.strip("/")
    parts = path.split("/")
    
    # Need at least org/model (2 parts)
    if len(parts) >= 2:
        return f"{parts[0]}/{parts[1]}"
    
    return None


class DownloadManager:
    """Manages model downloads from various sources."""
    
    def __init__(self):
        self._jobs: dict[str, DownloadJob] = {}
        self._lock = threading.Lock()
        self._max_concurrent = 2
        self._active_count = 0
    
    def queue_download(self, url: str, target_folder: str) -> str:
        """Queue a new download job.
        
        Args:
            url: URL to download from (HuggingFace or Civitai)
            target_folder: Subfolder name within models directory (e.g., "checkpoints")
        
        Returns:
            Job ID for tracking
        """
        job_id = uuid.uuid4().hex[:12]
        
        # Determine target path
        models_root = _get_models_root()
        target_dir = models_root / target_folder
        target_dir.mkdir(parents=True, exist_ok=True)
        
        filename = _extract_filename_from_url(url)
        target_path = target_dir / filename
        
        job = DownloadJob(
            job_id=job_id,
            url=url,
            target_folder=target_folder,
            target_path=target_path,
            filename=filename,
        )
        
        with self._lock:
            self._jobs[job_id] = job
        
        # Start download in background thread
        thread = threading.Thread(target=self._run_download, args=(job,), daemon=True)
        thread.start()
        
        return job_id
    
    def get_downloads(self) -> list[dict]:
        """Get all download jobs."""
        with self._lock:
            return [job.to_dict() for job in self._jobs.values()]
    
    def cancel_download(self, job_id: str) -> bool:
        """Cancel a download job."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return False
            
            if job.status in (DownloadStatus.COMPLETED, DownloadStatus.FAILED, DownloadStatus.CANCELLED):
                return False
            
            job.cancel_event.set()
            return True
    
    def remove_job(self, job_id: str) -> bool:
        """Remove a completed/failed/cancelled job from the list."""
        with self._lock:
            if job_id in self._jobs:
                job = self._jobs[job_id]
                if job.status not in (DownloadStatus.QUEUED, DownloadStatus.DOWNLOADING):
                    del self._jobs[job_id]
                    return True
            return False
    
    def clear_finished_jobs(self) -> int:
        """Remove all completed, failed, and cancelled jobs. Returns count of removed jobs."""
        with self._lock:
            finished_statuses = (DownloadStatus.COMPLETED, DownloadStatus.FAILED, DownloadStatus.CANCELLED)
            to_remove = [jid for jid, job in self._jobs.items() if job.status in finished_statuses]
            for jid in to_remove:
                del self._jobs[jid]
            return len(to_remove)
    
    def _run_download(self, job: DownloadJob):
        """Execute the download in a background thread."""
        source = _detect_source(job.url)
        
        try:
            job.status = DownloadStatus.DOWNLOADING
            
            if source == "huggingface":
                self._download_huggingface(job)
            elif source == "civitai":
                self._download_civitai(job)
            else:
                # Try generic HTTP download
                self._download_generic(job)
            
            if job.cancel_event.is_set():
                job.status = DownloadStatus.CANCELLED
                # Clean up partial file
                if job.target_path and job.target_path.exists():
                    job.target_path.unlink()
            elif job.status == DownloadStatus.DOWNLOADING:
                job.status = DownloadStatus.COMPLETED
                job.progress = 100.0
                
        except Exception as e:
            job.status = DownloadStatus.FAILED
            job.error = str(e)
            # Clean up partial file on failure
            if job.target_path and job.target_path.exists():
                try:
                    job.target_path.unlink()
                except:
                    pass
    
    def _download_with_progress(self, job: DownloadJob, url: str, headers: dict | None = None):
        """Common download logic with progress tracking."""
        headers = headers or {}
        
        with httpx.Client(follow_redirects=True, timeout=30.0) as client:
            with client.stream("GET", url, headers=headers) as response:
                response.raise_for_status()
                
                # Get total size from headers
                total = int(response.headers.get("content-length", 0))
                job.total_bytes = total
                
                # Extract filename from Content-Disposition if available
                content_disp = response.headers.get("content-disposition", "")
                if "filename=" in content_disp:
                    match = re.search(r'filename="?([^";\n]+)"?', content_disp)
                    if match:
                        job.filename = match.group(1)
                        job.target_path = job.target_path.parent / job.filename
                
                downloaded = 0
                start_time = time.time()
                last_update = start_time
                last_bytes = 0
                
                with open(job.target_path, "wb") as f:
                    for chunk in response.iter_bytes(chunk_size=8192):
                        if job.cancel_event.is_set():
                            return
                        
                        f.write(chunk)
                        downloaded += len(chunk)
                        job.downloaded_bytes = downloaded
                        
                        # Update progress
                        if total > 0:
                            job.progress = (downloaded / total) * 100
                        
                        # Update speed and ETA every 0.5 seconds
                        now = time.time()
                        if now - last_update >= 0.5:
                            elapsed = now - start_time
                            bytes_delta = downloaded - last_bytes
                            time_delta = now - last_update
                            
                            if time_delta > 0:
                                speed = bytes_delta / time_delta
                                job.speed = _format_speed(speed)
                                
                                if total > 0 and speed > 0:
                                    remaining = total - downloaded
                                    eta_seconds = remaining / speed
                                    job.eta = _format_eta(eta_seconds)
                            
                            last_update = now
                            last_bytes = downloaded
    
    def _download_huggingface(self, job: DownloadJob):
        """Download from HuggingFace - route to aria2c for files, hf_hub for repos."""
        url = job.url
        
        # Get HF token for authentication
        hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        
        # Determine download strategy based on URL type
        if _is_hf_repo_id(url):
            # Direct repo ID like "org/model" -> use hf_hub
            print(f"[DownloadManager] Detected repo ID: {url}, using huggingface_hub")
            self._download_with_hf_hub(job, url, hf_token)
        elif _is_direct_file_url(url):
            # Direct file URL with extension -> use aria2c for speed
            print(f"[DownloadManager] Detected direct file URL, using aria2c")
            download_url = _convert_hf_url_to_download(url)
            headers = {}
            if hf_token:
                headers["Authorization"] = f"Bearer {hf_token}"
            
            # Try aria2c first for faster downloads
            aria2c = _get_aria2c_path()
            if aria2c is None:
                aria2c = _download_aria2c()
            
            if aria2c and self._download_with_aria2c(job, download_url, headers):
                return  # Success with aria2c
            
            # Fall back to httpx
            self._download_with_progress(job, download_url, headers)
        else:
            # HF URL without file extension -> extract repo ID and use hf_hub
            repo_id = _extract_repo_id_from_hf_url(url)
            if repo_id:
                print(f"[DownloadManager] Detected repo URL: {url} -> {repo_id}, using huggingface_hub")
                self._download_with_hf_hub(job, repo_id, hf_token)
            else:
                # Fallback: treat as direct download
                print(f"[DownloadManager] Could not parse HF URL, trying direct download: {url}")
                download_url = _convert_hf_url_to_download(url)
                headers = {}
                if hf_token:
                    headers["Authorization"] = f"Bearer {hf_token}"
                self._download_with_progress(job, download_url, headers)
    
    def _download_with_hf_hub(self, job: DownloadJob, repo_id: str, token: str | None = None):
        """Download entire repo or sharded model using huggingface_hub.
        
        This is used for:
        - Sharded models (multiple files)
        - Full repo downloads
        - When user provides repo ID instead of file URL
        """
        if not HF_HUB_AVAILABLE:
            raise ValueError(
                "huggingface_hub is not installed. "
                "Run: pip install huggingface_hub"
            )
        
        try:
            job.status = DownloadStatus.DOWNLOADING
            job.speed = "Downloading repo..."
            
            # Get target directory
            models_root = _get_models_root()
            target_dir = models_root / job.target_folder
            target_dir.mkdir(parents=True, exist_ok=True)
            
            # Extract just the model name for the subfolder
            model_name = repo_id.split("/")[-1] if "/" in repo_id else repo_id
            local_dir = target_dir / model_name
            
            print(f"[DownloadManager] Downloading repo {repo_id} to {local_dir}")
            
            # Use snapshot_download for full repo
            # This handles sharded models automatically
            downloaded_path = snapshot_download(
                repo_id=repo_id,
                local_dir=str(local_dir),
                token=token,
                resume_download=True,
                # Progress callback would be nice but snapshot_download doesn't support it well
            )
            
            job.target_path = Path(downloaded_path)
            job.filename = model_name
            job.progress = 100.0
            job.speed = "Complete"
            job.status = DownloadStatus.COMPLETED
            
            print(f"[DownloadManager] Successfully downloaded repo to {downloaded_path}")
            
        except Exception as e:
            print(f"[DownloadManager] hf_hub download failed: {e}")
            raise
    
    def _download_with_aria2c(self, job: DownloadJob, url: str, headers: dict | None = None) -> bool:
        """Download using aria2c for multi-connection speed. Returns True on success."""
        aria2c = _get_aria2c_path()
        if not aria2c:
            return False
        
        try:
            cmd = [
                str(aria2c),
                url,
                "-d", str(job.target_path.parent),
                "-o", job.filename,
                "-x", "16",  # 16 connections
                "-s", "16",  # 16 splits
                "--file-allocation=none",
                "--console-log-level=notice",
                "--summary-interval=1",
            ]
            
            # Add headers
            if headers:
                for key, value in headers.items():
                    cmd.extend(["--header", f"{key}: {value}"])
            
            # Run aria2c with output parsing
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
            
            # Parse progress from aria2c output
            while True:
                if job.cancel_event.is_set():
                    process.terminate()
                    return False
                
                line = process.stdout.readline()
                if not line and process.poll() is not None:
                    break
                
                # Parse aria2c progress lines like: [#id 123MiB/456MiB(27%) CN:16 DL:12MiB]
                if "[#" in line and "%" in line:
                    try:
                        # Extract percentage
                        pct_match = re.search(r'\((\d+)%\)', line)
                        if pct_match:
                            job.progress = float(pct_match.group(1))
                        
                        # Extract speed (DL:XXX)
                        speed_match = re.search(r'DL:([0-9.]+[KMG]?i?B)', line)
                        if speed_match:
                            job.speed = f"{speed_match.group(1)}/s"
                        
                        # Extract downloaded/total
                        size_match = re.search(r'(\d+(?:\.\d+)?[KMG]?i?B)/(\d+(?:\.\d+)?[KMG]?i?B)', line)
                        if size_match:
                            job.eta = f"{size_match.group(1)} / {size_match.group(2)}"
                    except Exception:
                        pass
            
            if process.returncode == 0 and job.target_path.exists():
                job.progress = 100.0
                job.speed = "Complete"
                job.downloaded_bytes = job.target_path.stat().st_size
                job.total_bytes = job.downloaded_bytes
                return True
            
            return False
            
        except Exception as e:
            print(f"[DownloadManager] aria2c failed: {e}")
            return False

    
    def _download_civitai(self, job: DownloadJob):
        """Download from Civitai."""
        url = job.url
        
        # Get API key from database or environment
        from app.services.app_settings import get_civitai_api_key
        api_key = get_civitai_api_key()
        if not api_key:
            raise ValueError(
                "Civitai API key not configured. "
                "Set it in Settings > API Keys or via CIVITAI_API_KEY environment variable. "
                "Get your API key from https://civitai.com/user/account"
            )
        
        # Convert model page URLs to API download URLs
        # Model page URLs look like: https://civitai.com/models/12345/model-name?modelVersionId=67890
        # API download URLs should be: https://civitai.com/api/download/models/67890
        parsed = urlparse(url)
        query_params = dict(p.split("=") for p in parsed.query.split("&") if "=" in p)
        
        # Check if URL contains modelVersionId parameter
        if "modelVersionId" in query_params:
            version_id = query_params["modelVersionId"]
            url = f"https://civitai.com/api/download/models/{version_id}"
        # Check if it's already an API download URL pattern 
        elif "/api/download/models/" in url:
            # Already in correct format, just strip any existing query params
            base_match = re.search(r'/api/download/models/(\d+)', url)
            if base_match:
                version_id = base_match.group(1)
                url = f"https://civitai.com/api/download/models/{version_id}"
        # Check for direct model version page URLs like /models/123/name/456
        elif re.search(r'/models/\d+/[^/]+/(\d+)', parsed.path):
            match = re.search(r'/models/\d+/[^/]+/(\d+)', parsed.path)
            version_id = match.group(1)
            url = f"https://civitai.com/api/download/models/{version_id}"
        else:
            # Log that we're using the URL as-is since we couldn't parse it
            print(f"[DownloadManager] Could not extract modelVersionId from URL, using as-is: {url}")
        
        # Add API key as query parameter
        url = f"{url}?token={api_key}"
        
        self._download_with_progress(job, url)
    
    def _download_generic(self, job: DownloadJob):
        """Generic HTTP download."""
        self._download_with_progress(job, job.url)


# Global singleton instance
download_manager = DownloadManager()
