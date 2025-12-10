from typing import List, Union, Optional
from pathlib import Path
from pydantic import AnyHttpUrl, validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROJECT_NAME: str = "Sweet Tea Studio"
    API_V1_STR: str = "/api/v1"
    APP_VERSION: str = "0.6.0"
    
    # Root directory for all Sweet Tea Studio data
    # Can be overridden with SWEET_TEA_ROOT_DIR environment variable
    ROOT_DIR: Path = Path.home() / ".sweet-tea"
    
    # ComfyUI configuration
    # Path to ComfyUI directory (auto-detected if not set)
    COMFYUI_PATH: Optional[str] = None
    # Additional arguments to pass to ComfyUI
    COMFYUI_ARGS: str = ""
    # Default ComfyUI URL
    COMFYUI_URL: str = "http://127.0.0.1:8188"
    
    # BACKEND_CORS_ORIGINS is a JSON-formatted list of origins
    # e.g: '["http://localhost", "http://localhost:4200", "http://localhost:3000"]'
    BACKEND_CORS_ORIGINS: List[AnyHttpUrl] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @validator("BACKEND_CORS_ORIGINS", pre=True)
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> Union[List[str], str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, (list, str)):
            return v
        raise ValueError(v)

    class Config:
        case_sensitive = True
        env_prefix = "SWEET_TEA_"

    @property
    def projects_dir(self) -> Path:
        """Directory containing all project folders."""
        return self.ROOT_DIR / "projects"

    @property
    def drafts_dir(self) -> Path:
        """Directory for draft/unsaved outputs."""
        return self.projects_dir / "drafts"

    @property
    def outputs_all_dir(self) -> Path:
        """Flat directory with hardlinks/copies of all outputs."""
        return self.ROOT_DIR / "outputs_all"

    @property
    def meta_dir(self) -> Path:
        """Directory for metadata files (database, config)."""
        return self.ROOT_DIR / "meta"

    @property
    def database_path(self) -> Path:
        """Path to the portfolio SQLite database."""
        return self.meta_dir / "profile.db"

    def ensure_dirs(self) -> None:
        """Create all required directories if they don't exist."""
        self.ROOT_DIR.mkdir(parents=True, exist_ok=True)
        self.meta_dir.mkdir(exist_ok=True)
        self.projects_dir.mkdir(exist_ok=True)
        self.outputs_all_dir.mkdir(exist_ok=True)
        
        # Create drafts project structure
        self.drafts_dir.mkdir(exist_ok=True)
        (self.drafts_dir / "inputs").mkdir(exist_ok=True)
        (self.drafts_dir / "outputs").mkdir(exist_ok=True)
        (self.drafts_dir / "masks").mkdir(exist_ok=True)

    def get_project_dir(self, project_slug: str) -> Path:
        """Get the directory for a specific project."""
        return self.projects_dir / project_slug

    def get_sweet_tea_dir_from_engine_path(self, engine_output_dir: str) -> Path:
        """
        Get the sweet_tea folder inside ComfyUI directory.
        Derives ComfyUI root from engine's output_dir (e.g., C:/ComfyUI/output -> C:/ComfyUI/sweet_tea)
        """
        comfy_root = Path(engine_output_dir).parent
        return comfy_root / "sweet_tea"

    def get_project_dir_in_comfy(self, engine_output_dir: str, project_slug: str) -> Path:
        """Get the project directory inside ComfyUI/sweet_tea/."""
        sweet_tea_dir = self.get_sweet_tea_dir_from_engine_path(engine_output_dir)
        return sweet_tea_dir / project_slug

    def ensure_sweet_tea_project_dirs(
        self, 
        engine_output_dir: str, 
        project_slug: str, 
        subfolders: Optional[List[str]] = None
    ) -> Path:
        """
        Create project directories inside ComfyUI/sweet_tea/ and return the project path.
        Creates: sweet_tea/{project_slug}/input, output, masks, etc.
        """
        sweet_tea_dir = self.get_sweet_tea_dir_from_engine_path(engine_output_dir)
        sweet_tea_dir.mkdir(exist_ok=True)
        
        project_dir = sweet_tea_dir / project_slug
        project_dir.mkdir(exist_ok=True)
        
        # Default folders if none provided
        folders_to_create = subfolders if subfolders is not None else ["input", "output", "masks"]
        
        for folder in folders_to_create:
            (project_dir / folder).mkdir(exist_ok=True)
            
        return project_dir

    def ensure_project_dirs(self, project_slug: str, subfolders: Optional[List[str]] = None) -> Path:
        """Create project directories and return the project path."""
        project_dir = self.get_project_dir(project_slug)
        project_dir.mkdir(exist_ok=True)
        (project_dir / "inputs").mkdir(exist_ok=True)
        
        # Default folders if none provided
        folders_to_create = subfolders if subfolders is not None else ["outputs", "masks"]
        
        for folder in folders_to_create:
            (project_dir / folder).mkdir(exist_ok=True)
            
        return project_dir


settings = Settings()

