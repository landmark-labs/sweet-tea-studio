import './perfGuard'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider as JotaiProvider } from 'jotai'
import './index.css'
import App from './App.tsx'
import { UndoRedoProvider } from './lib/undoRedo'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <JotaiProvider>
      <UndoRedoProvider>
        <App />
      </UndoRedoProvider>
    </JotaiProvider>
  </StrictMode>,
)
