// account.ts and sync.ts against a fake Supabase shared by two "devices".
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { blankRow, createClient, createServer, mediaFetch, type FakeServer } from './fake-supabase.ts'
import { active, blobsMock, libraryMock, MemoryStorage, playsMock } from './mocks.ts'
import type { Track } from '../../src/types.ts'

vi.mock('../../src/lib/library.ts', async () => (await import('./mocks.ts')).libraryModule())
vi.mock('../../src/lib/blobs.ts', async () => (await import('./mocks.ts')).blobsModule())
vi.mock('../../src/lib/plays.ts', async () => (await import('./mocks.ts')).playsModule())
vi.mock('../../src/lib/stats.ts', () => ({ computeStats: () => ({}), earnedTiers: () => ({ 'first-spin': 1 }) }))


let server: FakeServer

async function device() {
  vi.resetModules()
  const storage = new MemoryStorage()
  const lib = libraryMock()
  const blobs = blobsMock()
  const plays = playsMock()
  const enter = () => {
    Object.assign(globalThis, { localStorage: storage, fetch: mediaFetch(server) })
    Object.assign(active, { lib, blobs, plays })
  }
  enter()
  const client = createClient(server)
  ;(await import('../../src/lib/supabase.ts')).setClient(client as never)
  const account = await import('../../src/lib/account.ts')
  const sync = await import('../../src/lib/sync.ts')
  /** Run with this device's localStorage (modules read it when called). */
  const on = async <T,>(fn: () => Promise<T> | T): Promise<T> => {
    enter()
    return fn()
  }
  const join = (email: string) =>
    on(async () => {
      await account.signIn(email)
      expect(await account.verify(email, server.codes.get(email)!)).toBe(true)
      server.invites.add('INVITE' + email.length)
      if (!account.useAccount.getState().row?.member) expect(await account.redeemInvite('INVITE' + email.length)).toBe('ok')
    })
  return { client, account, sync, lib, blobs, plays, storage, on, join }
}

const track = (id: string, extra: Partial<Track> = {}): Track => ({
  id, title: `Song ${id}`, artist: 'Artist', duration: 200.4, source: 'youtube', addedAt: Date.parse('2026-10-01T00:00:00Z'), ...extra,
})

beforeEach(() => {
  server = createServer()
})

describe('account', () => {
  it('signs in with an email code, redeems an invite and claims a handle', async () => {
    const d = await device()
    expect(await d.account.signIn('me@example.com')).toBe(true)
    expect(await d.account.verify('me@example.com', '000000')).toBe(false)
    expect(await d.account.verify('me@example.com', '123456')).toBe(true)
    expect(d.account.useAccount.getState().row).toBeNull() // signed in, not a member
    expect(await d.account.redeemInvite('NOPE1234')).toBe('invalid')
    server.invites.add('GOOD1234')
    expect(await d.account.redeemInvite('GOOD1234')).toBe('ok')
    expect(d.account.isMember()).toBe(true)
    expect(await d.account.claimHandle('No!')).toBe('invalid')
    expect(await d.account.claimHandle('@Night_Owl')).toBe('ok')
    expect(d.account.useAccount.getState().row?.handle).toBe('night_owl')

    const other = await device()
    await other.join('other@example.com')
    expect(await other.account.claimHandle('night_owl')).toBe('taken')
  })

  it('signs out', async () => {
    const d = await device()
    await d.join('me@example.com')
    await d.account.signOut()
    expect(d.account.useAccount.getState().user).toBeUndefined()
  })

  it('shares profiles from the site address inside the iOS app', async () => {
    const d = await device()
    Object.assign(globalThis, { location: { protocol: 'luma:', origin: 'null' } })
    expect(d.account.profileLink('me')).toBe('https://tacosonmondays-pixel.github.io/Luma/u/me')
    Object.assign(globalThis, { location: { protocol: 'https:', origin: 'https://example.com' } })
    expect(d.account.profileLink('me')).toBe('https://example.com/u/me')
  })
})

describe('sync', () => {
  it('does nothing for signed-out users and non-members', async () => {
    const d = await device()
    d.lib.set({ tracks: { a: track('a') }, order: ['a'] })
    await d.sync.syncNow()
    expect(server.calls).toEqual([])
    await d.on(async () => {
      await d.account.signIn('x@example.com')
      await d.account.verify('x@example.com', '123456')
    })
    server.calls.length = 0
    await d.sync.syncNow()
    expect(server.calls).toEqual([])
  })

  it('backs up metadata only, and a new device gets songs as not downloaded', async () => {
    const a = await device()
    await a.join('me@example.com')
    a.blobs.blobs.set('audio:a', new Blob(['music']))
    a.lib.set({
      tracks: { a: track('a'), b: track('b', { source: 'file' }) },
      order: ['a', 'b'],
      playlists: [{ id: 'p', name: 'Mix', trackIds: ['a', 'b'], createdAt: 5 }],
    })
    await a.on(() => a.sync.syncNow())
    expect(server.tables.library_tracks.map((r) => r.id).sort()).toEqual(['a', 'b'])
    expect(JSON.stringify(server.tables.library_tracks)).not.toContain('music')
    expect([...server.files.keys()].some((p) => /audio|\.m4a|\.mp3/.test(p))).toBe(false)

    const b = await device()
    await b.join('me@example.com')
    await b.on(() => b.sync.syncNow())
    const got = b.lib.get().tracks
    expect(Object.keys(got).sort()).toEqual(['a', 'b'])
    expect(got.a.missing).toBe(true)
    expect(got.a.title).toBe('Song a')
    expect(b.lib.get().playlists).toEqual([{ id: 'p', name: 'Mix', trackIds: ['a', 'b'], createdAt: 5 }])
    expect(b.blobs.blobs.has('audio:a')).toBe(false)

    // A second sync with nothing changed pushes nothing.
    server.calls.length = 0
    await b.on(() => b.sync.syncNow())
    expect(server.calls.filter((c) => c.startsWith('upsert'))).toEqual([])
  })

  it('last write wins, and deletions travel as tombstones', async () => {
    const a = await device()
    await a.join('me@example.com')
    a.lib.set({ tracks: { a: track('a'), b: track('b') }, order: ['a', 'b'] })
    await a.on(() => a.sync.syncNow())
    const b = await device()
    await b.join('me@example.com')
    await b.on(() => b.sync.syncNow())

    // b renames a; later a deletes b. Both sync.
    vi.setSystemTime(Date.now() + 1000)
    b.lib.updateTrack('a', { title: 'Renamed' })
    await b.on(() => b.sync.syncNow())
    vi.setSystemTime(Date.now() + 2000)
    await a.lib.deleteTrack('b')
    await a.on(() => a.sync.syncNow())
    await b.on(() => b.sync.syncNow())
    vi.useRealTimers()

    expect(a.lib.get().tracks.a.title).toBe('Renamed')
    expect(b.lib.get().tracks.b).toBeUndefined()
    expect(server.tables.library_tracks.find((r) => r.id === 'b')?.deleted).toBe(true)
  })

  it('an older edit loses to a newer one from another device', async () => {
    const a = await device()
    await a.join('me@example.com')
    const b = await device()
    await b.join('me@example.com')
    vi.setSystemTime(Date.parse('2026-11-02T10:00:00Z'))
    a.lib.set({ tracks: { s: track('s', { title: 'Older' }) }, order: ['s'] })
    await a.on(() => a.sync.syncNow()) // stamps s at 10:00
    vi.setSystemTime(Date.parse('2026-11-02T11:00:00Z'))
    b.lib.set({ tracks: { s: track('s', { title: 'Newer' }) }, order: ['s'] })
    await b.on(() => b.sync.syncNow()) // b's own edit at 11:00 beats a's at 10:00
    vi.useRealTimers()
    expect(b.lib.get().tracks.s.title).toBe('Newer')
    await a.on(() => a.sync.syncNow())
    expect(a.lib.get().tracks.s.title).toBe('Newer')
  })

  it('profile and its media go up to <uid>/profile/ and come back down into the blobs', async () => {
    const a = await device()
    await a.join('me@example.com')
    const uid = a.account.useAccount.getState().user!.id
    a.blobs.blobs.set('avatar', new Blob(['gif'], { type: 'image/gif' }))
    a.blobs.blobs.set('avatar-still', new Blob(['jpg'], { type: 'image/jpeg' }))
    a.lib.set({
      tracks: { a: track('a') },
      order: ['a'],
      profile: { name: 'Me', bio: 'hi', avatar: 111, avatarKind: 'animated', colors: ['#ff7ab8', '#6b5bff'], pinnedSongs: ['a'] },
    })
    await a.on(() => a.sync.syncNow())
    expect([...server.files.keys()].sort()).toEqual([`${uid}/profile/avatar-111-still.jpg`, `${uid}/profile/avatar-111.gif`])
    const row = server.tables.profiles[0]
    expect(row).toMatchObject({ name: 'Me', bio: 'hi', avatar_version: 111, avatar_kind: 'animated', avatar_path: `${uid}/profile/avatar-111.gif` })
    expect(row.pinned_songs).toEqual([{ id: 'a', title: 'Song a', artist: 'Artist', source: 'youtube' }])
    expect(row.badges).toEqual([{ id: 'first-spin', tier: 1 }])

    // A fresh device: its blank profile never overwrites the server's; the server's comes down.
    const b = await device()
    await b.join('me@example.com')
    await b.on(() => b.sync.syncNow())
    expect(b.lib.get().profile).toMatchObject({ name: 'Me', bio: 'hi', avatar: 111, avatarKind: 'animated', pinnedSongs: ['a'] })
    expect(await b.blobs.blobs.get('avatar')?.text()).toBe('gif')
    expect(await b.blobs.blobs.get('avatar-still')?.text()).toBe('jpg')

    // Removing the avatar on b removes it on a, and the old files go.
    vi.setSystemTime(Date.now() + 5000)
    b.lib.set({ profile: { ...b.lib.get().profile, avatar: undefined, avatarKind: undefined } })
    await b.on(() => b.sync.syncNow())
    vi.useRealTimers()
    expect(server.files.size).toBe(0)
    await a.on(async () => {
      await a.account.refreshRow()
      await a.sync.syncNow()
    })
    expect(a.lib.get().profile.avatar).toBeUndefined()
    expect(a.blobs.blobs.has('avatar')).toBe(false)
  })

  it("a new member's local profile isn't replaced by the server's blank row", async () => {
    const a = await device()
    a.lib.set({ profile: { name: 'Local Me' } })
    // The server's row is "newer" (made at redeem time on a clock ahead of ours)
    vi.setSystemTime(Date.parse('2026-11-01T00:00:00Z'))
    await a.join('me@example.com')
    server.tables.profiles[0].updated_at = '2030-01-01T00:00:00.000Z'
    await a.account.refreshRow()
    await a.on(() => a.sync.syncNow())
    vi.useRealTimers()
    expect(a.lib.get().profile.name).toBe('Local Me')
  })

  it('plays go to the feed only while sharing is on', async () => {
    const a = await device()
    await a.join('me@example.com')
    a.lib.set({ tracks: { dQw4w9WgXcQ: track('dQw4w9WgXcQ') }, order: ['dQw4w9WgXcQ'] })
    a.plays.usePlayLog.setState({ plays: [['dQw4w9WgXcQ', Date.now() - 1000, 30_000]] })
    await a.on(() => a.sync.syncNow())
    expect(server.tables.plays).toEqual([])

    expect(await a.account.setShareActivity(true)).toBe(true)
    await a.on(() => a.sync.syncNow()) // sharing starts now: earlier plays stay private
    expect(server.tables.plays).toEqual([])
    a.plays.usePlayLog.setState({ plays: [...a.plays.usePlayLog.getState().plays!, ['dQw4w9WgXcQ', Date.now() + 10, 31_000]] })
    await a.on(() => a.sync.syncNow())
    expect(server.tables.plays).toMatchObject([{ track_id: 'dQw4w9WgXcQ', youtube_id: 'dQw4w9WgXcQ', title: 'Song dQw4w9WgXcQ', listened_ms: 31_000 }])
  })

  it('keeps working when the server is unreachable', async () => {
    const a = await device()
    await a.join('me@example.com')
    a.lib.set({ tracks: { a: track('a') }, order: ['a'] })
    const from = a.client.from
    a.client.from = () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(a.on(() => a.sync.requestSync())).resolves.toBeUndefined()
    a.client.from = from
    await a.on(() => a.sync.requestSync())
    expect(server.tables.library_tracks).toHaveLength(1)
  })
})

describe('row shapes', () => {
  it('the fake profile row has every column the client reads', () => {
    expect(Object.keys(blankRow('x'))).toContain('backdrop_still_path')
  })
})
