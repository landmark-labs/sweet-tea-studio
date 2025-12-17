// ui/labels.ts - Centralized UI string definitions
// All user-facing text should use these labels instead of hardcoding strings

export const labels = {
    // Navigation (lowercase for nav items)
    nav: {
        generation: 'generation',
        projects: 'projects',
        pipes: 'pipes',
        gallery: 'gallery',
        library: 'library',
        models: 'models',
        status: 'status',
        settings: 'settings',
    },

    // Entities (lowercase)
    entity: {
        pipe: 'pipe',
        pipes: 'pipes',
        project: 'project',
        projects: 'projects',
        model: 'model',
        models: 'models',
        run: 'run',
        runs: 'runs',
        draft: 'draft',
        drafts: 'drafts',
        workflow: 'workflow', // Internal use only - for raw ComfyUI graphs
        workflows: 'workflows',
    },

    // Actions (lowercase for buttons/actions)
    action: {
        runPipe: 'run pipe',
        saveAsProject: 'save as project',
        openInExplorer: 'open in file explorer',
        newProject: 'new project…',
        exportProject: 'export project',
        archiveProject: 'archive project',
        installNodes: 'install via comfyui manager',
        skipForNow: 'skip for now',
        download: 'download',
        generate: 'generate',
        cancel: 'cancel',
        save: 'save',
        delete: 'delete',
        edit: 'edit',
        copy: 'copy',
        refresh: 'refresh',
        viewAll: 'view all',
        viewProject: 'view project',
    },

    // Status indicators (lowercase)
    status: {
        engine: 'engine',
        queue: 'queue',
        io: 'io',
        models: 'models',
        ok: 'ok',
        warning: 'warning',
        error: 'error',
    },

    // Pipe configurator labels (lowercase for labels, UPPERCASE for section headers)
    config: {
        settingsDefault: 'settings – default',
        settingsCustomized: 'settings – customized',
        positivePrompt: 'positive prompt',
        negativePrompt: 'negative prompt',
        resolution: 'resolution',
        scaleFactor: 'scale factor',
        baseModel: 'base model',
        refiner: 'refiner',
        vae: 'vae',
        loras: 'loras',
        controlnets: 'controlnets',
        inputImage: 'input image',
        width: 'width',
        height: 'height',
        steps: 'steps',
        cfg: 'cfg',
        seed: 'seed',
        sampler: 'sampler',
        scheduler: 'scheduler',
    },

    // Page titles (lowercase for consistency)
    pageTitle: {
        generation: 'generation',
        projects: 'projects',
        pipes: 'pipes',
        gallery: 'gallery',
        library: 'library',
        models: 'models',
        status: 'status',
        settings: 'settings',
    },

    // Placeholders (lowercase)
    placeholder: {
        searchPipes: 'search pipes…',
        searchProjects: 'search projects…',
        searchModels: 'search models…',
        enterPrompt: 'enter prompt…',
        projectName: 'project name',
        modelUrl: 'paste model url…',
    },

    // Empty states (sentence case)
    empty: {
        noProjects: 'no projects yet',
        noPipes: 'no pipes configured',
        noModels: 'no models found',
        noOutputs: 'no outputs yet',
        noRuns: 'no runs in this project',
    },

    // Model types (lowercase)
    modelType: {
        checkpoint: 'checkpoint',
        checkpoints: 'checkpoints',
        lora: 'lora',
        loras: 'loras',
        vae: 'vae',
        controlnet: 'controlnet',
        controlnets: 'controlnets',
        textEncoder: 'text encoder',
        textEncoders: 'text encoders',
        clip: 'clip',
    },

    // Tabs (lowercase)
    tab: {
        installed: 'installed',
        download: 'download',
        all: 'all',
        project: 'project',
        recent: 'recent',
        favorites: 'favorites',
    },
} as const;

export type Labels = typeof labels;

// Helper function to get a label with fallback
export function getLabel<T extends keyof Labels>(
    category: T,
    key: keyof Labels[T]
): string {
    return (labels[category] as Record<string, string>)[key as string] ?? String(key);
}
