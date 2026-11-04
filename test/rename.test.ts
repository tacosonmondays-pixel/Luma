// renameTrack (src/lib/library.ts): trimmed, capped, never an empty title, and no write when nothing changed. The real
// library runs on an in-memory IndexedDB stand-in.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../src/types.ts'

const kv = vi.hoisted(() => ({ map: new Map<string, unknown>(), writes: 0 }))
vi.mock('idb-keyval', () => ({
  createStore: () => ({}),
  get: async (k: string) => kv.map.get(k),
  set: async (k: string, v: unknown) => {
    kv.writes++
    kv.map.set(k, v)
  },
  del: async (k: string) => void kv.map.delete(k),
}))
Object.assign(globalThis, { document: { addEventListener() {}, visibilityState: 'visible' } })

const { MAX_NAME, renameTrack, useLibrary } = await import('../src/lib/library.ts')
await vi.waitFor(() => expect(useLibrary.persist.hasHydrated()).toBe(true))

const song: Track = { id: 's', title: 'Song', artist: 'Artist', duration: 200, source: 'youtube', addedAt: 1 }
const track = () => useLibrary.getState().tracks.s

beforeEach(() => {
  useLibrary.setState({ tracks: { s: { ...song } }, order: ['s'] })
  kv.writes = 0
})

describe('renameTrack', () => {
  it('renames, trimming both names', () => {
    renameTrack('s', '  Night Drive\t', ' The Midnight ')
    expect(track()).toEqual({ ...song, title: 'Night Drive', artist: 'The Midnight' })
  })

  it('keeps the old title when the new one is empty; the artist may be cleared', () => {
    renameTrack('s', '   ', '')
    expect(track()).toMatchObject({ title: 'Song', artist: '' })
  })

  it('cuts each name to MAX_NAME characters, never inside a character', () => {
    expect(MAX_NAME).toBe(200)
    renameTrack('s', 'x'.repeat(250), '🎵'.repeat(250))
    expect(track().title).toBe('x'.repeat(200))
    expect(track().artist).toBe('🎵'.repeat(200))
  })

  it('keeps a long name that was left as it was', () => {
    const long = 'y'.repeat(260)
    useLibrary.setState({ tracks: { s: { ...song, title: long } } })
    renameTrack('s', long, 'Someone')
    expect(track()).toMatchObject({ title: long, artist: 'Someone' })
  })

  it('writes nothing when nothing changed', async () => {
    const before = useLibrary.getState().tracks
    const listener = vi.fn()
    const stop = useLibrary.subscribe(listener)
    renameTrack('s', ' Song ', 'Artist ')
    renameTrack('s', '', 'Artist')
    renameTrack('missing', 'Title', 'Artist')
    stop()
    await Promise.resolve()
    expect(listener).not.toHaveBeenCalled()
    expect(useLibrary.getState().tracks).toBe(before)
    expect(kv.writes).toBe(0)
  })

  it('is saved with the library', async () => {
    renameTrack('s', 'Night Drive', 'The Midnight')
    await vi.waitFor(() => expect(String(kv.map.get('library'))).toContain('Night Drive'))
  })
})
