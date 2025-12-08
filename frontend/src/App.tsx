import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import PromptStudio from "./pages/PromptStudio";
import Gallery from "./pages/Gallery";
import PromptLibrary from "./pages/PromptLibrary";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<PromptStudio />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/library" element={<PromptLibrary />} />
          <Route path="/engines" element={<div>Engines</div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
