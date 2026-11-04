// Renaming a song (library.ts renameTrack) on two devices, each with the real library and sync.ts, against the fake
// Supabase: a rename goes up like any edit, the newest rename wins, and a pinned song's new name reaches the profile.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { createClient, createServer, type FakeServer } from './fake-supabase.ts'
import { MemoryStorage } from './mocks.ts'
import type { Track } from '../../src/types.ts'

// Each device has its own IndexedDB and localStorage: the mocks use the one acting now.
const acting = vi.hoisted(() => ({ idb: new Map<string, unknown>() }))
vi.mock('idb-keyval', () => ({
  createStore: () => ({}),
  get: async (k: string) => acting.idb.get(k),
  set: async (k: string, v: unknown) => void acting.idb.set(k, v),
  del: async (k: string) => void acting.idb.delete(k),
}))
vi.mock('../../src/lib/plays.ts', () => ({ usePlayLog: create(() => ({ plays: [] })), loadPlays: async () => {} }))
vi.mock('../../src/lib/stats.ts', () => ({ computeStats: () => ({}), earnedTiers: () => ({}) }))

// Two libraries in one process mustn't hear each other's writes, as two tabs of one device would.
Object.assign(globalThis, { BroadcastChannel: undefined, document: { addEventListener() {}, visibilityState: 'visible' } })

let server: FakeServer

const song = (id: string, extra: Partial<Track> = {}): Track => ({
  id, title: `Song ${id}`, artist: 'Artist', duration: 200, source: 'youtube', addedAt: Date.parse('2026-10-01T00:00:00Z'), ...extra,
})

async function device() {
  vi.resetModules()
  const idb = new Map<string, unknown>()
  const storage = new MemoryStorage()
  const enter = () => {
    acting.idb = idb
    Object.assign(globalThis, { localStorage: storage })
  }
  enter()
  ;(await import('../../src/lib/supabase.ts')).setClient(createClient(server) as never)
  const library = await import('../../src/lib/library.ts')
  const account = await import('../../src/lib/account.ts')
  const sync = await import('../../src/lib/sync.ts')
  sync.recordEdits() // what startSync does for edits
  await vi.waitFor(() => expect(library.useLibrary.persist.hasHydrated()).toBe(true))
  /** Run as this device. */
  const on = async <T,>(fn: () => T | Promise<T>): Promise<T> => {
    enter()
    return fn()
  }
  const join = (email: string) =>
    on(async () => {
      await account.signIn(email)
      expect(await account.verify(email, server.codes.get(email)!)).toBe(true)
      server.invites.add('INVITE01')
      if (!account.useAccount.getState().row?.member) expect(await account.redeemInvite('INVITE01')).toBe('ok')
    })
  const tracks = () => library.useLibrary.getState().tracks
  return { library, account, sync, on, join, tracks }
}

const row = (id: string) => server.tables.library_tracks.find((r) => r.id === id)

beforeEach(() => {
  server = createServer()
})
afterEach(() => vi.useRealTimers())

it('a rename goes up with the next sync, and the other device gets it', async () => {
  const a = await device()
  await a.join('me@example.com')
  await a.on(() => a.library.useLibrary.setState({ tracks: { s: song('s') }, order: ['s'] }))
  await a.on(() => a.sync.syncNow())
  expect(row('s')).toMatchObject({ title: 'Song s', artist: 'Artist' })

  vi.setSystemTime(Date.now() + 1000)
  await a.on(() => a.library.renameTrack('s', '  Night Drive ', ' The Midnight  '))
  expect(a.tracks().s).toMatchObject({ title: 'Night Drive', artist: 'The Midnight' })
  await a.on(() => a.sync.syncNow())
  expect(row('s')).toMatchObject({ title: 'Night Drive', artist: 'The Midnight', deleted: false })

  const b = await device()
  await b.join('me@example.com')
  await b.on(() => b.sync.syncNow())
  expect(b.tracks().s).toMatchObject({ title: 'Night Drive', artist: 'The Midnight', missing: true })
})

it('the newer rename wins, whichever device syncs first', async () => {
  const a = await device()
  await a.join('me@example.com')
  await a.on(() => a.library.useLibrary.setState({ tracks: { s: song('s'), t: song('t') }, order: ['s', 't'] }))
  await a.on(() => a.sync.syncNow())
  const b = await device()
  await b.join('me@example.com')
  await b.on(() => b.sync.syncNow())

  // s: a renames first, b later; a syncs first. t: b renames first, a later; a syncs last.
  vi.setSystemTime(Date.parse('2026-11-02T10:00:00Z'))
  await a.on(() => a.library.renameTrack('s', 'Older', 'A'))
  await b.on(() => b.library.renameTrack('t', 'Older', 'B'))
  vi.setSystemTime(Date.parse('2026-11-02T11:00:00Z'))
  await b.on(() => b.library.renameTrack('s', 'Newer', 'B'))
  await a.on(() => a.library.renameTrack('t', 'Newer', 'A'))
  vi.setSystemTime(Date.parse('2026-11-02T12:00:00Z'))
  await a.on(() => a.sync.syncNow())
  await b.on(() => b.sync.syncNow())
  await a.on(() => a.sync.syncNow())

  for (const d of [a, b]) {
    expect(d.tracks().s).toMatchObject({ title: 'Newer', artist: 'B' })
    expect(d.tracks().t).toMatchObject({ title: 'Newer', artist: 'A' })
  }
  expect(row('s')).toMatchObject({ title: 'Newer', artist: 'B', updated_at: '2026-11-02T11:00:00.000Z' })
  expect(row('t')).toMatchObject({ title: 'Newer', artist: 'A', updated_at: '2026-11-02T11:00:00.000Z' })
})

it('a rename that changes nothing sends nothing', async () => {
  const a = await device()
  await a.join('me@example.com')
  await a.on(() => a.library.useLibrary.setState({ tracks: { s: song('s') }, order: ['s'] }))
  await a.on(() => a.sync.syncNow())
  server.calls.length = 0
  await a.on(() => a.library.renameTrack('s', ' Song s ', 'Artist'))
  await a.on(() => a.sync.syncNow())
  expect(server.calls.filter((c) => c.startsWith('upsert'))).toEqual([])
})

it("a pinned song's new name reaches the public profile", async () => {
  const a = await device()
  await a.join('me@example.com')
  await a.on(() => a.library.useLibrary.setState({ tracks: { s: song('s') }, order: ['s'], profile: { name: 'Me', pinnedSongs: ['s'] } }))
  await a.on(() => a.sync.syncNow())
  expect(server.tables.profiles[0].pinned_songs).toEqual([{ id: 's', title: 'Song s', artist: 'Artist', source: 'youtube' }])

  vi.setSystemTime(Date.now() + 1000)
  await a.on(() => a.library.renameTrack('s', 'Night Drive', 'The Midnight'))
  await a.on(() => a.sync.syncNow())
  expect(server.tables.profiles[0].pinned_songs).toEqual([{ id: 's', title: 'Night Drive', artist: 'The Midnight', source: 'youtube' }])
})
