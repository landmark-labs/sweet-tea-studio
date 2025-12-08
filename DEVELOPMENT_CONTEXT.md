# Helper Context & Development Status

**Last Updated**: 2025-12-07
**Project**: Sweet Tea Studio
**Current Phase**: Phase 1 - Frontend Implementation (Early Stage)

##  Core Mental Model
We are building a **State-Managed Wrapper** around ComfyUI.
*   **ComfyUI** is treated as a dumb calculation engine. We do not store state in ComfyUI.
*   **Sweet Tea Studio** stores all state (Jobs, Projects, History, Galleries).
*   **Workflows**: We maintain `WorkflowTemplates` which map nice UI inputs to raw Comfy node graphs.
*   **Design Philosophy**: The core user experience is **Generation -> Upscale -> Final Upscale**. The user chooses parameters and how many upscale steps to engage in. Advanced customization is secondary.

##  Current Status
*   **Backend**: 
    *    Functional. 
    *    Connected to ComfyUI (tested via scripts). 
    *    CRUD API for Jobs/Engines exists.
    *    Database is currently using SQLModel with SQLite, but we have mixed mock/DB approaches in some endpoints. Needs consolidation.
*   **Frontend**:
    *    Skeleton created (React/Vite/Tailwind).
    *    Layout with Sidebar exists.
    *    Routing configured.
    *    **Sweet Tea Studio** is a placeholder. Logic to fetch workflows and render forms is MISSING.
    *    **API Integration** is effectively zero. No fetch calls written yet.

##  Immediate Next Steps (For the next helper)
1.  **Frontend API Client**: Create `src/lib/api.ts` to talk to the FastAPI backend.
2.  **Workflow Fetching**: Update `PromptStudio.tsx` to `GET /engines` and `GET /workflows`.
3.  **Form Generation**: Create a `DynamicForm` component that takes a `WorkflowTemplate.input_schema` and renders the UI.

##  Important Constraints & Quirks
1.  **Local Filesystem**: The project is located at `C:\Users\jkoti\diffusion-studio`.
2.  **PowerShell Quoting**: When using `run_command` to write files, ALWAYS use **Here-Strings** (`@' content '@`) to avoid syntax errors with newlines and quotes.
3.  **Vite Alias**: use `@/` for imports (maps to `src/`). This is configured in `vite.config.ts`.
4.  **NoSQL vs SQL**: We use a **Hybrid Schema**. `Job.input_params` is a JSON column in SQLite. Do not try to normalize input parameters into separate tables.

##  Architecture References
*   `schema_design.md`: The approved DB schema.
*   `task.md`: Detailed checklist of tasks.
*   `backend/app/core/comfy_client.py`: The heart of the ComfyUI integration.
