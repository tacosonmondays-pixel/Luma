// What Home's shelves hold, worked out from the play log, the playlists that were played and the library. Pure.

import { artistKey } from './stats.ts'
import type { Play, Playlist, SearchResult, Track } from '../types.ts'
import type { Queue } from './queue.ts'
import type { PlaylistPlay } from './home.ts'

export type Item = { kind: 'song'; id: string } | { kind: 'playlist'; id: string }

const DAY = 86_400_000
const playable = (t: Track | undefined): t is Track => !!t && !t.missing
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/** The playlist a queue was started from: its songs, all of them or the downloaded ones, in its order. */
export function playlistOf(ids: readonly string[], playlists: Playlist[], tracks: Record<string, Track>): Playlist | undefined {
  if (!ids.length) return
  return playlists.find((p) => same(ids, p.trackIds) || same(ids, p.trackIds.filter((id) => playable(tracks[id]))))
}

/** Plays per song since `since` (downloaded songs only), most first, then most recent. */
function topSongs(plays: Play[], tracks: Record<string, Track>, since: number, until = Infinity): string[] {
  const counts = new Map<string, { n: number; last: number }>()
  for (const [id, at] of plays) {
    if (at < since || at > until || !playable(tracks[id])) continue
    const c = counts.get(id) ?? { n: 0, last: 0 }
    counts.set(id, { n: c.n + 1, last: Math.max(c.last, at) })
  }
  return [...counts].sort(([, a], [, b]) => b.n - a.n || b.last - a.last).map(([id]) => id)
}

// ── Continue ─────────────────────────────────────────────────────────────

/** The last thing played: the current queue's playlist or song, else the last song in the log. */
export function continueItem(queue: Queue, playlists: Playlist[], tracks: Record<string, Track>, plays: Play[]): Item | undefined {
  const current = queue.ids[queue.index]
  if (current !== undefined && playable(tracks[current])) {
    const playlist = playlistOf(queue.original ?? queue.ids, playlists, tracks)
    return playlist ? { kind: 'playlist', id: playlist.id } : { kind: 'song', id: current }
  }
  for (let i = plays.length - 1; i >= 0; i--) if (playable(tracks[plays[i][0]])) return { kind: 'song', id: plays[i][0] }
}

// ── Quick Picks ──────────────────────────────────────────────────────────

/** Up to 8 of the playlists and songs played most in the last 90 days, playlists and songs taking turns. An even
 * number, so the grid has no gap; empty when fewer than 2. */
export function quickPicks(
  plays: Play[],
  played: PlaylistPlay[],
  tracks: Record<string, Track>,
  playlists: Playlist[],
  now: number,
): Item[] {
  const since = now - 90 * DAY
  const counts = new Map<string, { n: number; last: number }>()
  for (const { id, at } of played) {
    if (at < since || !playlists.some((p) => p.id === id && p.trackIds.length)) continue
    const c = counts.get(id) ?? { n: 0, last: 0 }
    counts.set(id, { n: c.n + 1, last: Math.max(c.last, at) })
  }
  const lists: Item[] = [...counts]
    .sort(([, a], [, b]) => b.n - a.n || b.last - a.last)
    .slice(0, 4)
    .map(([id]) => ({ kind: 'playlist', id }))
  const songs: Item[] = topSongs(plays, tracks, since, now).map((id) => ({ kind: 'song', id }))
  const picks: Item[] = []
  for (let i = 0; picks.length < 8 && (i < lists.length || i < songs.length); i++) {
    if (lists[i]) picks.push(lists[i])
    if (songs[i] && picks.length < 8) picks.push(songs[i])
  }
  // Songs fill in when there are fewer than 4 playlists.
  for (const s of songs) if (picks.length < 8 && !picks.includes(s)) picks.push(s)
  const even = picks.slice(0, picks.length - (picks.length % 2))
  return even.length >= 2 ? even : []
}

// ── Jump Back In ─────────────────────────────────────────────────────────

const CONTEXT = 12 * 3600_000 // a song played this long after its playlist started belongs to that listen

/** Up to 12 songs and playlists, most recently played first. A song played as part of a playlist counts for the
 * playlist. `skip` (the Continue item) is left out. */
export function jumpBackIn(
  plays: Play[],
  played: PlaylistPlay[],
  tracks: Record<string, Track>,
  playlists: Playlist[],
  skip?: Item,
): Item[] {
  const last = new Map<string, number>()
  const bump = (key: string, at: number) => last.set(key, Math.max(last.get(key) ?? 0, at))
  const starts = [...played].sort((a, b) => a.at - b.at)
  const byId = new Map(playlists.map((p) => [p.id, p]))
  for (const s of starts) if (byId.has(s.id)) bump(`playlist:${s.id}`, s.at)
  let k = -1 // the latest start at or before the play
  for (const [id, at] of [...plays].sort((a, b) => a[1] - b[1])) {
    if (!playable(tracks[id])) continue
    while (k + 1 < starts.length && starts[k + 1].at <= at) k++
    const start = starts[k]
    const playlist = start && at - start.at < CONTEXT ? byId.get(start.id) : undefined
    if (playlist?.trackIds.includes(id)) bump(`playlist:${playlist.id}`, at)
    else bump(`song:${id}`, at)
  }
  const skipKey = skip && `${skip.kind}:${skip.id}`
  return [...last]
    .filter(([key]) => key !== skipKey)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12)
    .map(([key]) => {
      const i = key.indexOf(':')
      return { kind: key.slice(0, i), id: key.slice(i + 1) } as Item
    })
}

// ── Artists ──────────────────────────────────────────────────────────────

/** The main artist as written ("Daft Punk, Pharrell" → "Daft Punk"), cut where `artistKey` cuts. */
export function mainArtist(artist: string): string {
  const a = artist.toLowerCase()
  const cut = [',', '&', ' feat.', ' ft.'].map((s) => a.indexOf(s)).filter((i) => i >= 0)
  return (cut.length ? artist.slice(0, Math.min(...cut)) : artist).trim()
}

/** The artists played most in the last 90 days, as written on their most recently played song. */
export function topArtists(plays: Play[], tracks: Record<string, Track>, now: number, n = 3): string[] {
  const since = now - 90 * DAY
  const counts = new Map<string, { n: number; last: number; name: string }>()
  for (const [id, at] of plays) {
    const track = tracks[id]
    if (at < since || at > now || !track) continue
    const key = artistKey(track.artist)
    if (!key || key === 'unknown artist') continue
    const c = counts.get(key) ?? { n: 0, last: 0, name: '' }
    counts.set(key, { n: c.n + 1, last: Math.max(c.last, at), name: at >= c.last ? mainArtist(track.artist) : c.name })
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || b.last - a.last)
    .slice(0, n)
    .map((c) => c.name)
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** Results that are by the artist (their name in the channel or title), up to `per` each, artists taking turns. */
export function byArtists(lists: SearchResult[][], artists: string[], per = 6, max = 15): SearchResult[] {
  const picked = lists.map((list, i) => {
    const name = norm(artists[i] ?? '')
    return name ? list.filter((r) => norm(r.channel).includes(name) || norm(r.title).includes(name)).slice(0, per) : []
  })
  const out: SearchResult[] = []
  for (let i = 0; i < per; i++)
    for (const list of picked) if (list[i] && !out.some((r) => r.id === list[i].id) && out.length < max) out.push(list[i])
  return out
}

// ── Mix ──────────────────────────────────────────────────────────────────

/** The YouTube song to start a mix from: the top On Repeat song from YouTube, else the YouTube song played most
 * in the last 30 days (twice or more). */
export function mixSeed(repeat: string[], plays: Play[], tracks: Record<string, Track>, now: number): string | undefined {
  const fromYouTube = (id: string) => tracks[id]?.source === 'youtube'
  const top = repeat.find(fromYouTube)
  if (top) return top
  const counts = new Map<string, number>()
  for (const [id, at] of plays) if (at >= now - 30 * DAY && at <= now && fromYouTube(id)) counts.set(id, (counts.get(id) ?? 0) + 1)
  return topSongs(plays, tracks, now - 30 * DAY, now).find((id) => fromYouTube(id) && (counts.get(id) ?? 0) >= 2)
}

// ── Library shelves ──────────────────────────────────────────────────────

/** The newest downloaded songs. */
export function recentlySaved(order: string[], tracks: Record<string, Track>, n = 12): string[] {
  const out: string[] = []
  for (const id of order) {
    if (playable(tracks[id])) out.push(id)
    if (out.length >= n) break
  }
  return out
}
