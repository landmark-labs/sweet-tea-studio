import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import PromptStudio from "./pages/PromptStudio";
import Gallery from "./pages/Gallery";
import PromptLibrary from "./pages/PromptLibrary";
import WorkflowLibrary from "./pages/WorkflowLibrary"; // Will be renamed to PipesLibrary
import Models from "./pages/Models";
import Projects from "./pages/Projects";
import Settings from "./pages/Settings";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { GenerationProvider } from "./lib/GenerationContext";

function App() {
  return (
    <GenerationProvider>
      <BrowserRouter>
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
      </BrowserRouter>
    </GenerationProvider>
  );
}

export default App;

