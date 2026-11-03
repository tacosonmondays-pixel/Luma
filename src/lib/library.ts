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

export const useLibrary = create<Library>()(
  persist(() => ({ tracks: {}, order: [], playlists: [], profile: { name: '' } }) as Library, {
    name: 'library',
    storage: createJSONStorage(() => ({
      getItem: async (name) => (await get<string>(name, db)) ?? null,
      setItem: (name, value) => set(name, value, db),
      removeItem: (name) => del(name, db),
    })),
  }),
)

const { getState, setState } = useLibrary

/** True once the library has loaded from IndexedDB. */
export function useReady(): boolean {
  return useSyncExternalStore(useLibrary.persist.onFinishHydration, useLibrary.persist.hasHydrated)
}

// ── Songs ────────────────────────────────────────────────────────────────

export async function addTrack(track: Track, audio: Blob, cover?: Blob | null): Promise<void> {
  await putBlob(`audio:${track.id}`, audio)
  if (cover) await putBlob(`cover:${track.id}`, cover)
  const saved: Track = { ...track, cover: cover ? Date.now() : track.cover }
  setState((s) => ({
    tracks: { ...s.tracks, [saved.id]: saved },
    order: [saved.id, ...s.order.filter((id) => id !== saved.id)],
  }))
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

export function createPlaylist(trackIds: string[] = []): string {
  const id = uid()
  const name = 'New Playlist'
  setState((s) => ({ playlists: [...s.playlists, { id, name, trackIds: [...new Set(trackIds)], createdAt: Date.now() }] }))
  return id
}

function updatePlaylist(id: string, change: (p: Playlist) => Playlist): void {
  setState((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? change(p) : p)) }))
}

export const renamePlaylist = (id: string, name: string) => updatePlaylist(id, (p) => ({ ...p, name }))

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
