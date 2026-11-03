// The helper API client (server/api.ts): health, search, and downloads into the library.

import { create } from 'zustand'
import { addTrack, isDownloaded, useLibrary } from './library.ts'
import { cleanTitle } from './titles.ts'
import type { ApiError, Health, SearchResponse, SearchResult, SearchSort } from '../types.ts'

/** A failed helper request. `offline` means the helper could not be reached at all. */
export class HelperError extends Error {
  code: ApiError['error'] | 'offline'
  constructor(code: ApiError['error'] | 'offline') {
    super(code)
    this.code = code
  }
}

const API = `${import.meta.env.BASE_URL}api/`

async function request(path: string, signal?: AbortSignal): Promise<Response> {
  let r: Response
  try {
    r = await fetch(path, { signal })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new HelperError('offline')
  }
  if (r.ok) return r
  const body = (await r.json().catch(() => null)) as Partial<ApiError> | null
  // Anything without our error body (a proxy, a dev server without the API) means the helper isn't there.
  throw new HelperError(body?.error ?? 'offline')
}

export async function health(): Promise<Health> {
  return (await request(`${API}health`)).json()
}

export async function search(q: string, sort: SearchSort, signal?: AbortSignal): Promise<SearchResponse> {
  const params = new URLSearchParams({ q, sort })
  return (await request(`${API}search?${params}`, signal)).json()
}

/** YouTube's radio mix for a video (helper only). */
export async function mix(id: string, signal?: AbortSignal): Promise<SearchResponse> {
  return (await request(`${API}mix/${encodeURIComponent(id)}`, signal)).json()
}

// ── Downloads ────────────────────────────────────────────────────────────

/** id → progress 0..1, null while waiting or when the size is unknown, or 'error'. Cleared on success. */
export type DownloadState = number | null | 'error'
export const useDownloads = create<Record<string, DownloadState>>()(() => ({}))

const setProgress = (id: string, state: DownloadState) => useDownloads.setState({ [id]: state })

function clear(id: string) {
  useDownloads.setState((s) => {
    const next = { ...s }
    delete next[id]
    return next
  }, true)
}

const MAX_PARALLEL = 2
let running = 0
const waiting: (() => void)[] = []
const inflight = new Map<string, Promise<boolean>>()

async function slot(): Promise<() => void> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  return () => {
    running--
    waiting.shift()?.()
  }
}

/** Read a response body, reporting progress from Content-Length. */
async function readBody(r: Response, onProgress: (p: number | null) => void): Promise<Blob> {
  const type = r.headers.get('Content-Type') ?? 'application/octet-stream'
  const total = Number(r.headers.get('Content-Length')) || 0
  if (!r.body) return r.blob()
  const reader = r.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let received = 0
  onProgress(total ? 0 : null)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    if (total) onProgress(Math.min(received / total, 1))
  }
  return new Blob(chunks, { type })
}

async function fetchCover(id: string): Promise<Blob | null> {
  try {
    const r = await fetch(`${API}cover/${id}`)
    return r.ok ? await r.blob() : null
  } catch {
    return null
  }
}

/** Download a result into the library. Resolves true once it is saved, false on failure. Never rejects. */
export function downloadTrack(result: SearchResult): Promise<boolean> {
  const { id } = result
  if (isDownloaded(useLibrary.getState().tracks[id])) return Promise.resolve(true)
  const existing = inflight.get(id)
  if (existing) return existing
  const job = (async () => {
    setProgress(id, null)
    const release = await slot()
    try {
      const [audio, cover] = await Promise.all([
        request(`${API}audio/${id}`).then((r) => readBody(r, (p) => setProgress(id, p))),
        fetchCover(id),
      ])
      const { title, artist } = cleanTitle(result.title, result.channel)
      await addTrack({ id, title, artist, duration: result.duration, source: 'youtube', addedAt: Date.now() }, audio, cover)
      clear(id)
      return true
    } catch (e) {
      console.error(`download ${id} failed`, e)
      setProgress(id, 'error')
      return false
    } finally {
      release()
      inflight.delete(id)
    }
  })()
  inflight.set(id, job)
  return job
}

/** Download every result that isn't saved yet, two at a time. */
export function downloadAll(results: SearchResult[]): Promise<boolean[]> {
  return Promise.all(results.map(downloadTrack))
}
