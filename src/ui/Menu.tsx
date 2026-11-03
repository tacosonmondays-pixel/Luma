// Placeholder — replaced by its owning work session. Keep these exports and signatures.
import type { IconName } from './Icon.tsx'

export interface MenuItem {
  label: string
  icon?: IconName
  danger?: boolean
  onSelect?: () => void
  items?: MenuItem[] // opens a submenu instead of selecting
}

/** Show a menu anchored to an element (e.g. the button that was clicked). */
export function openMenu(_anchor: HTMLElement, _items: MenuItem[]): void {}

/** The song menu used everywhere: Play Next, Add to Playlist, Change Cover, Remove from Playlist, Delete. */
export function openTrackMenu(_anchor: HTMLElement, _trackId: string, _playlistId?: string): void {}

/** Rendered once by App. */
export function MenuHost() {
  return null
}
