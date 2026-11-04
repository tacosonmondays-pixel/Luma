// In-memory replacements for the IndexedDB-backed modules, so sync.ts and account.ts run under Node.
import { create } from 'zustand'
import type { Play, Playlist, Profile, Track } from '../../src/types.ts'

type Lib = { tracks: Record<string, Track>; order: string[]; playlists: Playlist[]; profile: Profile }

export function libraryMock() {
  const useLibrary = create<Lib>()(() => ({
    tracks: {},
    order: [],
    playlists: [],
    profile: { name: '' },
  }))
  const { getState, setState } = useLibrary
  const hydration = { done: true, listeners: new Set<() => void>() }
  return {
    useLibrary,
    get hydrated() {
      return hydration.done
    },
    /** What zustand persist does when the saved library loads: the state is replaced, and that isn't an edit. */
    hydrate(state: Partial<Lib>) {
      hydration.done = false
      setState(state)
      hydration.done = true
      hydration.listeners.forEach((cb) => cb())
    },
    onHydrated(cb: () => void) {
      hydration.listeners.add(cb)
      return () => void hydration.listeners.delete(cb)
    },
    PROFILE_SLOTS: ['avatar', 'banner', 'backdrop'],
    addSyncedTracks: (list: Track[]) =>
      setState((s) => ({
        tracks: { ...s.tracks, ...Object.fromEntries(list.map((t) => [t.id, { ...t, missing: true as const }])) },
        order: [...s.order, ...list.map((t) => t.id)],
      })),
    updateTrack: (id: string, patch: Partial<Track>) => setState((s) => ({ tracks: { ...s.tracks, [id]: { ...s.tracks[id], ...patch } } })),
    deleteTrack: async (id: string) =>
      setState((s) => {
        const tracks = { ...s.tracks }
        delete tracks[id]
        return { tracks, order: s.order.filter((x) => x !== id) }
      }),
    putSyncedPlaylist: (p: Playlist) =>
      setState((s) => ({ playlists: s.playlists.some((x) => x.id === p.id) ? s.playlists.map((x) => (x.id === p.id ? { ...x, ...p } : x)) : [...s.playlists, p] })),
    deletePlaylist: async (id: string) => setState((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) })),
    replaceProfile: (profile: Profile) => setState({ profile }),
    // helpers for tests
    get: getState,
    set: setState,
  }
}

export function blobsMock() {
  const blobs = new Map<string, Blob>()
  return {
    blobs,
    getBlob: async (k: string) => blobs.get(k),
    putBlob: async (k: string, b: Blob) => void blobs.set(k, b),
    deleteBlob: async (k: string) => void blobs.delete(k),
  }
}

export function playsMock() {
  const usePlayLog = create<{ plays?: Play[] }>()(() => ({ plays: [] }))
  return { usePlayLog, loadPlays: async () => {} }
}

export class MemoryStorage {
  private m = new Map<string, string>()
  getItem = (k: string) => this.m.get(k) ?? null
  setItem = (k: string, v: string) => void this.m.set(k, String(v))
  removeItem = (k: string) => void this.m.delete(k)
  clear = () => this.m.clear()
  key = (i: number) => [...this.m.keys()][i] ?? null
  get length() {
    return this.m.size
  }
}

// vi.mock factories run once per file, so "devices" share the mocked modules: they delegate to the active device.
// On globalThis: vi.resetModules gives the factories a fresh copy of this file.
type Active = { lib?: ReturnType<typeof libraryMock>; blobs?: ReturnType<typeof blobsMock>; plays?: ReturnType<typeof playsMock> }
export const active: Active = ((globalThis as { __lumaDevice?: Active }).__lumaDevice ??= {})

const lib = () => active.lib!
export const libraryModule = () => ({
  useLibrary: {
    getState: () => lib().useLibrary.getState(),
    setState: (...a: Parameters<ReturnType<typeof libraryMock>['useLibrary']['setState']>) => lib().useLibrary.setState(...a),
    subscribe: (...a: Parameters<ReturnType<typeof libraryMock>['useLibrary']['subscribe']>) => lib().useLibrary.subscribe(...a),
    persist: {
      hasHydrated: () => lib().hydrated,
      onFinishHydration: (cb: () => void) => lib().onHydrated(cb),
    },
  },
  PROFILE_SLOTS: ['avatar', 'banner', 'backdrop'],
  addSyncedTracks: (l: Track[]) => lib().addSyncedTracks(l),
  updateTrack: (id: string, p: Partial<Track>) => lib().updateTrack(id, p),
  deleteTrack: (id: string) => lib().deleteTrack(id),
  putSyncedPlaylist: (p: Playlist) => lib().putSyncedPlaylist(p),
  deletePlaylist: (id: string) => lib().deletePlaylist(id),
  replaceProfile: (p: Profile) => lib().replaceProfile(p),
})
export const blobsModule = () => ({
  getBlob: (k: string) => active.blobs!.getBlob(k),
  putBlob: (k: string, b: Blob) => active.blobs!.putBlob(k, b),
  deleteBlob: (k: string) => active.blobs!.deleteBlob(k),
})
export const playsModule = () => ({
  usePlayLog: {
    getState: () => active.plays!.usePlayLog.getState(),
    subscribe: (...a: Parameters<ReturnType<typeof playsMock>['usePlayLog']['subscribe']>) => active.plays!.usePlayLog.subscribe(...a),
  },
  loadPlays: async () => {},
})
