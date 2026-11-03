// Theme, cover colors and player style. Persisted on this device (localStorage, read synchronously).
//
// Importing this module applies the theme to <html> and keeps `--accent` following the current song's cover.
// index.html sets the stored theme before the first paint, so the page never flashes the default theme.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useLibrary } from './library.ts'
import { coverLook } from './palette.ts'
import { usePlayer } from './player.ts'
import type { Track } from '../types.ts'

export type ThemeId = 'luma' | 'black' | 'mocha' | 'fjord' | 'rose' | 'y2k'
export type PlayerStyle = 'color' | 'vinyl' | 'canvas'

/** Each theme's background and accent, for the picker's swatches. */
export const THEMES: { id: ThemeId; name: string; bg: string; accent: string }[] = [
  { id: 'luma', name: 'Luma', bg: '#0a0a0c', accent: '#a596ff' },
  { id: 'black', name: 'Black', bg: '#000000', accent: '#a596ff' },
  { id: 'mocha', name: 'Mocha', bg: '#1e1e2e', accent: '#cba6f7' },
  { id: 'fjord', name: 'Fjord', bg: '#2e3440', accent: '#88c0d0' },
  { id: 'rose', name: 'Rosé', bg: '#191724', accent: '#ebbcba' },
  { id: 'y2k', name: 'Y2K', bg: '#cfe6ff', accent: '#2a6be0' },
]

export const PLAYER_STYLES: { id: PlayerStyle; name: string }[] = [
  { id: 'color', name: 'Color' },
  { id: 'vinyl', name: 'Vinyl' },
  { id: 'canvas', name: 'Canvas' },
]

interface Appearance {
  theme: ThemeId
  coverColors: boolean
  playerStyle: PlayerStyle
}

export const useAppearance = create<Appearance>()(
  persist((): Appearance => ({ theme: 'luma', coverColors: true, playerStyle: 'color' }), { name: 'luma-appearance' }),
)

export const setTheme = (theme: ThemeId) => useAppearance.setState({ theme })
export const setCoverColors = (coverColors: boolean) => useAppearance.setState({ coverColors })
export const setPlayerStyle = (playerStyle: PlayerStyle) => useAppearance.setState({ playerStyle })

/** The style Now Playing shows for a song: Canvas needs the song's own canvas, else it falls back to Color. */
export function styleFor(style: PlayerStyle, track: Track | undefined): PlayerStyle {
  return style === 'canvas' && !track?.canvas ? 'color' : style
}

// ── Side effects (browser only) ─────────────────────────────────────────

const root = typeof document === 'undefined' ? undefined : document.documentElement

function applyTheme(theme: ThemeId) {
  if (!root) return
  if (theme === 'luma') delete root.dataset.theme
  else root.dataset.theme = theme
  // Desktop PWA title bars and Safari's tab tint follow the theme's background.
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta && bg) meta.content = bg
}

let token = 0
async function applyAccent() {
  if (!root) return
  const mine = ++token
  const { queue } = usePlayer.getState()
  const track = useLibrary.getState().tracks[queue.ids[queue.index] ?? '']
  const look = useAppearance.getState().coverColors && track?.cover ? await coverLook(`cover:${track.id}`, track.cover) : undefined
  if (mine !== token) return
  // No accent (Cover Colors off, a grey cover, no cover): the theme's own accent shows (`--theme-accent`).
  if (look?.accent) root.style.setProperty('--accent', look.accent)
  else root.style.removeProperty('--accent')
}

if (root) {
  applyTheme(useAppearance.getState().theme)
  useAppearance.subscribe((s, prev) => {
    if (s.theme !== prev.theme) applyTheme(s.theme)
    if (s.coverColors !== prev.coverColors) void applyAccent()
  })
  // Another tab (the installed app next to a browser tab) changed a setting: take it, so a later change made
  // here doesn't write this tab's stale choices back over it.
  window.addEventListener('storage', (e) => {
    if (e.key === useAppearance.persist.getOptions().name) void useAppearance.persist.rehydrate()
  })
  const coverOf = () => {
    const { queue } = usePlayer.getState()
    const id = queue.ids[queue.index]
    const track = id === undefined ? undefined : useLibrary.getState().tracks[id]
    return `${id}:${track?.cover}`
  }
  let last = ''
  const check = () => {
    const now = coverOf()
    if (now === last) return
    last = now
    void applyAccent()
  }
  usePlayer.subscribe(check)
  useLibrary.subscribe(check)
  check()
}
