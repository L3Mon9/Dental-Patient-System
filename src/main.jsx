import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Portal from './Portal.jsx'
import FontControls from './FontControls.jsx'
import './theme.css'

try {
  document.documentElement.dataset.theme = localStorage.getItem('jhon-theme') === 'dark' ? 'dark' : 'light'
} catch {
  document.documentElement.dataset.theme = 'light'
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FontControls /><Portal />
  </StrictMode>,
)


