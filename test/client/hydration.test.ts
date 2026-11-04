// The real library.ts (zustand persist over idb-keyval) and sync.ts: sync waits for the saved library to load, and a
// library that hasn't loaded is never written over the saved one.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { createClient, createServer, type FakeServer } from './fake-supabase.ts'
import { MemoryStorage } from './mocks.ts'

// IndexedDB: a map that survives "relaunches"; `mode` sets how reads behave on a launch.
type Idb = { map: Map<string, unknown>; mode: 'ok' | 'slow' | 'fail' }
const idb: Idb = ((globalThis as { __lumaIdb?: Idb }).__lumaIdb ??= { map: new Map(), mode: 'ok' })
vi.mock('idb-keyval', () => {
  const g = (globalThis as unknown as { __lumaIdb: Idb }).__lumaIdb
  return {
    createStore: () => ({}),
    get: (k: string) =>
      g.mode === 'fail'
        ? Promise.reject(new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError'))
        : g.mode === 'slow'
          ? new Promise((r) => setTimeout(() => r(g.map.get(k)), 100))
          : Promise.resolve(g.map.get(k)),
    set: async (k: string, v: unknown) => void g.map.set(k, v),
    del: async (k: string) => void g.map.delete(k),
  }
})
vi.mock('../../src/lib/plays.ts', () => ({ usePlayLog: create(() => ({ plays: [] })), loadPlays: async () => {} }))
vi.mock('../../src/lib/stats.ts', () => ({ computeStats: () => ({}), earnedTiers: () => ({}) }))

let server: FakeServer
const storage = new MemoryStorage() // localStorage survives relaunches too
const song = (id: string) => ({ id, title: `Song ${id}`, artist: 'A', duration: 100, source: 'youtube' as const, addedAt: 1 })

async function launch(mode: Idb['mode'], client: ReturnType<typeof createClient>) {
  vi.resetModules()
  idb.mode = mode
  Object.assign(globalThis, { localStorage: storage, document: { addEventListener() {}, visibilityState: 'visible' } })
  ;(await import('../../src/lib/supabase.ts')).setClient(client as never)
  const library = await import('../../src/lib/library.ts')
  const account = await import('../../src/lib/account.ts')
  const sync = await import('../../src/lib/sync.ts')
  sync.recordEdits()
  return { library, account, sync }
}

/** First launch: sign in, join, two songs and a playlist, synced. */
async function setUp(client: ReturnType<typeof createClient>) {
  const one = await launch('ok', client)
  await one.account.signIn('me@example.com')
  await one.account.verify('me@example.com', '123456')
  server.invites.add('GOODCODE')
  expect(await one.account.redeemInvite('GOODCODE')).toBe('ok')
  await vi.waitFor(() => expect(one.library.useLibrary.persist.hasHydrated()).toBe(true))
  one.library.useLibrary.setState({ tracks: { a: song('a'), b: song('b') }, order: ['a', 'b'], playlists: [{ id: 'p', name: 'Mix', trackIds: ['a', 'b'], createdAt: 1 }] })
  await one.sync.syncNow()
  await new Promise((r) => setTimeout(r, 10))
  expect(String(idb.map.get('library'))).toContain('Song a')
}

beforeEach(() => {
  server = createServer()
  idb.map.clear()
  storage.clear()
})
afterEach(() => vi.useRealTimers())

for (const mode of ['fail', 'slow'] as const)
  it(`sync waits for the library: a read that ${mode === 'fail' ? 'fails' : 'is slower than the network'} deletes nothing`, async () => {
    const client = createClient(server)
    await setUp(client)
    const two = await launch(mode, client)
    two.account.useAccount.setState({ user: { id: 'user-1', email: 'me@example.com' }, ready: true })
    await two.account.refreshRow()
    expect(two.account.isMember()).toBe(true)
    expect(two.library.useLibrary.persist.hasHydrated()).toBe(false)
    await two.sync.syncNow()
    expect(server.tables.library_tracks.map((r) => [r.id, r.deleted])).toEqual([['a', false], ['b', false]])
    expect(server.tables.library_playlists.map((r) => [r.id, r.deleted])).toEqual([['p', false]])
    if (mode === 'slow') {
      await vi.waitFor(() => expect(two.library.useLibrary.persist.hasHydrated()).toBe(true))
      await two.sync.syncNow()
      expect(Object.keys(two.library.useLibrary.getState().tracks)).toEqual(['a', 'b'])
      expect(server.tables.library_tracks.map((r) => r.deleted)).toEqual([false, false])
    }
  })

it("a change made before the library loads isn't written over the saved one", async () => {
  const client = createClient(server)
  await setUp(client)
  const two = await launch('slow', client)
  two.library.addSyncedTracks([song('n')]) // say, a pull that came first
  await vi.waitFor(() => expect(two.library.useLibrary.persist.hasHydrated()).toBe(true))
  await new Promise((r) => setTimeout(r, 50))
  expect(String(idb.map.get('library'))).toContain('Song a')
  expect(Object.keys(two.library.useLibrary.getState().tracks)).toEqual(['a', 'b'])
})
