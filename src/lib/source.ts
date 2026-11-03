// Where search and downloads come from. With the helper (npm start on a computer), its yt-dlp does both.
// Without it (GitHub Pages, phone only), search uses the YouTube Data API and downloads go through the
// "Save to Luma" iOS Shortcut, whose files come back in through Import.

import { create } from 'zustand'
import * as helper from './helper.ts'
import { importFiles } from './files.ts'
import { useLibrary } from './library.ts'
import * as youtube from './youtube.ts'
import type { SearchResponse, SearchResult, SearchSort } from '../types.ts'

export type Mode = 'helper' | 'phone'

/** What Search shows instead of results. */
export type Problem = 'offline' | 'missing' | 'key' | 'quota' | 'failed'

interface SourceState {
  mode: Mode | null // null until the first check
  importing: boolean // the Shortcut was opened and the user came back: offer Import
}

export const useSource = create<SourceState>()(() => ({ mode: null, importing: false }))

const BASE = import.meta.env.BASE_URL

/** Look for the helper. Resolves to the problem to show before any search, if there is one. */
export async function detect(): Promise<Problem | null> {
  try {
    const h = await helper.health()
    useSource.setState({ mode: 'helper' })
    return h.ytdlp ? null : 'missing'
  } catch {
    useSource.setState({ mode: 'phone' })
    return youtube.useYouTubeKey.getState().trim() ? null : 'key'
  }
}

export async function mode(): Promise<Mode> {
  if (!useSource.getState().mode) await detect()
  return useSource.getState().mode!
}

export function problemOf(e: unknown): Problem {
  if (e instanceof helper.HelperError) return e.code === 'offline' ? 'offline' : e.code === 'ytdlp-missing' ? 'missing' : 'failed'
  if (e instanceof youtube.YouTubeError) return e.code === 'key' || e.code === 'quota' || e.code === 'offline' ? e.code : 'failed'
  return 'failed'
}

export async function search(q: string, sort: SearchSort, signal?: AbortSignal): Promise<SearchResponse> {
  return (await mode()) === 'helper' ? helper.search(q, sort, signal) : youtube.search(q, sort, signal)
}

/** Cover image URLs for a result, best first. */
export function thumbnails(id: string, small: boolean): string[] {
  if (useSource.getState().mode === 'phone') return youtube.thumbnails(id, small)
  return [`${BASE}api/cover/${id}${small ? '?small=1' : ''}`]
}

// ── Downloads ────────────────────────────────────────────────────────────

const SHORTCUT = 'Save to Luma'
let awaiting = false

/** Hand a YouTube link to the "Save to Luma" Shortcut. */
export function runShortcut(url: string): void {
  awaiting = true
  location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT)}&input=text&text=${encodeURIComponent(url)}`
}

document.addEventListener('visibilitychange', () => {
  if (awaiting && document.visibilityState === 'visible') useSource.setState({ importing: true })
})

/** Import the files the Shortcut saved. `files` comes from a file picker opened by the user's tap. */
export async function importDownloads(files: File[]): Promise<void> {
  if (!files.length) return
  awaiting = false
  useSource.setState({ importing: false })
  await importFiles(files)
}

/**
 * Download a result into the library. With the helper, resolves true once it is saved. Without it, opens the
 * Shortcut and resolves false: the song arrives later through Import.
 */
export function downloadTrack(result: SearchResult): Promise<boolean> {
  if (useSource.getState().mode === 'phone') {
    runShortcut(`https://www.youtube.com/watch?v=${result.id}`)
    return Promise.resolve(false)
  }
  return helper.downloadTrack(result)
}

/** Download every result of a playlist. `query` is the playlist link that was searched. */
export function downloadAll(results: SearchResult[], query: string): void {
  if (useSource.getState().mode === 'phone') {
    const list = youtube.parseLink(query)?.list
    if (list) return runShortcut(`https://www.youtube.com/playlist?list=${list}`)
  }
  void helper.downloadAll(results)
}

// ── Saved songs ──────────────────────────────────────────────────────────
// A saved song is in the library without its audio (`Track.missing`): saved from a YouTube link, a linked
// playlist, or synced from another device. It downloads with whichever downloader there is.

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`
export const playlistUrl = (list: string) => `https://www.youtube.com/playlist?list=${list}`

/** Liked videos (LL…) and Watch Later (WL) need the owner's sign-in; yt-dlp in a-Shell can't list them. */
const isPrivateList = (list: string) => /^(LL|WL)/.test(list)

/** Saved songs among `ids` that a downloader can fetch (YouTube ones; an imported file can't come back that way). */
export function downloadable(ids: readonly string[]): string[] {
  const { tracks } = useLibrary.getState()
  return ids.filter((id) => tracks[id]?.missing && tracks[id].source === 'youtube')
}

const resultOf = (id: string): SearchResult => {
  const t = useLibrary.getState().tracks[id]!
  return { id, title: t.title, channel: t.artist, duration: t.duration }
}

/**
 * Download a saved song. With the helper, resolves true once it is saved. Without it, opens the Shortcut and
 * resolves false: the song arrives through Import and fills in where it is. Call it from the tap (iOS asks
 * before opening Shortcuts, and only for a tap).
 */
export function downloadSaved(id: string): Promise<boolean> {
  if (!downloadable([id]).length) return Promise.resolve(false)
  const run = (m: Mode) => {
    if (m === 'phone') {
      runShortcut(watchUrl(id))
      return false
    }
    return helper.downloadTrack(resultOf(id))
  }
  const known = useSource.getState().mode
  return known ? Promise.resolve(run(known)) : mode().then(run)
}

/** Download Missing: every saved song in `ids`. On the phone, a linked playlist goes to the Shortcut whole
 *  (Import skips what is already here); otherwise the Shortcut takes one song at a time, so the first one goes. */
export function downloadMissing(ids: readonly string[], list?: string): void {
  const missing = downloadable(ids)
  if (!missing.length) return
  const run = (m: Mode) => {
    if (m === 'phone') return runShortcut(list && !isPrivateList(list) ? playlistUrl(list) : watchUrl(missing[0]))
    void helper.downloadAll(missing.map(resultOf))
  }
  const known = useSource.getState().mode
  if (known) run(known)
  else void mode().then(run)
}
