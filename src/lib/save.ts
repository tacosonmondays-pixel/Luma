// Save to Luma: a YouTube video or playlist link (from /save?u=, the extension, the iOS app's luma://save, or
// Connect YouTube) becomes songs in the library. With the helper they download straight away; otherwise they are
// saved (`Track.missing`) and download later with whichever downloader there is. A playlist becomes a Luma
// playlist linked to the YouTube one (`Playlist.youtubeId`), which Refresh from YouTube tops up.

import { googleEnabled, ensureToken, useGoogle, validToken } from './google.ts'
import * as helper from './helper.ts'
import { addSyncedTracks, addToPlaylist, createPlaylist, useLibrary } from './library.ts'
import { downloadMissing, mode, playlistUrl, watchUrl } from './source.ts'
import { cleanTitle } from './titles.ts'
import * as youtube from './youtube.ts'
import type { Playlist, SearchResponse, SearchResult, Track } from '../types.ts'

/** What a link saves: one video, or one playlist. */
export type Target = { video: string; list?: undefined } | { list: string; video?: undefined }

/**
 * A YouTube link → what to save, or null. A watch link saves its video even when it also names the playlist it
 * was opened from (the extension's button sits on that video); a playlist link (or a list with no video) saves
 * the playlist. Mixes (list=RD…) are endless and generated per viewer, so only their video is saved.
 */
export function targetOf(url: string): Target | null {
  const link = youtube.parseLink(url.trim())
  if (!link) return null
  const path = new URL(url.trim()).pathname
  const list = link.list && !link.list.startsWith('RD') ? link.list : undefined
  if (list && (path === '/playlist' || !link.video)) return { list }
  if (link.video) return { video: link.video }
  return null
}

/**
 * The `u` of a /save query. Tolerates a link that wasn't encoded (`?u=https://…/watch?v=x&list=y`): everything
 * that starts with http after `u=` is the link.
 */
export function saveParam(search: string): string | null {
  const raw = /[?&]u=(.*)$/s.exec(search)?.[1]
  if (raw && /^https?:\/\//i.test(raw)) return targetOf(raw) ? raw : null // not encoded: the rest is the link
  const u = new URLSearchParams(search).get('u')
  return u && targetOf(u) ? u : null
}

export const urlOf = (t: Target): string => (t.list !== undefined ? playlistUrl(t.list) : watchUrl(t.video))

/** Songs saved from listing results, newest first in the listing's order, cleaned like downloads are. */
export function savedTracks(results: SearchResult[], now = Date.now()): Track[] {
  return results.map((r, i) => {
    const { title, artist } = cleanTitle(r.title, r.channel)
    return { id: r.id, title, artist, duration: r.duration, source: 'youtube', addedAt: now - i }
  })
}

/** The ids a refresh adds to a playlist: in the listing, not yet in it. Nothing is ever removed. */
export function newIds(playlist: Pick<Playlist, 'trackIds'>, results: SearchResult[]): string[] {
  const have = new Set(playlist.trackIds)
  return [...new Set(results.map((r) => r.id))].filter((id) => !have.has(id))
}

/**
 * The songs behind a link. The owner's sign-in reads anything they can see (private playlists, Liked videos);
 * else the helper's yt-dlp; else the YouTube Data API key.
 */
async function listing(t: Target, token: string | null): Promise<SearchResponse> {
  if (token) {
    try {
      return await youtube.lookup(t, undefined, token)
    } catch (e) {
      if (!(e instanceof youtube.YouTubeError && e.code === 'auth')) throw e
      useGoogle.setState({ token: null, expires: 0 }) // expired early: try the other ways
    }
  }
  if ((await mode()) === 'helper') return helper.search(urlOf(t), 'relevance')
  return youtube.lookup(t)
}

/** The sign-in token; when it ran out and the owner connected YouTube before, a new one is asked for (from a tap:
 *  Google's popup needs it). */
function tokenFor(ask: boolean): Promise<string | null> {
  const valid = validToken()
  if (valid || !ask || !googleEnabled() || !useGoogle.getState().connected) return Promise.resolve(valid)
  return ensureToken().catch(() => null)
}

export interface Saved {
  playlistId?: string
  ids: string[]
}

/**
 * Save a link's songs to the library. A playlist creates (or tops up) the Luma playlist linked to it; `name`
 * stands in when YouTube gives no title (Liked videos). With the helper, the new songs download right away.
 * Rejects when the songs can't be listed (offline, no key, private), so the caller can show why.
 */
export async function saveLink(url: string, name?: string): Promise<Saved> {
  const t = targetOf(url)
  if (!t) throw new youtube.YouTubeError('not-found')
  return saveTarget(t, name)
}

/** saveLink for a parsed target. `ask`: called from a tap, so it may sign in again (Connect YouTube's Import). */
export async function saveTarget(t: Target, name?: string, ask = false): Promise<Saved> {
  const token = await tokenFor(ask)
  const response = await listing(t, token)
  const results = t.video ? response.results.filter((r) => r.id === t.video).slice(0, 1) : response.results
  if (t.video && !results.length) throw new youtube.YouTubeError('not-found')
  addSyncedTracks(savedTracks(results))
  const ids = results.map((r) => r.id)

  let playlistId: string | undefined
  if (t.list) {
    const linked = linkedTo(t.list)
    if (linked) {
      addToPlaylist(linked.id, newIds(linked, results))
      playlistId = linked.id
    } else {
      playlistId = createPlaylist(ids, { name: response.playlist || name || 'YouTube Playlist', youtubeId: t.list })
    }
  }
  if ((await mode()) === 'helper') downloadMissing(ids)
  return { playlistId, ids }
}

/** The Luma playlist linked to a YouTube playlist. */
export const linkedTo = (list: string): Playlist | undefined => useLibrary.getState().playlists.find((p) => p.youtubeId === list)

/** Refresh from YouTube (from a tap): add the linked playlist's new songs as saved. Never deletes. Resolves to how
 *  many were added. */
export async function refreshPlaylist(playlistId: string): Promise<number> {
  const find = () => useLibrary.getState().playlists.find((p) => p.id === playlistId)
  const list = find()?.youtubeId
  if (!list) return 0
  const response = await listing({ list }, await tokenFor(true))
  const playlist = find()
  if (!playlist) return 0 // deleted meanwhile
  addSyncedTracks(savedTracks(response.results))
  const added = newIds(playlist, response.results)
  addToPlaylist(playlistId, added)
  return added.length
}
