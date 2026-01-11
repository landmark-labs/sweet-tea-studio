import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { api, WorkflowTemplate, Project, PromptLibraryItem } from "@/lib/api";
import { useGenerationFeedStore, usePromptLibraryStore } from "@/lib/stores/promptDataStore";
import { stripSchemaMeta } from "@/lib/schema";

interface GenerationContextValue {
    // Selection state
    selectedEngineId: string;
    setSelectedEngineId: (id: string) => void;
    selectedWorkflowId: string;
    setSelectedWorkflowId: (id: string) => void;
    selectedProjectId: string | null;
    setSelectedProjectId: (id: string | null) => void;

    // Data
    workflows: WorkflowTemplate[];
    projects: Project[];
    formData: Record<string, any>;
    setFormData: (data: Record<string, any>) => void;

    // Prompt library
    prompts: PromptLibraryItem[];
    promptSearch: string;
    setPromptSearch: (value: string) => void;
    loadPromptLibrary: () => Promise<void>;
    applyPrompt: (prompt: PromptLibraryItem) => void;

    // Data refreshers
    refreshWorkflows: () => Promise<void>;
    refreshProjects: () => Promise<void>;

    // Generation
    handleGenerate: () => Promise<void>;
    isGenerating: boolean;
    canGenerate: boolean;

    // Delegation
    registerGenerateHandler: (handler: () => Promise<void>) => void;
    unregisterGenerateHandler: () => void;

    // Connection status
    isConnected: boolean;
}

const GenerationContext = createContext<GenerationContextValue | null>(null);

export function useGeneration() {
    const ctx = useContext(GenerationContext);
    if (!ctx) {
        // Return a minimal stub when outside provider (for pages that don't need generation)
        return null;
    }
    return ctx;
}

interface GenerationProviderProps {
    children: ReactNode;
}

export function GenerationProvider({ children }: GenerationProviderProps) {
    // Selection state (persisted)
    const [selectedEngineId, setSelectedEngineId] = useState<string>(
        () => localStorage.getItem("ds_selected_engine") || ""
    );
    const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
        () => localStorage.getItem("ds_selected_workflow") || ""
    );
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
        () => localStorage.getItem("ds_selected_project") || null
    );

    // Data
    const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [formData, setFormData] = useState<Record<string, any>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    // Use a selector that computes hasActiveJobs - this ensures we subscribe to generationFeed changes
    // Previously we got the hasActiveJobs function reference which never triggers re-renders
    const hasActiveJobs = useGenerationFeedStore(
        useCallback(
            state => state.generationFeed.some(item =>
                item.status === 'queued' ||
                item.status === 'processing' ||
                item.status === 'running' ||
                item.status === 'saving' ||
                item.status === 'initiating'
            ),
            []
        )
    );
    const isGenerating = isSubmitting || hasActiveJobs;

    const applyWorkflows = useCallback((items: WorkflowTemplate[]) => {
        setWorkflows(items);

        if (!selectedWorkflowId && items.length > 0) {
            setSelectedWorkflowId(String(items[0].id));
            return;
        }

        const selectedExists = items.some(w => String(w.id) === selectedWorkflowId);
        if (!selectedExists && items.length > 0) {
            setSelectedWorkflowId(String(items[0].id));
        }
    }, [selectedWorkflowId]);

    // Persisted stores - use selectors to minimize re-renders
    const trackFeedStart = useGenerationFeedStore(useCallback(state => state.trackFeedStart, []));
    const updateFeed = useGenerationFeedStore(useCallback(state => state.updateFeed, []));
    const updatePreviewBlob = useGenerationFeedStore(useCallback(state => state.updatePreviewBlob, []));
    const prompts = usePromptLibraryStore(useCallback(state => state.prompts, []));
    const promptSearch = usePromptLibraryStore(useCallback(state => state.searchQuery, []));
    const setPromptSearch = usePromptLibraryStore(useCallback(state => state.setSearchQuery, []));
    const setPrompts = usePromptLibraryStore(useCallback(state => state.setPrompts, []));
    const shouldRefetch = usePromptLibraryStore(useCallback(state => state.shouldRefetch, []));
    const wsRef = useRef<WebSocket | null>(null);

    // Persist selections
    useEffect(() => {
        if (selectedEngineId) localStorage.setItem("ds_selected_engine", selectedEngineId);
    }, [selectedEngineId]);

    useEffect(() => {
        if (selectedWorkflowId) localStorage.setItem("ds_selected_workflow", selectedWorkflowId);
    }, [selectedWorkflowId]);

    useEffect(() => {
        if (selectedProjectId) {
            localStorage.setItem("ds_selected_project", selectedProjectId);
        } else {
            localStorage.removeItem("ds_selected_project");
        }
    }, [selectedProjectId]);

    // Load initial data with retry logic
    useEffect(() => {
        let isMounted = true;
        let retryTimeout: NodeJS.Timeout;

        const loadData = async () => {
            try {
                // We use these as a health check. If they fail, backend is likely not ready.
                const [enginesRes, workflowsRes, projectsRes] = await Promise.allSettled([
                    api.getEngines(),
                    api.getWorkflows(),
                    api.getProjects(),
                ]);

                // Check for complete failure which implies backend down
                const allFailed = enginesRes.status === "rejected" &&
                    workflowsRes.status === "rejected" &&
                    projectsRes.status === "rejected";

                if (allFailed) {
                    if (isMounted) {
                        console.log("[GenerationContext] Backend not ready, retrying in 2s...");
                        setIsConnected(false);
                        retryTimeout = setTimeout(loadData, 2000);
                    }
                    return;
                }

                if (isMounted) setIsConnected(true);

                if (enginesRes.status === "fulfilled") {
                    const enginesData = enginesRes.value;
                    if (!selectedEngineId && enginesData.length > 0) {
                        setSelectedEngineId(String(enginesData[0].id));
                    }
                }

                if (workflowsRes.status === "fulfilled") {
                    applyWorkflows(workflowsRes.value);
                }

                if (projectsRes.status === "fulfilled") {
                    setProjects(projectsRes.value);
                }
            } catch (err) {
                console.error("Failed to load generation context data", err);
                if (isMounted) {
                    retryTimeout = setTimeout(loadData, 2000);
                }
            }
        };

        loadData();

        return () => {
            isMounted = false;
            clearTimeout(retryTimeout);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run once on mount, but recursively retry

    // Sync active jobs on mount to prevent stuck spinners
    useEffect(() => {
        const checkActiveJobs = async () => {
            const feed = useGenerationFeedStore.getState().generationFeed;
            const activeJobs = feed.filter(item =>
                item.status === 'queued' ||
                item.status === 'processing' ||
                item.status === 'running'
            );

            if (activeJobs.length === 0) return;

            console.log(`[GenerationContext] Checking ${activeJobs.length} active jobs...`);
            await Promise.all(activeJobs.map(async (job) => {
                try {
                    const remoteJob = await api.getJob(job.jobId);
                    // If remote is done/failed but local is active, sync it
                    if (['completed', 'failed', 'cancelled'].includes(remoteJob.status)) {
                        console.log(`[GenerationContext] Syncing stuck job ${job.jobId} -> ${remoteJob.status}`);
                        let updates: any = { status: remoteJob.status };
                        if (remoteJob.status === 'completed') {
                            updates.progress = 100;
                        }
                        updateFeed(job.jobId, updates);
                    }
                } catch (err) {
                    console.error(`[GenerationContext] Failed to check job ${job.jobId}`, err);
                    if (err instanceof Error && err.message.includes("404")) {
                        updateFeed(job.jobId, { status: "failed" });
                    }
                }
            }));
        };

        checkActiveJobs();
    }, [updateFeed]);

    const refreshWorkflows = useCallback(async () => {
        try {
            const data = await api.getWorkflows();
            applyWorkflows(data);
        } catch (err) {
            console.error("Failed to refresh workflows", err);
        }
    }, [applyWorkflows]);

    const refreshProjects = useCallback(async () => {
        try {
            const data = await api.getProjects();
            setProjects(data);
        } catch (err) {
            console.error("Failed to refresh projects", err);
        }
    }, []);

    // Load form data when workflow changes
    useEffect(() => {
        if (!selectedWorkflowId) return;
        const workflow = workflows.find(w => String(w.id) === selectedWorkflowId);
        if (!workflow) return;

        const schema = stripSchemaMeta(workflow.input_schema || {});
        let initialData: Record<string, any> = {};

        // Set defaults from schema
        Object.keys(schema).forEach(k => {
            if (schema[k].default !== undefined) initialData[k] = schema[k].default;
        });

        // Load persisted values
        try {
            const key = `ds_pipe_params_${selectedWorkflowId}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                initialData = { ...initialData, ...JSON.parse(saved) };
            }
        } catch (e) { /* ignore */ }

        setFormData(initialData);
    }, [selectedWorkflowId, workflows]);

    // Persist form data
    const persistFormData = useCallback((data: Record<string, any>) => {
        setFormData(data);
        if (selectedWorkflowId) {
            localStorage.setItem(`ds_pipe_params_${selectedWorkflowId}`, JSON.stringify(data));
        }
    }, [selectedWorkflowId]);

    // Load prompt library
    const loadPromptLibrary = useCallback(async () => {
        if (!selectedWorkflowId) return;

        if (!shouldRefetch(selectedWorkflowId, promptSearch)) return;

        try {
            const data = await api.getPrompts(promptSearch, parseInt(selectedWorkflowId));
            setPrompts(data, selectedWorkflowId, promptSearch);
        } catch (err) {
            console.error("Failed to load prompts", err);
        }
    }, [selectedWorkflowId, promptSearch, shouldRefetch, setPrompts]);

    // Load prompts when workflow or search changes
    useEffect(() => {
        if (selectedWorkflowId) {
            loadPromptLibrary();
        }
    }, [selectedWorkflowId, loadPromptLibrary]);

    // Apply prompt to form
    const applyPrompt = useCallback((prompt: PromptLibraryItem) => {
        const params = prompt.job_params || {};
        persistFormData(params);
    }, [persistFormData]);

    // Delegate generation logic
    const generateHandlerRef = useRef<(() => Promise<void>) | null>(null);

    const registerGenerateHandler = useCallback((handler: () => Promise<void>) => {
        generateHandlerRef.current = handler;
    }, []);

    const unregisterGenerateHandler = useCallback(() => {
        generateHandlerRef.current = null;
    }, []);

    // Generate
    const handleGenerate = useCallback(async () => {
        // If a handler is registered (e.g. PromptStudio), delegate to it
        if (generateHandlerRef.current) {
            await generateHandlerRef.current();
            return;
        }

        if (!selectedEngineId || !selectedWorkflowId || isGenerating) return;

        const workflow = workflows.find(w => String(w.id) === selectedWorkflowId);
        if (!workflow) return;

        setIsSubmitting(true);
        try {
            const schema = stripSchemaMeta(workflow.input_schema || {});

            // Filter to only include params in schema
            const cleanParams = Object.keys(formData).reduce((acc, key) => {
                if (key in schema) {
                    acc[key] = formData[key];
                }
                return acc;
            }, {} as Record<string, any>);

            const job = await api.createJob(
                parseInt(selectedEngineId),
                parseInt(selectedWorkflowId),
                selectedProjectId ? parseInt(selectedProjectId) : null,
                cleanParams,
                null
            );

            trackFeedStart(job.id);

            // Start WebSocket to track progress
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsApiPath = window.location.pathname.startsWith('/studio') ? '/sts-api/api/v1' : '/api/v1';
            if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
                wsRef.current.close();
            }

            const ws = new WebSocket(`${wsProtocol}//${window.location.host}${wsApiPath}/jobs/${job.id}/ws`);
            wsRef.current = ws;
            let lastPreviewUpdate = 0;
            let lastProgressUpdate = 0;
            const PROGRESS_THROTTLE_MS = 100;
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === "status") {
                    const statusUpdates: { status: string; previewBlob?: string | null } = { status: data.status };
                    if (data.status === "failed" || data.status === "cancelled") {
                        statusUpdates.previewBlob = null;
                        ws.close();
                    }
                    updateFeed(job.id, statusUpdates);
                } else if (data.type === "progress") {
                    const pct = (data.data.value / data.data.max) * 100;
                    // Time-based throttle: skip expensive updateFeed calls if called too frequently
                    const now = Date.now();
                    if (now - lastProgressUpdate < PROGRESS_THROTTLE_MS) {
                        return; // Skip this update, another will come shortly
                    }
                    lastProgressUpdate = now;
                    // Use RAF to defer update and avoid blocking the main thread
                    requestAnimationFrame(() => {
                        updateFeed(job.id, { progress: pct, status: "processing" });
                    });
                } else if (data.type === "completed") {
                    const paths = data.images?.map((img: any) => img.path) || [];
                    updateFeed(job.id, {
                        status: "completed",
                        progress: 100,
                        previewPath: paths[0],
                        previewPaths: paths,
                        previewBlob: null,
                    });
                    ws.close();
                } else if (data.type === "preview") {
                    // Throttle preview updates and use RAF-optimized method
                    const now = Date.now();
                    if (now - lastPreviewUpdate < 150) return;
                    lastPreviewUpdate = now;
                    const feedOpen = typeof window !== "undefined"
                        ? window.localStorage.getItem("ds_feed_open") !== "false"
                        : true;
                    if (!feedOpen || (typeof document !== "undefined" && document.visibilityState === "hidden")) {
                        return;
                    }
                    if (data.data?.blob) updatePreviewBlob(job.id, data.data.blob);
                } else if (data.type === "error") {
                    updateFeed(job.id, { status: "failed", previewBlob: null });
                    ws.close();
                }
            };
            ws.onerror = () => {
                updateFeed(job.id, { status: "failed", previewBlob: null });
                ws.close();
            };
            ws.onclose = () => {
                if (wsRef.current === ws) {
                    wsRef.current = null;
                }
            };
        } catch (err) {
            console.error("Generation failed", err);
        } finally {
            setIsSubmitting(false);
        }
    }, [selectedEngineId, selectedWorkflowId, selectedProjectId, formData, workflows, isGenerating, trackFeedStart, updateFeed]);

    const canGenerate = Boolean(selectedEngineId && selectedWorkflowId && !isGenerating);

    const value: GenerationContextValue = {
        selectedEngineId,
        setSelectedEngineId,
        selectedWorkflowId,
        setSelectedWorkflowId,
        selectedProjectId,
        setSelectedProjectId,
        workflows,
        projects,
        formData,
        setFormData: persistFormData,
        prompts,
        promptSearch,
        setPromptSearch,
        loadPromptLibrary,
        applyPrompt,
        refreshWorkflows,
        refreshProjects,
        handleGenerate,
        isGenerating,
        canGenerate,
        registerGenerateHandler,
        unregisterGenerateHandler,
        isConnected,
    } as GenerationContextValue; // Cast to include new methods without breaking interface yet if I don't update interface definition


    return (
        <GenerationContext.Provider value={value}>
            {children}
        </GenerationContext.Provider>
    );
}
