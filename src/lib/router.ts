import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'songs' }
  | { name: 'playlists' }
  | { name: 'playlist'; id: string }
  | { name: 'search' }
  | { name: 'you' }
  | { name: 'user'; handle: string } // someone's public profile, /u/<handle>
  | { name: 'save' } // /save?u=<YouTube link>: save its songs (the extension, luma://save, links)

/** Where the app is served: '/' from the helper, '/Luma/' on GitHub Pages. Always ends in '/'. */
const BASE = import.meta.env.BASE_URL

/** An app path ('/search') → the URL path to put in the address bar ('/Luma/search'). */
export function href(path: string): string {
  return BASE + path.replace(/^\//, '')
}

/** A URL path → the app path, or '/' for anything outside the base. */
export function appPath(pathname: string): string {
  return pathname.startsWith(BASE) ? '/' + pathname.slice(BASE.length) : '/'
}

export function parse(path: string): Route {
  const [, first = '', second = ''] = path.split('/')
  if (first === 'playlists') return { name: 'playlists' }
  if (first === 'playlist' && second) return { name: 'playlist', id: decodeURIComponent(second) }
  if (first === 'search') return { name: 'search' }
  if (first === 'you') return { name: 'you' }
  if (first === 'u' && second) return { name: 'user', handle: decodeURIComponent(second) }
  if (first === 'save') return { name: 'save' }
  return { name: 'songs' }
}

const listeners = new Set<() => void>()
window.addEventListener('popstate', () => listeners.forEach((l) => l()))

export function navigate(path: string, replace = false): void {
  const url = href(path)
  if (url === location.pathname) return
  history[replace ? 'replaceState' : 'pushState'](null, '', url)
  listeners.forEach((l) => l())
  window.scrollTo(0, 0)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** The current app path, without the base. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, () => appPath(location.pathname))
}
