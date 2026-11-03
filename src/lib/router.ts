import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'songs' }
  | { name: 'playlists' }
  | { name: 'playlist'; id: string }
  | { name: 'search' }
  | { name: 'you' }

export function parse(path: string): Route {
  const [, first = '', second = ''] = path.split('/')
  if (first === 'playlists') return { name: 'playlists' }
  if (first === 'playlist' && second) return { name: 'playlist', id: decodeURIComponent(second) }
  if (first === 'search') return { name: 'search' }
  if (first === 'you') return { name: 'you' }
  return { name: 'songs' }
}

const listeners = new Set<() => void>()
window.addEventListener('popstate', () => listeners.forEach((l) => l()))

export function navigate(path: string, replace = false): void {
  if (path === location.pathname) return
  history[replace ? 'replaceState' : 'pushState'](null, '', path)
  listeners.forEach((l) => l())
  window.scrollTo(0, 0)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname)
}
