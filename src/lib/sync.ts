// Backup and sync with Supabase, for members. Library metadata, playlists, pins and the profile go up (debounced)
// and come down on sign-in, app start and when the app shows again. Last write wins, by each edit's time.
//
// Never song audio: a song synced from another device arrives without it ("not downloaded", `Track.missing`)
// until it is downloaded again. Profile media (avatar, banner, backdrop and their stills) does sync, through the
// public `media` bucket under `<uid>/profile/`, and lands in the local blobs so the app keeps working offline.
//
// A device's library belongs to one account (localStorage `luma-sync-owner`): the first member to sync on it, or the
// one who chose Sync Library there. Another account signed in on the same device doesn't sync it, so a shared iPad
// never mixes two people's songs and profiles.
//
// Edits are stamped as they happen (offline and signed out too), and deletions only ever that way: a library that
// loads empty, or storage that was cleared, never deletes anything on the server.
//
// What this device last agreed with the server is kept per user in localStorage (`luma-sync:<uid>`):
//   tracks, playlists  id → { h: hash of the synced fields (null = deleted), at: edit time (ms), dirty }
//   profile            the same for the profile's synced fields
//   media              slot → the uploaded version and its paths
//   cursor             the server's `synced_at` of the last rows pulled
//   joined             when this device first finished syncing with the account. Until then, what the server already
//                      has wins over what this device had (an old device signing in never undoes newer edits).
//   playsFrom, playsSent  plays at or after these go to the activity feed (only while sharing)

import { create } from 'zustand'
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
import { extOf } from './media.ts'
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
  joined?: number
  playsFrom?: number
  playsSent?: number
}

type Lib = { tracks: Record<string, Track>; playlists: Playlist[]; profile: Profile }

const key = (uid: string) => `luma-sync:${uid}`
const empty = (): SyncState => ({ tracks: {}, playlists: {}, media: {}, cursor: {} })

export function loadState(uid: string): SyncState {
  try {
    const state: SyncState = { ...empty(), ...JSON.parse(localStorage.getItem(key(uid)) ?? '{}') }
    // Saved before `joined` existed: that device had synced.
    if (state.joined === undefined && (state.profile || state.cursor.tracks || state.cursor.playlists)) state.joined = 1
    return state
  } catch {
    return empty()
  }
}

function saveState(uid: string, state: SyncState): void {
  try {
    localStorage.setItem(key(uid), JSON.stringify(state))
  } catch {}
}

// One copy per account, shared by the edits stamped as they happen and a sync in progress (neither overwrites the
// other's). Another tab's changes to it show up as a `storage` event, which drops this copy.
let cache: { uid: string; state: SyncState } | undefined

function stateOf(uid: string): SyncState {
  if (cache?.uid !== uid) cache = { uid, state: loadState(uid) }
  return cache.state
}

// ── Which account this device's library belongs to ───────────────────────

const OWNER = 'luma-sync-owner'

function readOwner(): string | undefined {
  try {
    return localStorage.getItem(OWNER) ?? undefined
  } catch {
    return undefined
  }
}

/** The account this device's library syncs with; undefined until a member first syncs here. */
export const useSyncOwner = create<{ owner?: string }>(() => ({ owner: readOwner() }))

function setOwner(uid: string): void {
  try {
    localStorage.setItem(OWNER, uid)
  } catch {}
  useSyncOwner.setState({ owner: uid })
}

/** Sync Library: this device's library becomes the signed-in account's. It merges into the account on the next sync;
 * what the account already has (its profile too) wins over what this device had. The previous account keeps its
 * backup on the server but stops syncing here. */
export function linkDevice(): void {
  const uid = useAccount.getState().user?.id
  if (!uid) return
  const before = readOwner()
  try {
    if (before) localStorage.removeItem(key(before))
    localStorage.removeItem(key(uid))
  } catch {}
  cache = undefined
  setOwner(uid)
  void requestSync()
}

// ── Stamps ───────────────────────────────────────────────────────────────

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

function mark(known: Record<string, Known>, id: string, h: string | null, at: number): void {
  const k = known[id]
  if (k ? k.h === h : h === null) return
  known[id] = { h, at, dirty: true }
}

/** Mark one edit made here, at `now`: whatever changed between `prev` and `next`, deletions included. */
export function markEdit(state: SyncState, prev: Lib, next: Lib, now: number): void {
  if (next.tracks !== prev.tracks)
    for (const id of new Set([...Object.keys(prev.tracks), ...Object.keys(next.tracks)])) {
      const t = next.tracks[id]
      if (t !== prev.tracks[id]) mark(state.tracks, id, t ? hash(trackFields(t)) : null, now)
    }
  if (next.playlists !== prev.playlists) {
    const before = new Map(prev.playlists.map((p) => [p.id, p]))
    const after = new Map(next.playlists.map((p) => [p.id, p]))
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const p = after.get(id)
      if (p !== before.get(id)) mark(state.playlists, id, p ? hash(playlistFields(p)) : null, now)
    }
  }
  if (next.profile !== prev.profile && state.profile) {
    const h = hash(profileFields(next.profile))
    if (h !== state.profile.h) state.profile = { h, at: now, dirty: true }
  }
  // The profile shows its pinned songs by name: renaming one edits the profile too.
  const renamed = (id: string) => {
    const [a, b] = [prev.tracks[id], next.tracks[id]]
    return !!a && !!b && (a.title !== b.title || a.artist !== b.artist)
  }
  if (next.tracks !== prev.tracks && state.profile && (next.profile.pinnedSongs ?? []).some(renamed))
    state.profile = { ...state.profile, at: now, dirty: true }
}

/**
 * Before a sync: catch up with what this device has that wasn't stamped as an edit (say, a library from before this
 * account synced here). New and changed things are marked; before the first sync, new ones keep their own time
 * (added, created), so the server's newer edits of them win. Things missing here that were never deleted here are
 * not deleted: they're fetched again. A profile that went blank on its own takes the server's.
 */
export function stamp(state: SyncState, lib: Lib, now: number): void {
  const first = !state.joined
  const at = (since: number) => (first ? (Number.isFinite(since) ? since : 0) : now)
  for (const t of Object.values(lib.tracks)) {
    const h = hash(trackFields(t))
    if (state.tracks[t.id]?.h !== h) mark(state.tracks, t.id, h, state.tracks[t.id] ? now : at(t.addedAt))
  }
  const ids = new Set(lib.playlists.map((p) => p.id))
  for (const p of lib.playlists) {
    const h = hash(playlistFields(p))
    if (state.playlists[p.id]?.h !== h) mark(state.playlists, p.id, h, state.playlists[p.id] ? now : at(p.createdAt))
  }
  let lost = false
  for (const [id, k] of Object.entries(state.tracks))
    if (k.h !== null && !lib.tracks[id]) {
      delete state.tracks[id]
      lost = true
    }
  for (const [id, k] of Object.entries(state.playlists))
    if (k.h !== null && !ids.has(id)) {
      delete state.playlists[id]
      lost = true
    }
  if (lost) state.cursor = {}
  const h = hash(profileFields(lib.profile))
  if (!state.profile) state.profile = { h, at: 0, dirty: !isBlank(lib.profile) }
  else if (state.profile.h !== h) state.profile = isBlank(lib.profile) ? { h, at: 0, dirty: false } : { h, at: now, dirty: true }
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

let applying = false // the library changes made by a pull aren't edits made here

/** Run a library change from the server without stamping it as an edit. */
function quietly<T>(change: () => T): T {
  applying = true
  try {
    return change()
  } finally {
    applying = false
  }
}

/** Pull, apply what's newer, then push what's newer here. Members only; quietly gives up offline. */
export async function syncNow(): Promise<void> {
  if (!useLibrary.persist.hasHydrated()) return // never compare against a library that hasn't loaded
  const account = useAccount.getState()
  const uid = account.user?.id
  if (!uid || !isMember(account)) return
  const owner = readOwner()
  if (owner && owner !== uid) return // this device's library is another account's
  if (!owner) setOwner(uid)
  const state = stateOf(uid)
  stamp(state, useLibrary.getState(), Date.now())
  saveState(uid, state) // kept even when the network fails below
  const sb = await supabase()

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
      if (table === 'tracks') await applyTracks(state, rows as TrackRow[])
      else await applyPlaylists(state, rows as PlaylistRow[])
      for (const r of rows) if (!state.cursor[table] || r.synced_at > state.cursor[table]!) state.cursor[table] = r.synced_at
      saveState(uid, state)
      if (rows.length < 1000) break
      from += 1000
    }
  }
  await pushLibrary(uid, state)
  state.joined ??= Date.now()
  saveState(uid, state)

  // The profile, then plays: plays go up even when the profile can't.
  let failed: unknown
  try {
    await syncProfile(uid, state)
  } catch (error) {
    failed = error
  }
  saveState(uid, state)
  await pushPlays(uid, state)
  saveState(uid, state)
  if (failed) throw failed
}

async function applyTracks(state: SyncState, rows: TrackRow[]): Promise<void> {
  const added: Track[] = []
  for (const r of rows) {
    const at = Date.parse(r.updated_at)
    if (!remoteWins(state.tracks[r.id], at)) continue
    const local = useLibrary.getState().tracks[r.id]
    if (r.deleted) {
      if (local) await quietly(() => deleteTrack(r.id))
      state.tracks[r.id] = { h: null, at, dirty: false }
      continue
    }
    const track = trackOf(r)
    if (local) quietly(() => updateTrack(r.id, { title: track.title, artist: track.artist, duration: local.duration || track.duration, addedAt: track.addedAt }))
    else added.push(track)
    state.tracks[r.id] = { h: hash(trackFields({ ...track, duration: local?.duration || track.duration })), at, dirty: false }
  }
  quietly(() => addSyncedTracks(added))
}

async function applyPlaylists(state: SyncState, rows: PlaylistRow[]): Promise<void> {
  for (const r of rows) {
    const at = Date.parse(r.updated_at)
    if (!remoteWins(state.playlists[r.id], at)) continue
    if (r.deleted) {
      if (useLibrary.getState().playlists.some((p) => p.id === r.id)) await quietly(() => deletePlaylist(r.id))
      state.playlists[r.id] = { h: null, at, dirty: false }
    } else {
      quietly(() => putSyncedPlaylist(playlistOf(r)))
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
    for (const [id, k] of dirtyLists) if (state.playlists[id] === k) k.dirty = false
  }
}

// ── Profile ──────────────────────────────────────────────────────────────

const KIND_KEY = { avatar: 'avatarKind', banner: 'bannerKind', backdrop: 'backdropKind' } as const

/** A file from the bucket; undefined when it is gone (a 4xx), so one missing file never stops a sync. */
async function fetchBlob(path: string): Promise<Blob | undefined> {
  const response = await fetch(mediaUrl(path))
  if (response.status >= 400 && response.status < 500) return undefined
  if (!response.ok) throw new Error(`media ${response.status}`)
  return response.blob()
}

/** The paths a row points at. */
const pathsOf = (row: ProfileRow | null | undefined) =>
  new Set(PROFILE_SLOTS.flatMap((s) => [row?.[`${s}_path`], row?.[`${s}_still_path`]]).filter((p) => !!p))

/** The row comes from the account (refreshed on start): apply it if newer, else push ours. A row nobody has pushed
 * to yet (just made by redeem_invite) never replaces a profile made on this device. */
async function syncProfile(uid: string, state: SyncState): Promise<void> {
  const row = useAccount.getState().row
  if (!row) return
  if (!isBlankRow(row) && Date.parse(row.updated_at) > (state.profile?.at ?? 0)) return applyProfile(state, row)
  const known = state.profile
  if (!known?.dirty) return
  // A profile made here before this account had one goes up as of now, never older than the blank row.
  if (known.at === 0) known.at = Math.max(Date.now(), Date.parse(row.updated_at) + 1)
  if (await pushProfile(uid, state, row)) return
  // The server kept a newer edit (last write wins, by the server's rules): take that one.
  const fresh = await refreshRow()
  if (fresh && !isBlankRow(fresh) && Date.parse(fresh.updated_at) > known.at) await applyProfile(state, fresh)
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
      if (!blob) {
        // The file is gone (removed by a moderator, or by an older version of this app): keep what is here.
        next[slot] = current[slot]
        next[KIND_KEY[slot]] = current[KIND_KEY[slot]]
        continue
      }
      await putBlob(slot, blob)
      if (stillBlob) await putBlob(`${slot}-still`, stillBlob)
      else await deleteBlob(`${slot}-still`)
    }
    next[slot] = v
    next[KIND_KEY[slot]] = (row[`${slot}_kind`] ?? 'image') === 'image' ? undefined : (row[`${slot}_kind`] as MediaKind)
    state.media[slot] = { v, path, still }
  }
  quietly(() => replaceProfile(next))
  await Promise.all(removed.flatMap((slot) => [deleteBlob(slot), deleteBlob(`${slot}-still`)]))
  state.profile = { h: hash(profileFields(next)), at: Date.parse(row.updated_at), dirty: false }
}

/** Upload changed media, then update the row. False when the server skipped the update (it holds a newer edit):
 * then nothing here changes, and no file the row points at is deleted. */
async function pushProfile(uid: string, state: SyncState, row: ProfileRow): Promise<boolean> {
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
    const path = `${uid}/profile/${slot}-${v}.${extOf(blob.type) ?? 'jpg'}`
    const up = await sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg', cacheControl: '31536000' })
    if (up.error) throw up.error
    let still: string | null = null
    if (stillBlob) {
      still = `${uid}/profile/${slot}-${v}-still.${extOf(stillBlob.type) ?? 'jpg'}`
      const s = await sb.storage.from(BUCKET).upload(still, stillBlob, { upsert: true, contentType: stillBlob.type || 'image/jpeg', cacheControl: '31536000' })
      if (s.error) throw s.error
    }
    media[slot] = { v, path, still }
  }

  const pinned: PinnedSong[] = (profile.pinnedSongs ?? [])
    .map((id) => tracks[id])
    .filter((t) => !!t)
    .map((t) => ({ id: t.id, title: t.title.slice(0, 120), artist: t.artist.slice(0, 120), source: t.source }))
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
  // No row back: the update was skipped. The files just uploaded stay (they're unused, and harmless).
  if (!data) return false
  for (const slot of PROFILE_SLOTS) {
    const m = media[slot]
    if (m === null) delete state.media[slot]
    else if (m) state.media[slot] = m
  }
  if (state.profile === known) {
    known.dirty = false
    // The server caps a clock that runs ahead at its own: keep its time, so later edits elsewhere still come down.
    known.at = Math.min(known.at, Date.parse((data as ProfileRow).updated_at) || known.at)
  }
  useAccount.setState({ row: data as ProfileRow })
  const live = pathsOf(data as ProfileRow)
  const unused = stale.filter((p) => !live.has(p))
  if (unused.length) void sb.storage.from(BUCKET).remove(unused)
  return true
}

/** Earned badges: the best tier either side has seen, so two devices never fight over them. */
function badgesFor(row: ProfileRow): { id: string; tier: Tier }[] {
  const tiers: Record<string, Tier> = {}
  for (const b of Array.isArray(row.badges) ? row.badges : [])
    if (typeof b?.id === 'string' && Number.isInteger(b.tier) && b.tier >= 1 && b.tier <= 4) tiers[b.id] = b.tier
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
async function pushPlays(uid: string, state: SyncState): Promise<void> {
  // The row here may be old (sharing turned off on another device): ask the server before sending anything.
  const row = useAccount.getState().row?.share_activity ? await refreshRow() : undefined
  if (!row?.share_activity || !isMember({ ready: true, row })) {
    delete state.playsFrom
    delete state.playsSent
    return
  }
  state.playsFrom ??= Date.now()
  await loadPlays()
  // The server takes only plays since sharing last turned on (by its clock); a device that missed the switch-off
  // doesn't send what was played meanwhile.
  const since = row.sharing_since ? Date.parse(row.sharing_since) : 0
  const from = Math.max(state.playsFrom, since, (state.playsSent ?? 0) - LOOKBACK)
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

/** Stamp each edit made here as it happens, for the account this device's library belongs to (signed in or not).
 * startSync does this. Returns the unsubscribe. */
export function recordEdits(): () => void {
  return useLibrary.subscribe((next, prev) => {
    if (next.tracks === prev.tracks && next.playlists === prev.playlists && next.profile === prev.profile) return
    if (applying || !useLibrary.persist.hasHydrated()) return // a pull, or the library loading
    const owner = readOwner()
    if (!owner) return
    const state = stateOf(owner)
    markEdit(state, prev, next, Date.now())
    saveState(owner, state)
  })
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
  recordEdits()
  useLibrary.subscribe((lib, prev) => {
    if (applying || !isMember()) return
    if (lib.tracks !== prev.tracks || lib.playlists !== prev.playlists || lib.profile !== prev.profile) soon(2000)
  })
  // A sync asked for while the library was still loading waited: run it now.
  useLibrary.persist.onFinishHydration(() => isMember() && soon(500))
  usePlayLog.subscribe((log, prev) => {
    if (log.plays !== prev.plays && useAccount.getState().row?.share_activity) soon(30_000)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isMember()) void refreshRow().then(() => requestSync())
  })
  if (typeof window !== 'undefined')
    window.addEventListener('storage', (e) => {
      if (e.key === OWNER) useSyncOwner.setState({ owner: readOwner() })
      if (e.key === null || e.key === OWNER || (cache && e.key === key(cache.uid))) cache = undefined
    })
}
