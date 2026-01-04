"""
Portfolio models for the generation database.
These models track runs, workflows, pipes, models, and outputs
for comprehensive generation history and future LLM querying.
"""
from typing import Optional, Dict, Any, List
from datetime import datetime
from sqlmodel import Field, SQLModel, JSON, Column
from sqlalchemy import LargeBinary


# --- Workflows table ---
# Stores raw ComfyUI graphs, deduplicated by hash
class ComfyWorkflowBase(SQLModel):
    """Base for ComfyUI workflow storage."""
    comfy_hash: str = Field(unique=True, index=True)  # SHA256 of comfy_json


class ComfyWorkflow(ComfyWorkflowBase, table=True):
    """
    Stores raw ComfyUI workflow graphs.
    Deduplicated by hash to avoid storing the same graph multiple times.
    """
    __tablename__ = "comfy_workflows"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    comfy_json: str  # Full ComfyUI workflow as JSON text


class ComfyWorkflowCreate(ComfyWorkflowBase):
    comfy_json: str


# --- Pipes table ---
# User-facing wrappers around workflows with defaults
class PipeBase(SQLModel):
    """Base for pipe configuration."""
    name: str
    slug: str = Field(unique=True, index=True)
    workflow_id: int = Field(foreign_key="comfy_workflows.id")
    default_params: str = "{}"  # JSON of defaults used in UI


class Pipe(PipeBase, table=True):
    """
    User-facing pipe configuration.
    Wraps a ComfyUI workflow with default parameters and metadata.
    """
    __tablename__ = "pipes"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    description: Optional[str] = Field(default=None, max_length=500)


class PipeCreate(SQLModel):
    name: str
    slug: Optional[str] = None
    workflow_id: int
    default_params: Optional[str] = "{}"
    description: Optional[str] = Field(default=None, max_length=500)


class PipeRead(PipeBase):
    id: int
    created_at: datetime
    description: Optional[str]


# --- Models table ---
# Catalog of all models used in generations
class ModelCatalogBase(SQLModel):
    """Base for model catalog entries."""
    kind: str  # 'checkpoint', 'lora', 'vae', 'controlnet', 'text_encoder', 'clip'
    name: str
    path: str


class ModelCatalog(ModelCatalogBase, table=True):
    """
    Catalog of models used in generations.
    Tracks model files, checksums, and metadata.
    """
    __tablename__ = "model_catalog"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    checksum: Optional[str] = None  # SHA256 of model file
    meta_json: Optional[str] = None  # Civitai/HF metadata as JSON
    first_seen_at: datetime = Field(default_factory=datetime.utcnow)
    last_used_at: Optional[datetime] = None


class ModelCatalogCreate(ModelCatalogBase):
    checksum: Optional[str] = None
    meta_json: Optional[str] = None


class ModelCatalogRead(ModelCatalogBase):
    id: int
    checksum: Optional[str]
    meta_json: Optional[str]
    first_seen_at: datetime
    last_used_at: Optional[datetime]


# --- Runs table ---
# One row per successful generation
class RunBase(SQLModel):
    """Base for run records."""
    run_uuid: str = Field(unique=True, index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="project.id", index=True)
    pipe_id: Optional[int] = Field(default=None, foreign_key="pipes.id")
    workflow_id: Optional[int] = Field(default=None, foreign_key="comfy_workflows.id")
    
    # High-level config for quick queries
    positive_prompt: Optional[str] = None
    negative_prompt: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    scale_factor: Optional[float] = None
    seed: Optional[str] = None
    steps: Optional[int] = None
    cfg: Optional[float] = None
    sampler: Optional[str] = None

    # Performance/status
    status: str = "success"  # 'success', 'error', 'canceled'
    duration_ms: Optional[int] = None  # end-to-end runtime in ms
    final_iterations_per_second: Optional[float] = None
    engine_name: Optional[str] = None
    engine_version: Optional[str] = None
    app_version: str = "0.6.0"


class Run(RunBase, table=True):
    """
    Records each generation run with full metadata.
    Stores parameter diffs relative to pipe defaults for efficiency.
    """
    __tablename__ = "runs"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    # Full parameters as diff from pipe defaults
    params_json: str = "{}"  # JSON of overrides


class RunCreate(RunBase):
    params_json: str = "{}"


class RunRead(RunBase):
    id: int
    created_at: datetime
    params_json: str


# --- RunModels junction table ---
# Many-to-many relationship between runs and models
class RunModelLink(SQLModel, table=True):
    """
    Junction table linking runs to the models they used.
    Tracks the role each model played in the generation.
    """
    __tablename__ = "run_models"
    
    run_id: int = Field(foreign_key="runs.id", primary_key=True)
    model_id: int = Field(foreign_key="model_catalog.id", primary_key=True)
    role: str = Field(primary_key=True)  # 'base', 'lora', 'controlnet', 'vae', etc.


# --- Outputs table ---
# Files produced by runs
class OutputBase(SQLModel):
    """Base for output records."""
    run_id: int = Field(foreign_key="runs.id", index=True)
    kind: str  # 'image', 'video', 'mask', 'latent_preview'
    index_in_run: int  # 0-based index for multiple outputs
    path: str  # Relative to root_dir


class Output(OutputBase, table=True):
    """
    Records output files from generation runs.
    Optionally stores tiny thumbnails for fast preview.
    """
    __tablename__ = "outputs"

    id: Optional[int] = Field(default=None, primary_key=True)
    thumb_jpeg: Optional[bytes] = Field(default=None, sa_column=Column(LargeBinary))
    perceptual_hash: Optional[str] = None
    meta_json: Optional[str] = None  # File size, frame count, etc.


class OutputCreate(OutputBase):
    thumb_jpeg: Optional[bytes] = None
    meta_json: Optional[str] = None


class OutputRead(OutputBase):
    id: int
    meta_json: Optional[str]
    # Note: thumb_jpeg excluded from read to keep responses small


# --- Execution Statistics tables ---
# Detailed performance telemetry for runs
class RunExecutionStatsBase(SQLModel):
    """Base for execution statistics."""
    job_id: int = Field(foreign_key="job.id", index=True)
    
    # Timing
    total_duration_ms: Optional[int] = None  # Total execution time
    queue_wait_ms: Optional[int] = None  # Time spent waiting in queue
    
    # VRAM/RAM snapshots
    peak_vram_mb: Optional[float] = None
    peak_ram_mb: Optional[float] = None
    vram_before_mb: Optional[float] = None
    vram_after_mb: Optional[float] = None
    ram_before_mb: Optional[float] = None
    ram_after_mb: Optional[float] = None
    
    # GPU/System info
    gpu_name: Optional[str] = None
    cuda_version: Optional[str] = None
    torch_version: Optional[str] = None
    device_count: Optional[int] = None
    offload_detected: Optional[bool] = None
    
    # Raw system stats JSON for future extensibility
    raw_system_stats: Optional[str] = None


class RunExecutionStats(RunExecutionStatsBase, table=True):
    """
    Stores aggregate execution statistics and telemetry for a run.
    One row per run, linked via run_id.
    """
    __tablename__ = "run_execution_stats"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class RunExecutionStatsCreate(RunExecutionStatsBase):
    pass


class RunExecutionStatsRead(RunExecutionStatsBase):
    id: int
    created_at: datetime


# --- Per-node timing table ---
class RunNodeTimingBase(SQLModel):
    """Base for per-node execution timing."""
    job_id: int = Field(foreign_key="job.id", index=True)
    node_id: str  # ComfyUI node ID
    node_type: Optional[str] = None  # e.g., "KSampler", "VAEDecode"
    start_offset_ms: Optional[int] = None  # Offset from run start
    duration_ms: Optional[int] = None  # Execution time for this node
    execution_order: Optional[int] = None  # Order node was executed (1-based)
    from_cache: bool = False  # True if node result was cached


class RunNodeTiming(RunNodeTimingBase, table=True):
    """
    Stores per-node execution timing for a run.
    Multiple rows per run (one per executed node).
    """
    __tablename__ = "run_node_timings"
    
    id: Optional[int] = Field(default=None, primary_key=True)


class RunNodeTimingCreate(RunNodeTimingBase):
    pass


class RunNodeTimingRead(RunNodeTimingBase):
    id: int
