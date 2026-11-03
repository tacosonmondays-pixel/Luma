// Backup and sync with Supabase, for members. Library metadata, playlists, pins and the profile go up (debounced)
// and come down on sign-in, app start and when the app shows again. Last write wins, by each edit's time.
//
// Never song audio: a song synced from another device arrives without it ("not downloaded", `Track.missing`)
// until it is downloaded again. Profile media (avatar, banner, backdrop and their stills) does sync, through the
// public `media` bucket under `<uid>/profile/`, and lands in the local blobs so the app keeps working offline.
//
// What this device last agreed with the server is kept per user in localStorage (`luma-sync:<uid>`):
//   tracks, playlists  id → { h: hash of the synced fields (null = deleted), at: edit time (ms), dirty }
//   profile            the same for the profile's synced fields
//   media              slot → the uploaded version and its paths
//   cursor             the server's `synced_at` of the last rows pulled
//   playsFrom, playsSent  plays at or after these go to the activity feed (only while sharing)

import { deleteBlob, getBlob, putBlob } from './blobs.ts'
import { isMember, profileFromRow, refreshRow, useAccount } from './account.ts'
import {
  addSyncedTracks,
  deletePlaylist,
  deleteTrack,
  PROFILE_SLOTS,
  putSyncedPlaylist,
  replaceProfile,
  updateTrack,
  useLibrary,
  type ProfileSlot,
} from './library.ts'
import { loadPlays, usePlayLog } from './plays.ts'
import { computeStats, earnedTiers } from './stats.ts'
import { BUCKET, mediaUrl, supabase } from './supabase.ts'
import type { MediaKind, PinnedSong, Playlist, Profile, ProfileRow, Tier, Track } from '../types.ts'

// ── State ────────────────────────────────────────────────────────────────

interface Known {
  h: string | null // null: deleted
  at: number
  dirty: boolean
}

interface Uploaded {
  v: number
  path: string
  still: string | null
}

export interface SyncState {
  tracks: Record<string, Known>
  playlists: Record<string, Known>
  profile?: Known
  media: Partial<Record<ProfileSlot, Uploaded>>
  cursor: { tracks?: string; playlists?: string }
  playsFrom?: number
  playsSent?: number
}

const key = (uid: string) => `luma-sync:${uid}`
const empty = (): SyncState => ({ tracks: {}, playlists: {}, media: {}, cursor: {} })

export function loadState(uid: string): SyncState {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(key(uid)) ?? '{}') }
  } catch {
    return empty()
  }
}

function saveState(uid: string, state: SyncState): void {
  try {
    localStorage.setItem(key(uid), JSON.stringify(state))
  } catch {}
}

/** A short hash (cyrb53) of the synced fields, so the state stays small with thousands of songs. */
export function hash(value: unknown): string {
  const s = JSON.stringify(value)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const trackFields = (t: Track) => [t.title, t.artist, Math.round(t.duration || 0), t.source, t.addedAt]
const playlistFields = (p: Omit<Playlist, 'cover'>) => [p.name, p.trackIds, p.createdAt]
const profileFields = (p: Profile) => [
  p.name, p.bio ?? null, p.colors ?? null, p.autoColors ?? null, p.frame ?? null, p.effect ?? null, p.nameStyle ?? null,
  p.pinnedSongs ?? [], p.pinnedPlaylists ?? [], p.avatarCrop ?? null, p.bannerCrop ?? null, p.backdropCrop ?? null,
  ...PROFILE_SLOTS.flatMap((s) => [p[s] ?? null, p[s] ? (p[`${s}Kind`] ?? 'image') : null]),
]

/** Nothing set yet: a fresh device. Its profile must not overwrite the one on the server. */
const isBlank = (p: Profile) => hash(profileFields(p)) === hash(profileFields({ name: '' }))

/** Mark what changed here since the last sync, at `now`. */
export function stamp(state: SyncState, lib: { tracks: Record<string, Track>; playlists: Playlist[]; profile: Profile }, now: number): void {
  const mark = (known: Record<string, Known>, id: string, h: string | null) => {
    const k = known[id]
    if (k ? k.h === h : h === null) return
    known[id] = { h, at: now, dirty: true }
  }
  for (const t of Object.values(lib.tracks)) mark(state.tracks, t.id, hash(trackFields(t)))
  for (const id of Object.keys(state.tracks)) if (!lib.tracks[id]) mark(state.tracks, id, null)
  const ids = new Set(lib.playlists.map((p) => p.id))
  for (const p of lib.playlists) mark(state.playlists, p.id, hash(playlistFields(p)))
  for (const id of Object.keys(state.playlists)) if (!ids.has(id)) mark(state.playlists, id, null)
  const h = hash(profileFields(lib.profile))
  if (!state.profile) state.profile = { h, at: isBlank(lib.profile) ? 0 : now, dirty: !isBlank(lib.profile) }
  else if (state.profile.h !== h) state.profile = { h, at: now, dirty: true }
}

const isBlankRow = (r: ProfileRow) =>
  !r.name && !r.bio && !r.colors && !r.frame && !r.effect && !r.name_style && !r.pinned_songs.length && !r.pinned_playlists.length &&
  PROFILE_SLOTS.every((s) => r[`${s}_version`] == null)

/** Remote wins when it is newer, or ties with a local edit. */
const remoteWins = (k: Known | undefined, remoteAt: number) => !k || remoteAt > k.at || (remoteAt === k.at && k.dirty)

// ── Rows ─────────────────────────────────────────────────────────────────

interface TrackRow {
  id: string
  title: string
  artist: string
  duration: number
  source: Track['source']
  added_at: string
  deleted: boolean
  updated_at: string
  synced_at: string
}

interface PlaylistRow {
  id: string
  name: string
  track_ids: string[]
  created_at: string
  deleted: boolean
  updated_at: string
  synced_at: string
}

const iso = (ms: number) => new Date(ms).toISOString()

const trackOf = (r: TrackRow): Track => ({
  id: r.id, title: r.title, artist: r.artist, duration: Math.round(r.duration), source: r.source, addedAt: Date.parse(r.added_at),
})
const playlistOf = (r: PlaylistRow): Omit<Playlist, 'cover'> => ({
  id: r.id, name: r.name, trackIds: r.track_ids, createdAt: Date.parse(r.created_at),
})

// ── One sync ─────────────────────────────────────────────────────────────

let applying = false // the library changes made by a pull don't schedule a push

/** Pull, apply what's newer, then push what's newer here. Members only; quietly gives up offline. */
export async function syncNow(): Promise<void> {
  const account = useAccount.getState()
  const uid = account.user?.id
  if (!uid || !isMember(account)) return
  const sb = await supabase()
  const state = loadState(uid)
  stamp(state, useLibrary.getState(), Date.now())

  // Library: pull pages since the cursor (a minute back, for writes that committed late), apply, push.
  for (const table of ['tracks', 'playlists'] as const) {
    const since = state.cursor[table]
    let from = 0
    for (;;) {
      let q = sb.from(`library_${table}`).select('*').eq('user_id', uid).order('synced_at').range(from, from + 999)
      if (since) q = q.gt('synced_at', iso(Date.parse(since) - 60_000))
      const { data, error } = await q
      if (error) throw error
      const rows = (data ?? []) as (TrackRow | PlaylistRow)[]
      applying = true
      try {
        if (table === 'tracks') await applyTracks(state, rows as TrackRow[])
        else await applyPlaylists(state, rows as PlaylistRow[])
      } finally {
        applying = false
      }
      for (const r of rows) if (!state.cursor[table] || r.synced_at > state.cursor[table]!) state.cursor[table] = r.synced_at
      saveState(uid, state)
      if (rows.length < 1000) break
      from += 1000
    }
  }
  await pushLibrary(uid, state)

  // Profile: the row comes from the account (refreshed on start); apply it if newer, else push ours.
  // A row nobody has pushed to yet (just made by redeem_invite) never replaces a profile made on this device.
  const row = account.row!
  if (!isBlankRow(row) && Date.parse(row.updated_at) > (state.profile?.at ?? 0)) {
    await applyProfile(state, row)
    saveState(uid, state)
  } else if (state.profile?.dirty) {
    await pushProfile(uid, state, row)
  }
  await pushPlays(uid, state, row)
  saveState(uid, state)
}

async function applyTracks(state: SyncState, rows: TrackRow[]): Promise<void> {
  const added: Track[] = []
  for (const r of rows) {
    const at = Date.parse(r.updated_at)
    if (!remoteWins(state.tracks[r.id], at)) continue
    const local = useLibrary.getState().tracks[r.id]
    if (r.deleted) {
      if (local) await deleteTrack(r.id)
      state.tracks[r.id] = { h: null, at, dirty: false }
      continue
    }
    const track = trackOf(r)
    if (local) updateTrack(r.id, { title: track.title, artist: track.artist, duration: local.duration || track.duration, addedAt: track.addedAt })
    else added.push(track)
    state.tracks[r.id] = { h: hash(trackFields({ ...track, duration: local?.duration || track.duration })), at, dirty: false }
  }
  addSyncedTracks(added)
}

async function applyPlaylists(state: SyncState, rows: PlaylistRow[]): Promise<void> {
  for (const r of rows) {
    const at = Date.parse(r.updated_at)
    if (!remoteWins(state.playlists[r.id], at)) continue
    if (r.deleted) {
      if (useLibrary.getState().playlists.some((p) => p.id === r.id)) await deletePlaylist(r.id)
      state.playlists[r.id] = { h: null, at, dirty: false }
    } else {
      putSyncedPlaylist(playlistOf(r))
      state.playlists[r.id] = { h: hash(playlistFields(playlistOf(r))), at, dirty: false }
    }
  }
}

async function pushLibrary(uid: string, state: SyncState): Promise<void> {
  const sb = await supabase()
  const { tracks, playlists } = useLibrary.getState()
  const dirtyTracks = Object.entries(state.tracks).filter(([, k]) => k.dirty)
  for (let i = 0; i < dirtyTracks.length; i += 500) {
    const batch = dirtyTracks.slice(i, i + 500)
    const rows = batch.map(([id, k]) => {
      const t = tracks[id]
      return t && k.h !== null
        ? { user_id: uid, id, title: t.title, artist: t.artist, duration: Math.round(t.duration || 0), source: t.source, added_at: iso(t.addedAt), deleted: false, updated_at: iso(k.at) }
        : { user_id: uid, id, deleted: true, updated_at: iso(k.at) }
    })
    const { error } = await sb.from('library_tracks').upsert(rows, { onConflict: 'user_id,id' })
    if (error) throw error
    for (const [id, k] of batch) if (state.tracks[id] === k) k.dirty = false
    saveState(uid, state)
  }
  const dirtyLists = Object.entries(state.playlists).filter(([, k]) => k.dirty)
  if (dirtyLists.length) {
    const rows = dirtyLists.map(([id, k]) => {
      const p = playlists.find((x) => x.id === id)
      return p && k.h !== null
        ? { user_id: uid, id, name: p.name, track_ids: p.trackIds, created_at: iso(p.createdAt), deleted: false, updated_at: iso(k.at) }
        : { user_id: uid, id, deleted: true, updated_at: iso(k.at) }
    })
    const { error } = await sb.from('library_playlists').upsert(rows, { onConflict: 'user_id,id' })
    if (error) throw error
    for (const [, k] of dirtyLists) k.dirty = false
  }
}

// ── Profile ──────────────────────────────────────────────────────────────

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/apng': 'apng',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
}

const KIND_KEY = { avatar: 'avatarKind', banner: 'bannerKind', backdrop: 'backdropKind' } as const

async function fetchBlob(path: string): Promise<Blob> {
  const response = await fetch(mediaUrl(path))
  if (!response.ok) throw new Error(`media ${response.status}`)
  return response.blob()
}

/** The server's profile replaces ours: media first (into the blobs), then the record. */
async function applyProfile(state: SyncState, row: ProfileRow): Promise<void> {
  const current = useLibrary.getState().profile
  const next: Profile = { ...current, ...profileFromRow(row) }
  const removed: ProfileSlot[] = []
  for (const slot of PROFILE_SLOTS) {
    const v = row[`${slot}_version`]
    const path = row[`${slot}_path`]
    const still = row[`${slot}_still_path`]
    if (v == null || !path) {
      next[slot] = undefined
      next[KIND_KEY[slot]] = undefined
      if (current[slot] !== undefined) removed.push(slot)
      delete state.media[slot]
      continue
    }
    if (current[slot] !== v) {
      const [blob, stillBlob] = await Promise.all([fetchBlob(path), still ? fetchBlob(still) : undefined])
      await putBlob(slot, blob)
      if (stillBlob) await putBlob(`${slot}-still`, stillBlob)
      else await deleteBlob(`${slot}-still`)
    }
    next[slot] = v
    next[KIND_KEY[slot]] = (row[`${slot}_kind`] ?? 'image') === 'image' ? undefined : (row[`${slot}_kind`] as MediaKind)
    state.media[slot] = { v, path, still }
  }
  applying = true
  try {
    replaceProfile(next)
  } finally {
    applying = false
  }
  await Promise.all(removed.flatMap((slot) => [deleteBlob(slot), deleteBlob(`${slot}-still`)]))
  state.profile = { h: hash(profileFields(next)), at: Date.parse(row.updated_at), dirty: false }
}

async function pushProfile(uid: string, state: SyncState, row: ProfileRow): Promise<void> {
  const sb = await supabase()
  const { profile, tracks } = useLibrary.getState()
  const known = state.profile!
  const media: Partial<Record<ProfileSlot, Uploaded | null>> = {}
  const stale: string[] = []
  for (const slot of PROFILE_SLOTS) {
    const v = profile[slot]
    const had = state.media[slot]
    if (had?.v === v) continue
    if (had) stale.push(had.path, ...(had.still ? [had.still] : []))
    if (v === undefined) {
      media[slot] = null
      continue
    }
    const blob = await getBlob(slot)
    if (!blob) continue
    const kind = profile[KIND_KEY[slot]] ?? 'image'
    const stillBlob = kind === 'image' ? undefined : await getBlob(`${slot}-still`)
    const path = `${uid}/profile/${slot}-${v}.${EXT[blob.type] ?? 'jpg'}`
    const up = await sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg', cacheControl: '31536000' })
    if (up.error) throw up.error
    let still: string | null = null
    if (stillBlob) {
      still = `${uid}/profile/${slot}-${v}-still.${EXT[stillBlob.type] ?? 'jpg'}`
      const s = await sb.storage.from(BUCKET).upload(still, stillBlob, { upsert: true, contentType: stillBlob.type || 'image/jpeg', cacheControl: '31536000' })
      if (s.error) throw s.error
    }
    media[slot] = { v, path, still }
  }

  const pinned: PinnedSong[] = (profile.pinnedSongs ?? [])
    .map((id) => tracks[id])
    .filter((t) => !!t)
    .map((t) => ({ id: t.id, title: t.title, artist: t.artist, source: t.source }))
  const patch: Record<string, unknown> = {
    name: profile.name,
    bio: profile.bio ?? null,
    colors: profile.colors ?? null,
    auto_colors: profile.autoColors ?? null,
    frame: profile.frame ?? null,
    effect: profile.effect ?? null,
    name_style: profile.nameStyle ?? null,
    pinned_songs: pinned,
    pinned_playlists: profile.pinnedPlaylists ?? [],
    badges: badgesFor(row),
    crops: Object.fromEntries(PROFILE_SLOTS.flatMap((s) => (profile[`${s}Crop`] ? [[s, profile[`${s}Crop`]]] : []))),
    updated_at: iso(known.at),
  }
  for (const slot of PROFILE_SLOTS) {
    const m = media[slot]
    if (m === undefined) continue
    patch[`${slot}_path`] = m?.path ?? null
    patch[`${slot}_still_path`] = m?.still ?? null
    patch[`${slot}_kind`] = m ? (profile[KIND_KEY[slot]] ?? 'image') : null
    patch[`${slot}_version`] = m?.v ?? null
  }
  const { data, error } = await sb.from('profiles').update(patch).eq('id', uid).select('*').maybeSingle()
  if (error) throw error
  for (const slot of PROFILE_SLOTS) {
    const m = media[slot]
    if (m === null) delete state.media[slot]
    else if (m) state.media[slot] = m
  }
  if (state.profile === known) known.dirty = false
  if (data) useAccount.setState({ row: data as ProfileRow })
  if (stale.length) void sb.storage.from(BUCKET).remove(stale)
}

/** Earned badges: the best tier either side has seen, so two devices never fight over them. */
function badgesFor(row: ProfileRow): { id: string; tier: Tier }[] {
  const tiers: Record<string, Tier> = {}
  for (const b of row.badges ?? []) tiers[b.id] = b.tier
  const plays = usePlayLog.getState().plays
  if (plays) {
    const lib = useLibrary.getState()
    for (const [id, tier] of Object.entries(earnedTiers(computeStats(plays, lib)))) tiers[id] = Math.max(tiers[id] ?? 0, tier) as Tier
  }
  return Object.entries(tiers).map(([id, tier]) => ({ id, tier }))
}

// ── Activity ─────────────────────────────────────────────────────────────

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const LOOKBACK = 60 * 60_000 // a play's listened time grows for a while after it is first logged

/** Plays since sharing turned on go to the feed. Nothing leaves the device while sharing is off. */
async function pushPlays(uid: string, state: SyncState, row: ProfileRow): Promise<void> {
  if (!row.share_activity) {
    delete state.playsFrom
    delete state.playsSent
    return
  }
  state.playsFrom ??= Date.now()
  await loadPlays()
  const from = Math.max(state.playsFrom, (state.playsSent ?? 0) - LOOKBACK)
  const { tracks } = useLibrary.getState()
  const plays = (usePlayLog.getState().plays ?? []).filter((p) => p[1] >= from && tracks[p[0]]).slice(-500)
  if (!plays.length) return
  const rows = plays.map(([id, at, ms]) => {
    const t = tracks[id]
    return {
      user_id: uid, track_id: id, youtube_id: t.source === 'youtube' && YOUTUBE_ID.test(id) ? id : null,
      title: t.title.slice(0, 300), artist: t.artist.slice(0, 300), played_at: iso(at), listened_ms: ms,
    }
  })
  const sb = await supabase()
  const { error } = await sb.from('plays').upsert(rows, { onConflict: 'user_id,track_id,played_at' })
  if (error) throw error
  state.playsSent = Math.max(...plays.map((p) => p[1]))
}

// ── When to sync ─────────────────────────────────────────────────────────

let running: Promise<void> | undefined
let again = false

/** Run a sync now, or right after the one in progress. Never rejects. */
export function requestSync(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    do {
      again = false
      await syncNow().catch(() => {})
    } while (again)
  })().finally(() => (running = undefined))
  return running
}

let timer: ReturnType<typeof setTimeout> | undefined
function soon(ms: number) {
  clearTimeout(timer)
  timer = setTimeout(() => void requestSync(), ms)
}

let wired = false

/** Follow the account and the library: sync on sign-in, start, return to the app, and after edits. */
export function startSync(): void {
  if (wired) return
  wired = true
  let last: string | undefined
  useAccount.subscribe((a) => {
    const id = isMember(a) ? a.user!.id : undefined
    if (id && id !== last) void requestSync()
    last = id
  })
  useLibrary.subscribe((lib, prev) => {
    if (applying || !isMember()) return
    if (lib.tracks !== prev.tracks || lib.playlists !== prev.playlists || lib.profile !== prev.profile) soon(2000)
  })
  usePlayLog.subscribe((log, prev) => {
    if (log.plays !== prev.plays && useAccount.getState().row?.share_activity) soon(30_000)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isMember()) void refreshRow().then(() => requestSync())
  })
}
