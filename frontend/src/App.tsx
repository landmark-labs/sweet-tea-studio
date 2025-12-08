import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import PromptStudio from "./pages/PromptStudio";
import Gallery from "./pages/Gallery";
import PromptLibrary from "./pages/PromptLibrary";
import WorkflowLibrary from "./pages/WorkflowLibrary";
import Models from "./pages/Models";

import { ErrorBoundary } from "./components/ErrorBoundary";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={
          <ErrorBoundary>
            <Layout />
          </ErrorBoundary>
        }>
          <Route path="/" element={<PromptStudio />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/library" element={<PromptLibrary />} />
          <Route path="/workflows" element={<WorkflowLibrary />} />
          <Route path="/models" element={<Models />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
