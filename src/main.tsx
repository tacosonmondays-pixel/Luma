import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Tokens, reset and shared components first, so the feature styles that App's components import can override them.
import './styles/base.css'
import './styles/y2k.css'
// Side-effect modules: the theme/accent wiring and the play log listen from app start.
import './lib/appearance.ts'
import './lib/plays.ts'
import { App } from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const base = import.meta.env.BASE_URL
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {})
}
