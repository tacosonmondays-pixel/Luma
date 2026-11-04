// Pure play-queue logic. No DOM, no stores — unit tested in test/queue.test.ts.

import type { Track } from '../types.ts'

export type Repeat = 'off' | 'all' | 'one'

export interface Queue {
  ids: string[]
  index: number // -1 when empty
  original: string[] | null // order before shuffling, while shuffle is on
}

export const emptyQueue: Queue = { ids: [], index: -1, original: null }

export function shuffled<T>(items: readonly T[], random = Math.random): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** A new queue playing `ids` from `at`. With shuffle and `at` < 0, starts on a random track. */
export function start(ids: readonly string[], at: number, shuffle: boolean, random = Math.random): Queue {
  if (!ids.length) return emptyQueue
  if (!shuffle) return { ids: [...ids], index: Math.min(Math.max(at, 0), ids.length - 1), original: null }
  const first = at >= 0 ? Math.min(at, ids.length - 1) : Math.floor(random() * ids.length)
  const rest = ids.filter((_, i) => i !== first)
  return { ids: [ids[first], ...shuffled(rest, random)], index: 0, original: [...ids] }
}

/** Where to go after the current track. `auto` means the track finished on its own. */
export function next(q: Queue, repeat: Repeat, auto: boolean): { index: number; play: boolean } {
  if (auto && repeat === 'one') return { index: q.index, play: true }
  if (q.index + 1 < q.ids.length) return { index: q.index + 1, play: true }
  return { index: 0, play: repeat === 'all' }
}

/** Previous restarts the track after 3 s, like every music app. */
export function previous(q: Queue, repeat: Repeat, time: number): { index: number; restart: boolean } {
  if (time > 3 || (q.index <= 0 && repeat !== 'all')) return { index: q.index, restart: true }
  return { index: q.index > 0 ? q.index - 1 : q.ids.length - 1, restart: false }
}

export function setShuffle(q: Queue, on: boolean, random = Math.random): Queue {
  const current = q.ids[q.index]
  if (current === undefined) return q
  if (on) {
    if (q.original) return q
    const rest = q.ids.filter((_, i) => i !== q.index)
    return { ids: [current, ...shuffled(rest, random)], index: 0, original: q.ids }
  }
  if (!q.original) return q
  return { ids: q.original, index: Math.max(0, q.original.indexOf(current)), original: null }
}

export function remove(q: Queue, id: string): Queue {
  const at = q.ids.indexOf(id)
  if (at < 0) return q
  const ids = q.ids.filter((x) => x !== id)
  const original = q.original ? q.original.filter((x) => x !== id) : null
  if (!ids.length) return emptyQueue
  const index = at < q.index ? q.index - 1 : Math.min(q.index, ids.length - 1)
  return { ids, index, original }
}

/** Put `id` right after the current track (moving it if it is already queued). */
export function insertNext(q: Queue, id: string): Queue {
  const current = q.ids[q.index]
  if (current === undefined) return { ids: [id], index: 0, original: null }
  if (current === id) return q
  const base = remove(q, id)
  const ids = [...base.ids]
  ids.splice(base.index + 1, 0, id)
  let original = base.original
  if (original) {
    original = [...original]
    original.splice(original.indexOf(current) + 1, 0, id)
  }
  return { ids, index: base.index, original }
}

/** The ids that can play: in the library with their audio. Saved and synced songs that aren't downloaded are skipped. */
export function playable(ids: readonly string[], tracks: Record<string, Track | undefined>): string[] {
  return ids.filter((id) => tracks[id] && !tracks[id].missing)
}
