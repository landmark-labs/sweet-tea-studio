import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { UndoRedoProvider } from './lib/undoRedo'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UndoRedoProvider>
      <App />
    </UndoRedoProvider>
  </StrictMode>,
)
