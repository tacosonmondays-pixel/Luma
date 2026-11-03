// Home: which shelves show and in what order, the custom search shelves, and which playlists were played
// (the play log only knows songs). Persisted to localStorage under `luma-home`.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { uid } from './format.ts'
import { useLibrary } from './library.ts'
import { usePlayer } from './player.ts'
import { playlistOf } from './shelves.ts'
import type { SearchSort } from '../types.ts'

export type BuiltinShelf = 'continue' | 'quick' | 'jump' | 'repeat' | 'mix' | 'artists' | 'saved' | 'playlists'

/** The default order. */
export const BUILTIN: BuiltinShelf[] = ['continue', 'quick', 'jump', 'repeat', 'mix', 'artists', 'saved', 'playlists']

export const BUILTIN_TITLES: Record<BuiltinShelf, string> = {
  continue: 'Continue',
  quick: 'Quick Picks',
  jump: 'Jump Back In',
  repeat: 'On Repeat',
  mix: 'Mix',
  artists: 'New from Your Artists',
  saved: 'Recently Saved',
  playlists: 'Your Playlists',
}

/** A shelf of search results, added in Edit Home. Its id starts with `c-`. */
export interface CustomShelf {
  id: string
  query: string
  sort: SearchSort
}

/** A playlist starting to play. */
export interface PlaylistPlay {
  id: string
  at: number
}

export interface HomeLayout {
  order: string[] // every shelf id, built-in and custom
  hidden: string[]
  custom: CustomShelf[]
}

interface HomeState extends HomeLayout {
  played: PlaylistPlay[] // oldest first, the last MAX_PLAYED
}

export const MAX_QUERY = 100
const MAX_PLAYED = 60
const SAME_LISTEN = 30 * 60_000 // starting the same playlist again within this is the same listen
const SORTS: SearchSort[] = ['relevance', 'recent', 'popular']

export const isBuiltin = (id: string): id is BuiltinShelf => (BUILTIN as string[]).includes(id)

// ── Layout (pure) ────────────────────────────────────────────────────────

export const defaultLayout = (): HomeLayout => ({ order: [...BUILTIN], hidden: [], custom: [] })

/** Repair a stored layout: drop unknown and repeated ids, and put back shelves it lacks (a built-in one added in
 * a later version goes where the default order puts it). */
export function normalize(stored: Partial<HomeLayout> | undefined): HomeLayout {
  const custom = (Array.isArray(stored?.custom) ? stored.custom : []).filter(
    (c, i, all): c is CustomShelf =>
      !!c && typeof c.id === 'string' && c.id.startsWith('c-') && typeof c.query === 'string' && !!c.query.trim() &&
      SORTS.includes(c.sort) && all.findIndex((d) => d?.id === c.id) === i,
  )
  const known = new Set<string>([...BUILTIN, ...custom.map((c) => c.id)])
  const order: string[] = []
  for (const id of Array.isArray(stored?.order) ? stored.order : []) if (known.has(id) && !order.includes(id)) order.push(id)
  BUILTIN.forEach((id, i) => {
    if (order.includes(id)) return
    const after = BUILTIN.slice(0, i).reverse().find((b) => order.includes(b))
    order.splice(after ? order.indexOf(after) + 1 : 0, 0, id)
  })
  for (const c of custom) if (!order.includes(c.id)) order.push(c.id)
  const hidden = (Array.isArray(stored?.hidden) ? stored.hidden : []).filter((id, i, all) => known.has(id) && all.indexOf(id) === i)
  return { order, hidden, custom }
}

/** Move the shelf at `from` to `to`. */
export function moved(layout: HomeLayout, from: number, to: number): HomeLayout {
  const { order } = layout
  if (from === to || from < 0 || from >= order.length) return layout
  const next = [...order]
  const [id] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id)
  return { ...layout, order: next }
}

export function withVisible(layout: HomeLayout, id: string, visible: boolean): HomeLayout {
  if (!layout.order.includes(id) || visible === !layout.hidden.includes(id)) return layout
  return { ...layout, hidden: visible ? layout.hidden.filter((h) => h !== id) : [...layout.hidden, id] }
}

/** Add a search shelf at the end. A blank query adds nothing. */
export function withCustom(layout: HomeLayout, query: string, sort: SearchSort, id = `c-${uid()}`): HomeLayout {
  const q = query.trim().slice(0, MAX_QUERY)
  if (!q || !SORTS.includes(sort)) return layout
  return { ...layout, custom: [...layout.custom, { id, query: q, sort }], order: [...layout.order, id] }
}

export function withoutCustom(layout: HomeLayout, id: string): HomeLayout {
  if (!layout.custom.some((c) => c.id === id)) return layout
  return {
    order: layout.order.filter((o) => o !== id),
    hidden: layout.hidden.filter((h) => h !== id),
    custom: layout.custom.filter((c) => c.id !== id),
  }
}

/** The shelves to show, in order. */
export const visibleShelves = (layout: HomeLayout): string[] => layout.order.filter((id) => !layout.hidden.includes(id))

/** Note a playlist starting. Starting it again soon after (or another step of the same listen) updates the time. */
export function withPlayed(played: PlaylistPlay[], id: string, at: number): PlaylistPlay[] {
  const last = played[played.length - 1]
  if (last?.id === id && at - last.at < SAME_LISTEN) return [...played.slice(0, -1), { id, at }]
  return [...played, { id, at }].slice(-MAX_PLAYED)
}

// ── Store ────────────────────────────────────────────────────────────────

export const useHome = create<HomeState>()(
  persist((): HomeState => ({ ...defaultLayout(), played: [] }), {
    name: 'luma-home',
    merge: (stored, current) => {
      const s = (stored ?? {}) as Partial<HomeState>
      const played = Array.isArray(s.played) ? s.played.filter((p) => p && typeof p.id === 'string' && Number.isFinite(p.at)) : []
      return { ...current, ...normalize(s), played }
    },
  }),
)

const layoutOf = ({ order, hidden, custom }: HomeLayout): HomeLayout => ({ order, hidden, custom })
const change = (fn: (layout: HomeLayout) => HomeLayout) => useHome.setState((s) => fn(layoutOf(s)))

export const moveShelf = (from: number, to: number) => change((l) => moved(l, from, to))
export const setShelfVisible = (id: string, visible: boolean) => change((l) => withVisible(l, id, visible))
export const addCustomShelf = (query: string, sort: SearchSort) => change((l) => withCustom(l, query, sort))
export const deleteCustomShelf = (id: string) => change((l) => withoutCustom(l, id))
export const notePlaylistPlayed = (id: string, at = Date.now()) => useHome.setState((s) => ({ played: withPlayed(s.played, id, at) }))

// ── Wiring ───────────────────────────────────────────────────────────────

// A new queue that is a playlist's songs means that playlist started (from its page, a menu or Home).
if (typeof document !== 'undefined') {
  usePlayer.subscribe((s, prev) => {
    const base = s.queue.original ?? s.queue.ids
    const before = prev.queue.original ?? prev.queue.ids
    if (base === before || !base.length) return // shuffling keeps the same list
    const { playlists, tracks } = useLibrary.getState()
    const playlist = playlistOf(base, playlists, tracks)
    if (playlist) notePlaylistPlayed(playlist.id)
  })
}
