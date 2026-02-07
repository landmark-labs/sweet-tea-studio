import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GenerationProvider } from "./lib/GenerationContext";
import { UndoToastProvider } from "./components/ui/undo-toast";
import { ThemeProvider } from "./lib/ThemeContext";

const loadPromptStudio = () => import("./features/prompt-studio");
const loadGallery = () => import("./features/gallery");
const loadPromptLibrary = () => import("./pages/PromptLibrary");
const loadWorkflowLibrary = () => import("./pages/WorkflowLibrary");
const loadModels = () => import("./pages/Models");
const loadProjects = () => import("./pages/Projects");
const loadSettings = () => import("./features/settings");

const PromptStudio = lazy(loadPromptStudio);
const Gallery = lazy(loadGallery);
const PromptLibrary = lazy(loadPromptLibrary);
const WorkflowLibrary = lazy(loadWorkflowLibrary); // Will be renamed to PipesLibrary
const Models = lazy(loadModels);
const Projects = lazy(loadProjects);
const Settings = lazy(loadSettings);

function App() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const warmRoutes = () => {
      void Promise.allSettled([
        loadProjects(),
        loadWorkflowLibrary(),
        loadGallery(),
        loadPromptLibrary(),
        loadModels(),
        loadSettings(),
      ]);
    };

    const windowWithIdle = window as Window & {
      requestIdleCallback?: (cb: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof windowWithIdle.requestIdleCallback === "function") {
      const idleId = windowWithIdle.requestIdleCallback(() => warmRoutes(), { timeout: 1200 });
      return () => {
        if (typeof windowWithIdle.cancelIdleCallback === "function") {
          windowWithIdle.cancelIdleCallback(idleId);
        }
      };
    }

    const timeoutId = window.setTimeout(() => warmRoutes(), 250);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <ThemeProvider>
      <GenerationProvider>
        <UndoToastProvider>
          <BrowserRouter>
            <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading Sweet Tea Studio...</div>}>
              <Routes>
                <Route element={
                  <ErrorBoundary>
                    <Layout />
                  </ErrorBoundary>
                }>
                  <Route path="/" element={<PromptStudio />} />
                  <Route path="/projects" element={<Projects />} />
                  <Route path="/pipes" element={<WorkflowLibrary />} />
                  <Route path="/gallery" element={<Gallery />} />
                  <Route path="/library" element={<PromptLibrary />} />
                  <Route path="/models" element={<Models />} />
                  <Route path="/settings" element={<Settings />} />
                  {/* Legacy route redirect for bookmarks */}
                  <Route path="/workflows" element={<WorkflowLibrary />} />
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </UndoToastProvider>
      </GenerationProvider>
    </ThemeProvider>
  );
}

export default App;

