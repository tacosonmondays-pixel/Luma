// The library: songs, playlists, profile and background. Persisted to IndexedDB as one JSON record.

import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { del, get, set } from 'idb-keyval'
import { db, deleteBlob, putBlob } from './blobs.ts'
import { uid } from './format.ts'
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
  const isNew = !getState().tracks[track.id]
  try {
    await putBlob(`audio:${track.id}`, audio)
    if (cover) await putBlob(`cover:${track.id}`, cover)
    const saved: Track = { ...track, cover: cover ? Date.now() : track.cover }
    setState((s) => {
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

export async function deleteTrack(id: string): Promise<void> {
  setState((s) => {
    const tracks = { ...s.tracks }
    delete tracks[id]
    return {
      tracks,
      order: s.order.filter((x) => x !== id),
      playlists: s.playlists.map((p) => (p.trackIds.includes(id) ? { ...p, trackIds: p.trackIds.filter((x) => x !== id) } : p)),
    }
  })
  await Promise.all([deleteBlob(`audio:${id}`), deleteBlob(`cover:${id}`)])
}

export async function setTrackCover(id: string, image: Blob): Promise<void> {
  await putBlob(`cover:${id}`, image)
  updateTrack(id, { cover: Date.now() })
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

export function createPlaylist(trackIds: string[] = []): string {
  const id = uid()
  const name = 'New Playlist'
  setState((s) => ({ playlists: [...s.playlists, { id, name, trackIds: [...new Set(trackIds)], createdAt: Date.now() }] }))
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

export async function deletePlaylist(id: string): Promise<void> {
  setState((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }))
  await deleteBlob(`playlist-cover:${id}`)
}

// ── Profile & background ─────────────────────────────────────────────────

export const setProfileName = (name: string) => setState((s) => ({ profile: { ...s.profile, name } }))

export async function setProfileImage(which: 'avatar' | 'banner', image: Blob): Promise<void> {
  await putBlob(which, image)
  setState((s) => ({ profile: { ...s.profile, [which]: Date.now() } }))
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
