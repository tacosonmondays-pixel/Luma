// The library: songs, playlists, profile and background. Persisted to IndexedDB as one JSON record.

import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { del, get, set } from 'idb-keyval'
import { db, deleteBlob, getBlob, putBlob } from './blobs.ts'
import { uid } from './format.ts'
import type { Media } from './media.ts'
import { imageColors } from './palette.ts'
import type { Background, Playlist, Profile, Track } from '../types.ts'

interface Library {
  tracks: Record<string, Track>
  order: string[] // song ids, newest first
  playlists: Playlist[]
  profile: Profile
  background?: Background
}

// Another tab or window (say the installed app next to a browser tab) writes the same record. Each write
// tells the others, and they reload it instead of later overwriting it with what they had in memory.
const others = typeof BroadcastChannel === 'function' ? new BroadcastChannel('luma-library') : undefined
let saving: Promise<void> = Promise.resolve() // the latest write of the record

export const useLibrary = create<Library>()(
  persist(() => ({ tracks: {}, order: [], playlists: [], profile: { name: '' } }) as Library, {
    name: 'library',
    storage: createJSONStorage(() => ({
      getItem: async (name) => (await get<string>(name, db)) ?? null,
      setItem: (name, value) => {
        // Until the record has loaded once, memory holds an empty library: writing it would replace the saved one.
        if (!loadedOnce()) return Promise.resolve()
        // A change made while another tab's record is loading would be lost under it: load again once saved.
        const reloadAfter = !useLibrary.persist.hasHydrated()
        const write = set(name, value, db).then(() => {
          others?.postMessage(name)
          if (reloadAfter) reload()
        })
        write.catch(() => {}) // a failed write (storage full) is reported where it matters, e.g. addTrack
        saving = write
        return write
      },
      removeItem: (name) => del(name, db),
    })),
    // Replace the data wholesale; a plain merge would keep a background that another tab removed.
    merge: (stored, current) => ({ ...current, background: undefined, ...(stored as Partial<Library>) }),
  }),
)

const { getState, setState } = useLibrary

let loaded = false
function loadedOnce(): boolean {
  return (loaded ||= useLibrary.persist.hasHydrated())
}

function reload() {
  void useLibrary.persist.rehydrate()
}
if (others) others.onmessage = reload
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reload())

let ready = false
const isReady = () => (ready ||= useLibrary.persist.hasHydrated())

/** True once the library has loaded from IndexedDB (and stays true while another tab's changes reload). */
export function useReady(): boolean {
  return useSyncExternalStore(useLibrary.persist.onFinishHydration, isReady)
}

// ── Songs ────────────────────────────────────────────────────────────────

/** Save a song. New songs go on top of Songs, or at `at` (to keep a batch in the order it was picked). */
export async function addTrack(track: Track, audio: Blob, cover?: Blob | null, at = 0): Promise<void> {
  const before = getState().tracks[track.id]
  const isNew = !before
  try {
    await putBlob(`audio:${track.id}`, audio)
    if (cover) await putBlob(`cover:${track.id}`, cover)
    // Downloading a synced song again fills it in where it is, keeping its synced name and date.
    const kept = before?.missing ? { title: before.title, artist: before.artist, addedAt: before.addedAt, canvas: before.canvas, canvasKind: before.canvasKind } : {}
    const saved: Track = { ...track, ...kept, cover: cover ? Date.now() : (before?.cover ?? track.cover) }
    delete saved.missing
    setState((s) => {
      if (before?.missing) return { tracks: { ...s.tracks, [saved.id]: saved } }
      const order = s.order.filter((id) => id !== saved.id)
      order.splice(at, 0, saved.id)
      return { tracks: { ...s.tracks, [saved.id]: saved }, order }
    })
    await saving
  } catch (error) {
    // Out of storage: undo, so the list shows what a reload would.
    if (isNew) {
      await Promise.all([deleteBlob(`audio:${track.id}`), deleteBlob(`cover:${track.id}`)]).catch(() => {})
      if (getState().tracks[track.id])
        setState((s) => {
          const tracks = { ...s.tracks }
          delete tracks[track.id]
          return { tracks, order: s.order.filter((id) => id !== track.id) }
        })
    }
    throw error
  }
  void navigator.storage?.persist?.()
}

/** In the library with its audio (not just synced metadata). */
export const isDownloaded = (track: Track | undefined): track is Track => !!track && !track.missing

/** Songs without audio, synced from another device or saved from YouTube: they show as not downloaded until they
 *  are. Each goes where its date puts it; songs already in the library are left as they are. */
export function addSyncedTracks(list: Track[]): void {
  if (!list.length) return
  setState((s) => {
    const tracks = { ...s.tracks }
    const order = [...s.order]
    for (const t of list) {
      if (tracks[t.id]) continue
      tracks[t.id] = { ...t, missing: true, cover: undefined, canvas: undefined, canvasKind: undefined }
      const at = order.findIndex((id) => (tracks[id]?.addedAt ?? 0) < t.addedAt)
      order.splice(at < 0 ? order.length : at, 0, t.id)
    }
    return { tracks, order }
  })
}

export async function deleteTrack(id: string): Promise<void> {
  setState((s) => {
    const tracks = { ...s.tracks }
    delete tracks[id]
    return {
      tracks,
      order: s.order.filter((x) => x !== id),
      playlists: s.playlists.map((p) => (p.trackIds.includes(id) ? { ...p, trackIds: p.trackIds.filter((x) => x !== id) } : p)),
      profile: s.profile.pinnedSongs?.includes(id) ? { ...s.profile, pinnedSongs: s.profile.pinnedSongs.filter((x) => x !== id) } : s.profile,
    }
  })
  await Promise.all([deleteBlob(`audio:${id}`), deleteBlob(`cover:${id}`), deleteBlob(`canvas:${id}`), deleteBlob(`canvas-still:${id}`)])
}

export async function setTrackCover(id: string, image: Blob): Promise<void> {
  await putBlob(`cover:${id}`, image)
  updateTrack(id, { cover: Date.now() })
}

/** A song's Canvas (image, GIF or video from processMedia), or null to remove it. An animated image keeps its
 * still copy too, shown while the song is paused and under reduced motion (a video just stays on its frame). */
export async function setTrackCanvas(id: string, media: Media | null): Promise<void> {
  if (!media) {
    updateTrack(id, { canvas: undefined, canvasKind: undefined })
    await Promise.all([deleteBlob(`canvas:${id}`), deleteBlob(`canvas-still:${id}`)])
    return
  }
  await putBlob(`canvas:${id}`, media.blob)
  if (media.kind === 'animated' && media.still) await putBlob(`canvas-still:${id}`, media.still)
  else await deleteBlob(`canvas-still:${id}`)
  updateTrack(id, { canvas: Date.now(), canvasKind: media.kind })
  void navigator.storage?.persist?.()
}

export function updateTrack(id: string, patch: Partial<Track>): void {
  const track = getState().tracks[id]
  if (track) setState((s) => ({ tracks: { ...s.tracks, [id]: { ...track, ...patch } } }))
}

// ── Playlists ────────────────────────────────────────────────────────────

let nameToFocus: string | undefined

/** Open this playlist with its name selected for typing (right after creating it). */
export function focusNameOf(id: string): void {
  nameToFocus = id
}

/** True once for the playlist passed to focusNameOf. */
export function takeNameFocus(id: string): boolean {
  if (nameToFocus !== id) return false
  nameToFocus = undefined
  return true
}

/** A new playlist. One made from a YouTube playlist keeps its id in `youtubeId` (and its name). */
export function createPlaylist(trackIds: string[] = [], from?: { name: string; youtubeId: string }): string {
  const id = uid()
  const playlist: Playlist = { id, name: from?.name.trim() || 'New Playlist', trackIds: [...new Set(trackIds)], createdAt: Date.now() }
  if (from) playlist.youtubeId = from.youtubeId
  setState((s) => ({ playlists: [...s.playlists, playlist] }))
  return id
}

function updatePlaylist(id: string, change: (p: Playlist) => Playlist): void {
  setState((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? change(p) : p)) }))
}

/** An empty name is saved as "New Playlist", so leaving the field empty never leaves a playlist nameless. */
export const renamePlaylist = (id: string, name: string) =>
  updatePlaylist(id, (p) => ({ ...p, name: name.trim() ? name : 'New Playlist' }))

export function addToPlaylist(id: string, trackIds: string[]): void {
  updatePlaylist(id, (p) => ({ ...p, trackIds: [...new Set([...p.trackIds, ...trackIds])] }))
}

export function removeFromPlaylist(id: string, trackId: string): void {
  updatePlaylist(id, (p) => ({ ...p, trackIds: p.trackIds.filter((x) => x !== trackId) }))
}

export async function setPlaylistCover(id: string, image: Blob): Promise<void> {
  await putBlob(`playlist-cover:${id}`, image)
  updatePlaylist(id, (p) => ({ ...p, cover: Date.now() }))
}

/** A playlist from sync: replaces the one with its id (keeping the local cover), or joins the end. */
export function putSyncedPlaylist(p: Omit<Playlist, 'cover'>): void {
  setState((s) => {
    const i = s.playlists.findIndex((x) => x.id === p.id)
    if (i < 0) return { playlists: [...s.playlists, { ...p }] }
    const playlists = [...s.playlists]
    playlists[i] = { ...playlists[i], ...p }
    return { playlists }
  })
}

export async function deletePlaylist(id: string): Promise<void> {
  setState((s) => ({
    playlists: s.playlists.filter((p) => p.id !== id),
    profile: s.profile.pinnedPlaylists?.includes(id)
      ? { ...s.profile, pinnedPlaylists: s.profile.pinnedPlaylists.filter((x) => x !== id) }
      : s.profile,
  }))
  await deleteBlob(`playlist-cover:${id}`)
}

// ── Profile & background ─────────────────────────────────────────────────
// Profile media lives under `avatar`, `banner` and `backdrop`, each with a `-still` copy when it is animated or a video.

export type ProfileSlot = 'avatar' | 'banner' | 'backdrop'
export const PROFILE_SLOTS: ProfileSlot[] = ['avatar', 'banner', 'backdrop']
const KIND = { avatar: 'avatarKind', banner: 'bannerKind', backdrop: 'backdropKind' } as const

export const MAX_PINNED_SONGS = 5
export const MAX_PINNED_PLAYLISTS = 6

/**
 * Saves the editor's draft. `media` holds the slots that changed: new media, or null for removed. Blobs are written
 * first and the record last, so a failure (storage full) leaves the stored profile as it was.
 */
export async function saveProfile(draft: Profile, media: Partial<Record<ProfileSlot, Media | null>> = {}): Promise<void> {
  const profile: Profile = { ...draft, name: draft.name.trim() ? draft.name : '', bio: draft.bio?.trim() ? draft.bio : undefined }
  const v = Date.now()
  for (const slot of PROFILE_SLOTS) {
    const picked = media[slot]
    if (picked === undefined) continue
    if (picked) {
      await putBlob(slot, picked.blob)
      if (picked.still) await putBlob(`${slot}-still`, picked.still)
      profile[slot] = v
      profile[KIND[slot]] = picked.kind
    } else {
      profile[slot] = undefined
      profile[KIND[slot]] = undefined
      profile[`${slot}Crop`] = undefined
    }
  }
  if (media.avatar !== undefined || media.banner !== undefined) profile.autoColors = await autoColorsOf(profile, media)
  const before = getState().profile
  setState({ profile })
  try {
    await saving
  } catch (error) {
    setState({ profile: before })
    throw error
  }
  // Removed slots, and `-still` copies a replacement no longer needs.
  await Promise.all(
    PROFILE_SLOTS.flatMap((slot) => {
      const picked = media[slot]
      if (picked === undefined) return []
      if (picked === null) return [deleteBlob(slot), deleteBlob(`${slot}-still`)]
      return picked.still ? [] : [deleteBlob(`${slot}-still`)]
    }),
  )
  if (Object.values(media).some(Boolean)) void navigator.storage?.persist?.()
}

/** Colors from the avatar's still, else the banner's (a new pick, or what is stored). */
async function autoColorsOf(profile: Profile, media: Partial<Record<ProfileSlot, Media | null>>): Promise<[string, string] | undefined> {
  for (const slot of ['avatar', 'banner'] as const) {
    if (!profile[slot]) continue
    const picked = media[slot]
    const blob = picked ? (picked.still ?? picked.blob) : ((await getBlob(`${slot}-still`)) ?? (await getBlob(slot)))
    if (blob) return imageColors(blob).catch(() => undefined)
  }
}

/** The profile from sync. Its media blobs are already stored under the versions it names. */
export function replaceProfile(profile: Profile): void {
  setState({ profile })
}

/** Pins a song to the top of the profile; a sixth pin drops the last. Pinning again moves it to the top. */
export function pinSong(id: string): void {
  setState((s) => ({
    profile: { ...s.profile, pinnedSongs: [id, ...(s.profile.pinnedSongs ?? []).filter((x) => x !== id)].slice(0, MAX_PINNED_SONGS) },
  }))
}

export function unpinSong(id: string): void {
  setState((s) => ({ profile: { ...s.profile, pinnedSongs: (s.profile.pinnedSongs ?? []).filter((x) => x !== id) } }))
}

export async function setBackground(file: Blob | null): Promise<void> {
  if (!file) {
    setState({ background: undefined })
    await deleteBlob('background')
    return
  }
  await putBlob('background', file)
  setState({ background: { v: Date.now(), kind: file.type.startsWith('video/') ? 'video' : 'image' } })
}
