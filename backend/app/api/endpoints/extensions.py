from fastapi import APIRouter, HTTPException, BackgroundTasks
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from sqlmodel import Session, select
from app.db.engine import engine as db_engine
from app.models.engine import Engine
from app.core.manager_client import ComfyManagerClient
import uuid
import time
from enum import Enum

router = APIRouter()

# --- Job System ---

class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

class InstallJob(BaseModel):
    job_id: str
    status: JobStatus
    progress_text: str = ""
    installed: List[str] = []
    failed: List[str] = []
    unknown: List[str] = []
    error: Optional[str] = None
    created_at: float = 0.0

# In-memory storage for jobs (not persistent across restarting *this* backend, but fine for session)
install_jobs: Dict[str, InstallJob] = {}

class InstallMissingRequest(BaseModel):
    missing_nodes: List[str]
    allow_manual_clone: bool = False

@router.post("/install")
def install_missing_nodes(request: InstallMissingRequest, background_tasks: BackgroundTasks):
    """
    Start an async background job to install missing nodes.
    Returns a job_id immediately.
    """
    job_id = str(uuid.uuid4())
    job = InstallJob(
        job_id=job_id,
        status=JobStatus.PENDING,
        progress_text="Starting...",
        created_at=time.time()
    )
    install_jobs[job_id] = job
    
    background_tasks.add_task(process_install_job, job_id, request.missing_nodes, request.allow_manual_clone)
    
    return {"job_id": job_id}

@router.get("/install/{job_id}")
def get_install_status(job_id: str):
    if job_id not in install_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return install_jobs[job_id]

@router.post("/reboot")
def reboot_comfyui():
    """
    Manually trigger a reboot of ComfyUI.
    """
    with Session(db_engine) as session:
        engine = session.exec(select(Engine).where(Engine.is_active == True)).first()
        if not engine:
            raise HTTPException(status_code=404, detail="No active Engine found.")
        
        client = ComfyManagerClient(engine)
        try:
            return client.reboot()
        except Exception as e:
            # Reboot often kills the connection, so an error might be expected success
            return {"status": "reboot_triggered", "detail": str(e)}

def process_install_job(job_id: str, missing_nodes: List[str], allow_manual_clone: bool):
    job = install_jobs.get(job_id)
    if not job:
        return

    job.status = JobStatus.RUNNING
    job.progress_text = "Connecting to ComfyUI..."
    
    try:
        with Session(db_engine) as session:
            engine = session.exec(select(Engine).where(Engine.is_active == True)).first()
            if not engine:
                raise Exception("No active ComfyUI instance found.")
            
            client = ComfyManagerClient(engine)
            
            # 1. Fetch Mappings
            job.progress_text = "Fetching node mappings..."
            # Try without mode first, or default
            # Use separate try/catch for mappings to be robust
            mappings_raw = client.get_mappings(mode="remote") 
            
            class_to_url = {}
            if isinstance(mappings_raw, dict):
                 for url, data in mappings_raw.items():
                    if isinstance(data, list) and len(data) > 0:
                        classes = data[0]
                        for cls in classes:
                            class_to_url[cls] = url
            
            repos_to_install = set()
            
            for node_class in missing_nodes:
                if node_class in class_to_url:
                    repos_to_install.add(class_to_url[node_class])
                else:
                    job.unknown.append(node_class)
            
            if not repos_to_install:
                job.status = JobStatus.COMPLETED
                job.progress_text = "No installable nodes found."
                return

            # 2. Fetch Full List
            job.progress_text = "Fetching package details..."
            node_list_raw = client.get_list(mode="remote")
            
            packs_by_url = {}
            packs_by_id = {}
            
            # API returns 'custom_nodes' or 'node_packs' depending on version/mode?
            # Log analysis showed 'node_packs' is present.
            target_packs = node_list_raw.get('node_packs', [])
            if not target_packs:
                 target_packs = node_list_raw.get('custom_nodes', [])
            
            # Handle list or dict structure
            if isinstance(target_packs, list):
                for pack in target_packs:
                    url = pack.get('url') or pack.get('reference')
                    if url:
                         packs_by_url[url] = pack
                    
                    pack_id = pack.get('id')
                    if pack_id:
                        packs_by_id[pack_id] = pack

            elif isinstance(target_packs, dict):
                 # If dict, values are packs?
                 for key, pack in target_packs.items():
                    url = pack.get('url') or pack.get('reference')
                    if url:
                         packs_by_url[url] = pack
                    pack_id = pack.get('id')
                    if pack_id:
                        packs_by_id[pack_id] = pack
            
            # 3. Filter Payloads
            install_payloads = []
            
            for repo_identifier in repos_to_install:
                found = False
                
                # 1. Try ID match
                if repo_identifier in packs_by_id:
                    install_payloads.append(packs_by_id[repo_identifier])
                    found = True
                
                # 2. Try URL match (exact)
                elif repo_identifier in packs_by_url:
                    install_payloads.append(packs_by_url[repo_identifier])
                    found = True
                    
                else:
                    # 3. Try URL normalization
                    norm_url = repo_identifier.rstrip("/")
                    if norm_url.endswith(".git"):
                        norm_url = norm_url[:-4]
                    
                    for p_url, pack in packs_by_url.items():
                        p_norm = p_url.rstrip("/")
                        if p_norm.endswith(".git"):
                            p_norm = p_norm[:-4]
                        
                        if p_norm == norm_url:
                            install_payloads.append(pack)
                            found = True
                            break
                            
                if not found:
                    # Log warning but continue
                    job.unknown.append(f"{repo_identifier} (Pack not found)")
                    
            if not install_payloads:
                job.progress_text = "Failed to find package info."
                job.error = "Could not resolve package details for found repos."
                job.status = JobStatus.FAILED
                return

            # 4. Install Loop
            job.progress_text = f"Installing {len(install_payloads)} packages..."
            
            for i, pack in enumerate(install_payloads):
                title = pack.get('title', 'Unknown')
                job.progress_text = f"Installing {title} ({i+1}/{len(install_payloads)})..."
                
                try:
                    # Enforce required keys for ComfyUI Manager API
                    if 'version' not in pack:
                        pack['version'] = 'unknown'
                    
                    if 'files' not in pack:
                        # Fallback: Use 'url' or 'reference' as the file source
                        url = pack.get('url') or pack.get('reference')
                        if url:
                            pack['files'] = [url]
                        else:
                            # If no URL, we might fail, but let manager handle it
                            pack['files'] = []
                    
                    if 'channel' not in pack:
                        pack['channel'] = 'unknown' # or 'stable'? 'unknown' seems safest based on 'version'

                    if 'mode' not in pack:
                        pack['mode'] = 'remote'


                    # --- ATTEMPT INSTALL VIA MANAGER API ---
                    try:
                        client.install_node(pack)
                    except Exception as e:
                        # If manager explicitly fails, log it
                        raise e

                    # --- VERIFICATION & FALLBACK ---
                    # ComfyUI Manager sometimes returns success (200 OK) but fails to install (e.g. conflict, unknown auth).
                    # We check if the destination folder exists.

                    # Infer custom_nodes path from input_dir
                    # input_dir is usually .../ComfyUI/input
                    input_path = None
                    try:
                        import pathlib
                        import os
                        import subprocess

                        if engine.input_dir:
                            input_path = pathlib.Path(engine.input_dir)
                            if input_path.name == "input":
                                custom_nodes_path = input_path.parent / "custom_nodes"

                                # Derive folder name from URL
                                # Pack has 'files' which is [url] OR 'reference' OR 'url'
                                repo_url = None
                                if pack.get('files') and len(pack['files']) > 0:
                                    repo_url = pack['files'][0]
                                elif pack.get('url'):
                                    repo_url = pack.get('url')

                                if repo_url and custom_nodes_path.exists():
                                    folder_name = repo_url.rstrip("/").split("/")[-1]
                                    if folder_name.endswith(".git"):
                                        folder_name = folder_name[:-4]

                                    target_dir = custom_nodes_path / folder_name

                                    # If not exists after manager install, allow optional manual clone
                                    if not target_dir.exists():
                                        if not allow_manual_clone:
                                            job.failed.append(f"{title}: manager did not install and manual clone was not approved")
                                            continue

                                        print(f"Manager failed to install {folder_name}. Attempting manual git clone...")
                                        job.progress_text = f"Manager silent fail. Manual cloning {folder_name}..."

                                        try:
                                            subprocess.run(["git", "clone", repo_url], cwd=str(custom_nodes_path), check=True)

                                            # Check for requirements.txt
                                            req_file = target_dir / "requirements.txt"
                                            if req_file.exists():
                                                job.progress_text = f"Installing dependencies for {folder_name}..."
                                                print(f"Installing dependencies from {req_file}...")
                                                # Use the same python executable as the backend (vnv)
                                                import sys
                                                subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(req_file)], check=True)

                                            job.installed.append(f"{title} (manual clone)")
                                            continue # Success
                                        except Exception as git_err:
                                            print(f"Manual clone failed: {git_err}")
                                            raise Exception(f"Manager and Manual Clone failed: {git_err}")

                    except Exception as fallback_err:
                        print(f"Fallback verification failed: {fallback_err}")
                        raise fallback_err

                    job.installed.append(title)
                    time.sleep(1) # Breath
                except Exception as e:
                    job.failed.append(f"{title}: {str(e)}")
            
            job.progress_text = "Installation sequence finished."
            job.status = JobStatus.COMPLETED
            
    except Exception as e:
        job.error = str(e)
        job.status = JobStatus.FAILED
        job.progress_text = "Error occurred."
