// Search YouTube from the browser with the YouTube Data API v3 and the owner's API key (phone mode, no helper).

import { create } from 'zustand'
import type { SearchResponse, SearchResult, SearchSort } from '../types.ts'

const API = 'https://www.googleapis.com/youtube/v3/'
const KEY = 'luma-youtube-key'
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']
const ORDER: Record<SearchSort, string> = { relevance: 'relevance', recent: 'date', popular: 'viewCount' }
const PLAYLIST_LIMIT = 200

// ── Key ──────────────────────────────────────────────────────────────────

function readKey(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

/** The API key, kept on this device. */
export const useYouTubeKey = create<string>()(readKey)

export function setYouTubeKey(key: string): void {
  useYouTubeKey.setState(key, true)
  try {
    localStorage.setItem(KEY, key.trim())
  } catch {}
}

// ── Requests ─────────────────────────────────────────────────────────────

/** `key`: missing, invalid or not allowed here. `quota`: the daily limit is used up. */
export class YouTubeError extends Error {
  code: 'key' | 'quota' | 'not-found' | 'offline' | 'failed'
  constructor(code: YouTubeError['code']) {
    super(code)
    this.code = code
  }
}

const QUOTA = /quotaExceeded|dailyLimitExceeded|rateLimitExceeded|RATE_LIMIT_EXCEEDED/
const BAD_KEY = /keyInvalid|keyExpired|API_KEY|forbidden|accessNotConfigured|SERVICE_DISABLED|ipRefererBlocked/

interface GoogleError {
  error?: { errors?: { reason?: string }[]; details?: { reason?: string }[]; status?: string }
}

async function get<T>(method: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const key = useYouTubeKey.getState().trim()
  if (!key) throw new YouTubeError('key')
  let r: Response
  try {
    r = await fetch(`${API}${method}?${new URLSearchParams({ ...params, key })}`, { signal })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new YouTubeError('offline')
  }
  if (r.ok) return r.json()
  const body = (await r.json().catch(() => null)) as GoogleError | null
  const reasons = [...(body?.error?.errors ?? []), ...(body?.error?.details ?? [])].map((e) => e.reason).join(' ')
  if (QUOTA.test(reasons)) throw new YouTubeError('quota')
  if (r.status === 403 || BAD_KEY.test(reasons)) throw new YouTubeError('key')
  throw new YouTubeError(r.status === 404 ? 'not-found' : 'failed')
}

// ── Search ───────────────────────────────────────────────────────────────

interface Snippet {
  title?: string
  channelTitle?: string
}
interface Video {
  id: string
  snippet?: Snippet
  contentDetails?: { duration?: string }
}

/** ISO 8601 ("PT1H2M3S", "P1DT2H") → seconds. */
export function parseDuration(iso: string | undefined): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso ?? '')
  if (!m) return 0
  const [, d = 0, h = 0, min = 0, s = 0] = m
  return Math.round(Number(d) * 86400 + Number(h) * 3600 + Number(min) * 60 + Number(s))
}

/** search.list titles are HTML-escaped ("Rock &amp; Roll"). */
export function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] !== '#') return named[e.toLowerCase()] ?? all
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : all
  })
}

/** videos.list for up to 50 ids at a time, in the given order. Private and deleted videos drop out. */
async function videos(ids: string[], part: string, signal?: AbortSignal): Promise<Map<string, Video>> {
  const found = new Map<string, Video>()
  for (let i = 0; i < ids.length; i += 50) {
    const { items = [] } = await get<{ items?: Video[] }>('videos', { part, id: ids.slice(i, i + 50).join(','), maxResults: '50' }, signal)
    for (const v of items) found.set(v.id, v)
  }
  return found
}

const toResult = (v: Video, snippet = v.snippet): SearchResult => ({
  id: v.id,
  title: snippet?.title ?? '',
  channel: snippet?.channelTitle ?? '',
  duration: parseDuration(v.contentDetails?.duration),
})

async function videoResults(ids: string[], signal?: AbortSignal): Promise<SearchResult[]> {
  const found = await videos(ids, 'snippet,contentDetails', signal)
  return ids.flatMap((id) => (found.has(id) ? [toResult(found.get(id)!)] : []))
}

async function playlist(list: string, signal?: AbortSignal): Promise<SearchResponse> {
  const ids: string[] = []
  let pageToken = ''
  do {
    const page = await get<{ items?: { contentDetails?: { videoId?: string } }[]; nextPageToken?: string }>(
      'playlistItems',
      { part: 'contentDetails', playlistId: list, maxResults: '50', ...(pageToken && { pageToken }) },
      signal,
    )
    for (const item of page.items ?? []) {
      const id = item.contentDetails?.videoId
      if (id && VIDEO_ID.test(id) && !ids.includes(id)) ids.push(id)
    }
    pageToken = page.nextPageToken ?? ''
  } while (pageToken && ids.length < PLAYLIST_LIMIT)
  const [info, results] = await Promise.all([
    get<{ items?: { snippet?: { title?: string } }[] }>('playlists', { part: 'snippet', id: list }, signal),
    videoResults(ids.slice(0, PLAYLIST_LIMIT), signal),
  ])
  return { results, playlist: info.items?.[0]?.snippet?.title ?? '' }
}

/** A YouTube link → its video and playlist ids. Null for anything that isn't a YouTube link. */
export function parseLink(q: string): { video?: string; list?: string } | null {
  if (!/^https?:\/\//i.test(q)) return null
  const url = URL.parse(q)
  if (!url || !YOUTUBE_HOSTS.includes(url.hostname)) return null
  const list = url.searchParams.get('list') ?? undefined
  const [first = '', second = ''] = url.pathname.split('/').filter(Boolean)
  const candidate =
    url.hostname === 'youtu.be' ? first : ['shorts', 'live', 'embed', 'v'].includes(first) ? second : url.searchParams.get('v') ?? ''
  const video = VIDEO_ID.test(candidate) ? candidate : undefined
  return video || list ? { video, list } : {}
}

/** Same answers as the helper's /api/search. */
export async function search(q: string, sort: SearchSort, signal?: AbortSignal): Promise<SearchResponse> {
  const link = parseLink(q)
  if (link) {
    if (link.list) {
      try {
        return await playlist(link.list, signal)
      } catch (e) {
        // Mixes (list=RD…) aren't real playlists; fall back to the video in the link.
        if (!(e instanceof YouTubeError && e.code === 'not-found' && link.video)) throw e
      }
    }
    return { results: link.video ? await videoResults([link.video], signal) : [] }
  }

  const { items = [] } = await get<{ items?: { id?: { videoId?: string }; snippet?: Snippet }[] }>(
    'search',
    { part: 'snippet', type: 'video', maxResults: '30', order: ORDER[sort], q },
    signal,
  )
  const hits = items.filter((i) => i.id?.videoId && VIDEO_ID.test(i.id.videoId))
  const details = await videos(hits.map((i) => i.id!.videoId!), 'contentDetails', signal)
  return {
    results: hits.map((i) => {
      const id = i.id!.videoId!
      const s = i.snippet
      return toResult(details.get(id) ?? { id }, { title: decodeEntities(s?.title ?? ''), channelTitle: decodeEntities(s?.channelTitle ?? '') })
    }),
  }
}

/** Thumbnails straight from YouTube, best first: 320×180 for lists and dense grids, else the largest. */
export function thumbnails(id: string, small: boolean): string[] {
  return (small ? ['mqdefault'] : ['maxresdefault', 'hqdefault']).map((size) => `https://i.ytimg.com/vi/${id}/${size}.jpg`)
}
