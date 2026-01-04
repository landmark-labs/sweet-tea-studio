import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GenerationProvider } from "./lib/GenerationContext";
import { UndoToastProvider } from "./components/ui/undo-toast";
import { ThemeProvider } from "./lib/ThemeContext";

const PromptStudio = lazy(() => import("./pages/PromptStudio"));
const Gallery = lazy(() => import("./pages/Gallery"));
const PromptLibrary = lazy(() => import("./pages/PromptLibrary"));
const WorkflowLibrary = lazy(() => import("./pages/WorkflowLibrary")); // Will be renamed to PipesLibrary
const Models = lazy(() => import("./pages/Models"));
const Projects = lazy(() => import("./pages/Projects"));
const Settings = lazy(() => import("./pages/Settings"));

function App() {
  return (
    <ThemeProvider>
      <GenerationProvider>
        <UndoToastProvider>
          <BrowserRouter>
            <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading Sweet Tea Studio…</div>}>
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

