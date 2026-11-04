// The profile's tabs (src/lib/board.ts), the YouTube key's mask, and pinning playlists (src/lib/library.ts). The
// real library runs on an in-memory IndexedDB stand-in.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryStorage } from './client/mocks.ts'
import { masked, shownTab, tabsOf } from '../src/lib/board.ts'

const kv = vi.hoisted(() => new Map<string, unknown>())
vi.mock('idb-keyval', () => ({
  createStore: () => ({}),
  get: async (k: string) => kv.get(k),
  set: async (k: string, v: unknown) => void kv.set(k, v),
  del: async (k: string) => void kv.delete(k),
}))
Object.assign(globalThis, { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage(), document: { addEventListener() {}, visibilityState: 'visible' } })

const { createPlaylist, deletePlaylist, MAX_PINNED_PLAYLISTS, pinPlaylist, unpinPlaylist, useLibrary } = await import('../src/lib/library.ts')

describe('tabs', () => {
  it('shows only the tabs with something in them, Board, Activity, Posts in that order', () => {
    expect(tabsOf({ posts: true, board: true, activity: true })).toEqual(['board', 'activity', 'posts'])
    expect(tabsOf({ board: false, activity: true, posts: true })).toEqual(['activity', 'posts'])
    expect(tabsOf({ posts: true })).toEqual(['posts'])
    expect(tabsOf({})).toEqual([])
  })

  it('keeps the picked tab while it has something, else falls back to the first', () => {
    expect(shownTab(['board', 'activity', 'posts'], undefined)).toBe('board')
    expect(shownTab(['board', 'activity', 'posts'], 'posts')).toBe('posts')
    // Posts emptied (the last one deleted): back to the first tab.
    expect(shownTab(['board', 'activity'], 'posts')).toBe('board')
    expect(shownTab([], 'board')).toBeUndefined()
  })
})

describe('the YouTube key at rest', () => {
  it('shows dots and its last 4 characters only', () => {
    const key = 'AIzaSyD-very-secret-key-9f3Q'
    expect(masked(key)).toBe('••••••••9f3Q')
    expect(masked(key)).not.toContain('AIza')
    expect(masked('abcdef')).toBe('••cdef')
    expect(masked('abcd')).toBe('••••')
    expect(masked('  ')).toBe('')
    expect(masked('')).toBe('')
  })
})

describe('pinning playlists', () => {
  beforeEach(() => {
    useLibrary.setState({ playlists: [], profile: { name: '' } })
  })
  const pinned = () => useLibrary.getState().profile.pinnedPlaylists ?? []

  it('pins to the front, moves a pinned one to the front again, and unpins', () => {
    const a = createPlaylist()
    const b = createPlaylist()
    pinPlaylist(a)
    pinPlaylist(b)
    expect(pinned()).toEqual([b, a])
    pinPlaylist(a)
    expect(pinned()).toEqual([a, b])
    unpinPlaylist(a)
    expect(pinned()).toEqual([b])
    unpinPlaylist('nope')
    expect(pinned()).toEqual([b])
  })

  it('keeps at most six, dropping the oldest pin', () => {
    const ids = Array.from({ length: MAX_PINNED_PLAYLISTS + 1 }, () => createPlaylist())
    ids.forEach(pinPlaylist)
    expect(pinned()).toHaveLength(MAX_PINNED_PLAYLISTS)
    expect(pinned()[0]).toBe(ids.at(-1))
    expect(pinned()).not.toContain(ids[0])
  })

  it("never pins a playlist that isn't in the library, and a deleted one leaves the Board", async () => {
    pinPlaylist('gone')
    expect(pinned()).toEqual([])
    const a = createPlaylist()
    pinPlaylist(a)
    await deletePlaylist(a)
    expect(pinned()).toEqual([])
  })
})
