// Home's network shelves (Mix, New from Your Artists, search shelves): fetched at most once a day per query and
// kept in IndexedDB, so visiting Home costs nothing. In phone mode each search spends YouTube API quota (about
// 100 a day), so a day's answer is reused, and after a quota error nothing more is asked this session.

import { createStore, get, set } from 'idb-keyval'
import { mix, problemOf, search, useSource } from './source.ts'
import { byArtists } from './shelves.ts'
import type { SearchResult, SearchSort } from '../types.ts'

interface Entry {
  day: string
  results: SearchResult[]
}

const store = createStore('luma-home', 'feed')
const memory = new Map<string, Entry>()
let quotaHit = false

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** Today's answer, if it is already in memory (renders without a loading step). */
export function peek(key: string): SearchResult[] | undefined {
  const hit = memory.get(key)
  return hit?.day === today() ? hit.results : undefined
}

/**
 * Today's results for `key`, fetching them only if this day has none yet. Resolves null when there is nothing to
 * show: offline, no helper or key, a failed request. A failed request falls back to an earlier day's answer.
 * Rejects only when `signal` aborts.
 */
export async function daily(key: string, fetcher: (signal: AbortSignal) => Promise<SearchResult[]>, signal: AbortSignal): Promise<SearchResult[] | null> {
  let entry = memory.get(key)
  if (!entry) {
    entry = await get<Entry>(key, store).catch(() => undefined)
    if (entry) memory.set(key, entry)
  }
  if (entry?.day === today()) return entry.results
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null // thumbnails wouldn't load either
  if (quotaHit && useSource.getState().mode === 'phone') return entry?.results ?? null
  try {
    const results = await fetcher(signal)
    const fresh = { day: today(), results }
    memory.set(key, fresh)
    void set(key, fresh, store).catch(() => {})
    return results
  } catch (e) {
    if (signal.aborted) throw e
    if (problemOf(e) === 'quota') quotaHit = true
    return entry?.results ?? null
  }
}

/** A search shelf's results. */
export const searchKey = (query: string, sort: SearchSort) => `search:${sort}:${query.trim().toLowerCase()}`
export const loadSearch = (query: string, sort: SearchSort, signal: AbortSignal) =>
  daily(searchKey(query, sort), async (s) => (await search(query, sort, s)).results, signal)

/** YouTube's radio mix for a song, without the song itself. Null in phone mode. */
export const loadMix = (seed: string, signal: AbortSignal) =>
  daily(`mix:${seed}`, async (s) => (await mix(seed, s))?.results.filter((r) => r.id !== seed) ?? [], signal)

/** Recent uploads by each artist, artists taking turns. Each artist's search is cached on its own. */
export async function loadArtists(artists: string[], signal: AbortSignal): Promise<SearchResult[] | null> {
  const lists = await Promise.all(artists.map((a) => loadSearch(a, 'recent', signal)))
  if (lists.every((l) => l === null)) return null
  return byArtists(lists.map((l) => l ?? []), artists)
}
