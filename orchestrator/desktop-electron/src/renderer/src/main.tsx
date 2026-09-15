import './browserApi'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { RunProvider } from './store/runs'
import './styles.css'
import './admin/admin-pages.css'
import './admin/admin-overview.css'
import './admin/admin-themes.css'
import { initAdminTheme } from './admin/theme/adminThemes'

initAdminTheme()

function preventWindowFileOpen(event: DragEvent): void {
  event.preventDefault()
}

window.addEventListener('dragover', preventWindowFileOpen)
window.addEventListener('drop', preventWindowFileOpen)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RunProvider>
      <App />
    </RunProvider>
  </StrictMode>
)
