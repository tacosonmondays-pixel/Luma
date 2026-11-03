// Shared data shapes. The server imports these as types only.

/** A blob version. Undefined means "no blob". Bump it to replace the blob. */
export type Version = number | undefined

export interface Track {
  id: string // YouTube video id, or `f-…` for imported files
  title: string
  artist: string
  duration: number // seconds, 0 when unknown
  source: 'youtube' | 'file'
  addedAt: number
  cover?: number // blob `cover:<id>`
}

export interface Playlist {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
  cover?: number // blob `playlist-cover:<id>`
}

export interface Profile {
  name: string
  avatar?: number // blob `avatar`
  banner?: number // blob `banner`
}

export interface Background {
  v: number // blob `background`
  kind: 'image' | 'video'
}

// ── Helper API (server/api.ts) ──────────────────────────────────────────

export type SearchSort = 'relevance' | 'recent'

export interface SearchResult {
  id: string // 11-character YouTube video id
  title: string
  channel: string
  duration: number // seconds, 0 when unknown (e.g. live)
}

export interface SearchResponse {
  results: SearchResult[]
  playlist?: string // title, when the query was a playlist link
}

export interface Health {
  ok: true
  ytdlp: string | null // yt-dlp version, null when it is not installed
}

/** Error body for every non-2xx /api response. */
export interface ApiError {
  error: 'ytdlp-missing' | 'bad-request' | 'not-found' | 'failed'
}
