import './perfGuard'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider as JotaiProvider } from 'jotai'
import './index.css'
import App from './App.tsx'
import { UndoRedoProvider } from './lib/undoRedo'
import { AuthProvider } from './lib/auth'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <JotaiProvider>
      <AuthProvider>
        <UndoRedoProvider>
          <App />
        </UndoRedoProvider>
      </AuthProvider>
    </JotaiProvider>
  </StrictMode>,
)
