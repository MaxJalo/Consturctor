import './browserApi'
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import './layout/orchGrid.css'
import './tabs/grid/todayGrid.css'

function preventWindowFileOpen(event: DragEvent): void {
  event.preventDefault()
}

window.addEventListener('dragover', preventWindowFileOpen)
window.addEventListener('drop', preventWindowFileOpen)

const container = document.getElementById('root')!
const hot = import.meta.hot
let root: Root = hot?.data.root as Root
if (!root) {
  root = createRoot(container)
  if (hot) hot.data.root = root
}

root.render(
  <StrictMode>
    <App />
  </StrictMode>
)
