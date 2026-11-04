// account.ts and sync.ts against a fake Supabase shared by two "devices".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  // An edit on a device happens on that device (its localStorage, its sync module).
  for (const name of ['set', 'hydrate', 'updateTrack', 'deleteTrack', 'deletePlaylist'] as const) {
    const change = lib[name] as (...a: unknown[]) => unknown
    Object.assign(lib, { [name]: (...a: unknown[]) => (enter(), change(...a)) })
  }
  enter()
  const client = createClient(server)
  ;(await import('../../src/lib/supabase.ts')).setClient(client as never)
  const account = await import('../../src/lib/account.ts')
  const sync = await import('../../src/lib/sync.ts')
  sync.recordEdits() // what startSync does for edits
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
    await a.on(() => a.sync.syncNow())
    const b = await device()
    await b.join('me@example.com')
    await b.on(() => b.sync.syncNow())
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
      profile: { name: 'Me', bio: 'hi', avatar: 111, avatarKind: 'animated', colors: ['#ff7ab8', '#6b5bff'], pinnedSongs: ['a'], avatarCrop: { x: 0.3, y: 0.6, zoom: 2 } },
    })
    await a.on(() => a.sync.syncNow())
    expect([...server.files.keys()].sort()).toEqual([`${uid}/profile/avatar-111-still.jpg`, `${uid}/profile/avatar-111.gif`])
    const row = server.tables.profiles[0]
    expect(row).toMatchObject({ name: 'Me', bio: 'hi', avatar_version: 111, avatar_kind: 'animated', avatar_path: `${uid}/profile/avatar-111.gif` })
    expect(row.pinned_songs).toEqual([{ id: 'a', title: 'Song a', artist: 'Artist', source: 'youtube' }])
    expect(row.badges).toEqual([{ id: 'first-spin', tier: 1 }])
    expect(row.crops).toEqual({ avatar: { x: 0.3, y: 0.6, zoom: 2 } })

    // A fresh device: its blank profile never overwrites the server's; the server's comes down.
    const b = await device()
    await b.join('me@example.com')
    await b.on(() => b.sync.syncNow())
    expect(b.lib.get().profile).toMatchObject({ name: 'Me', bio: 'hi', avatar: 111, avatarKind: 'animated', pinnedSongs: ['a'], avatarCrop: { x: 0.3, y: 0.6, zoom: 2 } })
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

describe('sync never loses data', () => {
  let now = 0
  const tick = (ms: number) => vi.setSystemTime((now += ms))
  beforeEach(() => vi.setSystemTime((now = Date.parse('2026-11-02T10:00:00Z'))))
  afterEach(() => vi.useRealTimers())

  it('a library that loads empty never deletes anything: the device starts over instead', async () => {
    const phone = await device()
    await phone.join('me@example.com')
    phone.blobs.blobs.set('avatar', new Blob(['my face'], { type: 'image/jpeg' }))
    phone.lib.set({
      tracks: { a: track('a'), b: track('b') }, order: ['a', 'b'], playlists: [{ id: 'p', name: 'Gym', trackIds: ['a'], createdAt: 1 }],
      profile: { name: 'Me', bio: 'hi', avatar: 7 },
    })
    await phone.on(() => phone.sync.syncNow())
    const avatar = server.tables.profiles[0].avatar_path as string
    tick(60_000)
    const laptop = await device()
    await laptop.join('me@example.com')
    await laptop.on(() => laptop.sync.syncNow())

    // Next launch, the phone's saved library loads empty (a WebKit storage hiccup, a cleared record), then it syncs.
    tick(60_000)
    phone.lib.hydrate({ tracks: {}, order: [], playlists: [], profile: { name: '' } })
    await phone.on(() => phone.sync.syncNow())
    await new Promise((r) => setTimeout(r, 0))
    expect(server.tables.library_tracks.map((r) => r.deleted)).toEqual([false, false])
    expect(server.tables.library_playlists.map((r) => r.deleted)).toEqual([false])
    expect(server.tables.profiles[0]).toMatchObject({ name: 'Me', bio: 'hi', avatar_path: avatar })
    expect(server.files.has(avatar)).toBe(true)
    // The phone gets everything back (songs not downloaded), and the laptop keeps it all.
    expect(Object.values(phone.lib.get().tracks).map((t) => [t.id, t.missing])).toEqual([['a', true], ['b', true]])
    expect(phone.lib.get().playlists.map((p) => p.id)).toEqual(['p'])
    expect(phone.lib.get().profile).toMatchObject({ name: 'Me', avatar: 7 })
    tick(60_000)
    await laptop.on(() => laptop.sync.syncNow())
    expect(Object.keys(laptop.lib.get().tracks).sort()).toEqual(['a', 'b'])

    // Deleting things for real still syncs.
    tick(60_000)
    await phone.lib.deleteTrack('a')
    await phone.on(() => phone.sync.syncNow())
    expect(server.tables.library_tracks.find((r) => r.id === 'a')?.deleted).toBe(true)
  })

  it("a second account on the same device doesn't take its library or its profile", async () => {
    const bPhone = await device()
    await bPhone.join('b@example.com')
    const bId = bPhone.account.useAccount.getState().user!.id
    bPhone.blobs.blobs.set('avatar', new Blob(['bee face'], { type: 'image/jpeg' }))
    bPhone.lib.set({ tracks: { common: track('common'), bsong: track('bsong') }, order: ['common', 'bsong'], profile: { name: 'Bee', avatar: 1 } })
    await bPhone.on(() => bPhone.sync.syncNow())

    tick(60_000)
    const ipad = await device()
    await ipad.join('a@example.com')
    const aId = ipad.account.useAccount.getState().user!.id
    ipad.blobs.blobs.set('avatar', new Blob(['alice face'], { type: 'image/jpeg' }))
    ipad.lib.set({ tracks: { common: track('common'), secret: track('secret') }, order: ['common', 'secret'], profile: { name: 'Alice', avatar: 2 } })
    await ipad.on(() => ipad.sync.syncNow())

    // A signs out; B signs in on the iPad. Nothing of A's goes to B, and B's profile stays B's.
    await ipad.on(() => ipad.account.signOut())
    tick(60_000)
    await ipad.join('b@example.com')
    await ipad.on(() => ipad.sync.syncNow())
    expect(server.tables.library_tracks.filter((r) => r.user_id === bId).map((r) => r.id).sort()).toEqual(['bsong', 'common'])
    const bRow = server.tables.profiles.find((r) => r.id === bId)!
    expect(bRow.name).toBe('Bee')
    expect(await server.files.get(bRow.avatar_path as string)?.text()).toBe('bee face')
    expect(ipad.lib.get().tracks.bsong).toBeUndefined()
    expect(ipad.sync.useSyncOwner.getState().owner).toBe(aId)

    // B deleting "common" on B's phone doesn't touch the iPad's copy (it's A's library), nor A's account.
    tick(60_000)
    await bPhone.lib.deleteTrack('common')
    await bPhone.on(() => bPhone.sync.syncNow())
    await ipad.on(() => ipad.sync.syncNow())
    expect(ipad.lib.get().tracks.common).toBeDefined()
    await ipad.on(() => ipad.account.signOut())
    await ipad.join('a@example.com')
    await ipad.on(() => ipad.sync.syncNow())
    expect(server.tables.library_tracks.filter((r) => r.user_id === aId).map((r) => [r.id, r.deleted]).sort()).toEqual([['common', false], ['secret', false]])

    // Sync Library, on request, makes the iPad B's: it merges in, and B's own profile wins.
    await ipad.on(() => ipad.account.signOut())
    tick(60_000)
    await ipad.join('b@example.com')
    await ipad.on(async () => {
      ipad.sync.linkDevice()
      await ipad.sync.requestSync()
    })
    expect(ipad.sync.useSyncOwner.getState().owner).toBe(bId)
    expect(server.tables.library_tracks.filter((r) => r.user_id === bId).map((r) => [r.id, r.deleted]).sort()).toEqual([
      ['bsong', false], ['common', true], ['secret', false],
    ])
    expect(server.tables.profiles.find((r) => r.id === bId)!.name).toBe('Bee')
    expect(ipad.lib.get().profile.name).toBe('Bee')
  })

  it("an old device signing in for the first time doesn't undo newer edits", async () => {
    const laptop = await device()
    laptop.lib.set({ tracks: { s: track('s', { title: 'Old title' }) }, order: ['s'], profile: { name: 'Old name', bio: 'last year' } })
    tick(60_000)
    const phone = await device()
    await phone.join('me@example.com')
    phone.lib.set({ tracks: { s: track('s', { title: 'Renamed today' }) }, order: ['s'], profile: { name: 'Current name', bio: 'current' } })
    await phone.on(() => phone.sync.syncNow())
    tick(60_000)
    await phone.lib.deleteTrack('s')
    await phone.on(() => phone.sync.syncNow())

    tick(60_000)
    await laptop.join('me@example.com')
    await laptop.on(() => laptop.sync.syncNow())
    expect(server.tables.profiles[0]).toMatchObject({ name: 'Current name', bio: 'current' })
    expect(server.tables.library_tracks.find((r) => r.id === 's')?.deleted).toBe(true)
    expect(laptop.lib.get().profile.name).toBe('Current name')
    expect(laptop.lib.get().tracks.s).toBeUndefined()
    // Something the laptop added after that deletion stays.
    tick(60_000)
    laptop.lib.set({ tracks: { ...laptop.lib.get().tracks, n: track('n', { addedAt: now }) } })
    await laptop.on(() => laptop.sync.syncNow())
    expect(server.tables.library_tracks.find((r) => r.id === 'n')?.deleted).toBe(false)
  })

  it('an edit made offline keeps its own time: a later edit elsewhere wins over it', async () => {
    const phone = await device()
    await phone.join('me@example.com')
    phone.lib.set({ tracks: { x: track('x') }, order: ['x'] })
    await phone.on(() => phone.sync.syncNow())
    const laptop = await device()
    await laptop.join('me@example.com')
    await laptop.on(() => laptop.sync.syncNow())

    // 10:00 the laptop, offline, deletes x. 11:00 the phone renames it. 12:00 the laptop is back online.
    tick(60 * 60_000)
    await laptop.lib.deleteTrack('x')
    const from = laptop.client.from
    laptop.client.from = () => {
      throw new TypeError('Load failed')
    }
    await laptop.on(() => laptop.sync.requestSync())
    laptop.client.from = from
    tick(60 * 60_000)
    phone.lib.updateTrack('x', { title: 'Renamed at 11' })
    await phone.on(() => phone.sync.syncNow())
    tick(60 * 60_000)
    await laptop.on(() => laptop.sync.syncNow())
    expect(server.tables.library_tracks[0]).toMatchObject({ title: 'Renamed at 11', deleted: false })
    await phone.on(() => phone.sync.syncNow())
    expect(phone.lib.get().tracks.x.title).toBe('Renamed at 11')
    expect(laptop.lib.get().tracks.x).toMatchObject({ title: 'Renamed at 11', missing: true })
  })

  it("a profile update the server skips (it holds a newer edit) deletes nothing and isn't taken as synced", async () => {
    const desk = await device()
    await desk.join('me@example.com')
    const uid = desk.account.useAccount.getState().user!.id
    desk.blobs.blobs.set('avatar', new Blob(['v1 face'], { type: 'image/jpeg' }))
    desk.lib.set({ profile: { name: 'Me', avatar: 100 } })
    await desk.on(() => desk.sync.syncNow())
    const v1 = `${uid}/profile/avatar-100.jpg`
    const phone = await device()
    await phone.join('me@example.com')
    await phone.on(() => phone.sync.syncNow())

    // The desk picks a new avatar; while it uploads, the phone edits the bio (a later edit).
    tick(60_000)
    desk.blobs.blobs.set('avatar', new Blob(['v2 face'], { type: 'image/jpeg' }))
    desk.lib.set({ profile: { name: 'Me', avatar: now } })
    const bucket = desk.client.storage.from
    desk.client.storage.from = () => ({
      ...bucket(),
      upload: async (path: string, blob: Blob) => {
        tick(1000)
        phone.lib.set({ profile: { ...phone.lib.get().profile, bio: 'from phone' } })
        await phone.on(() => phone.sync.syncNow())
        await desk.on(() => undefined)
        return bucket().upload(path, blob)
      },
    })
    await desk.on(() => desk.sync.syncNow())
    desk.client.storage.from = bucket
    await new Promise((r) => setTimeout(r, 0))

    expect(server.tables.profiles[0]).toMatchObject({ avatar_path: v1, bio: 'from phone' })
    expect(server.files.has(v1)).toBe(true) // the file the row points at stays
    expect(desk.lib.get().profile).toMatchObject({ bio: 'from phone', avatar: 100 }) // the newer edit came down
    expect(await desk.blobs.blobs.get('avatar')?.text()).toBe('v1 face')
    const ipad = await device()
    await ipad.join('me@example.com')
    await ipad.on(() => ipad.sync.syncNow())
    expect(ipad.lib.get().profile).toMatchObject({ bio: 'from phone', avatar: 100 })
  })

  it("a missing file doesn't stop syncing; plays go up even when the profile can't", async () => {
    const a = await device()
    await a.join('me@example.com')
    a.blobs.blobs.set('avatar', new Blob(['face'], { type: 'image/jpeg' }))
    a.lib.set({ tracks: { dQw4w9WgXcQ: track('dQw4w9WgXcQ') }, order: ['dQw4w9WgXcQ'], profile: { name: 'Me', avatar: 5 } })
    await a.on(() => a.sync.syncNow())
    server.files.clear() // removed by a moderator
    const b = await device()
    await b.join('me@example.com')
    await b.on(() => b.sync.syncNow())
    expect(b.lib.get().profile.name).toBe('Me')
    expect(b.lib.get().profile.avatar).toBeUndefined()

    expect(await b.account.setShareActivity(true)).toBe(true)
    tick(1000)
    b.plays.usePlayLog.setState({ plays: [['dQw4w9WgXcQ', now, 30_000]] })
    // The profile update fails (say the server refuses a value); the plays still go up.
    const from = b.client.from
    b.client.from = (table: string) => {
      const q = from(table)
      if (table === 'profiles') Object.assign(q, { update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'refused' } }) }) }) }) })
      return q
    }
    b.lib.set({ profile: { ...b.lib.get().profile, bio: 'new' } })
    await expect(b.on(() => b.sync.syncNow())).rejects.toMatchObject({ message: 'refused' })
    b.client.from = from
    expect(server.tables.plays).toHaveLength(1)
  })

  it("a device that missed Share Listening going off doesn't send what was played meanwhile", async () => {
    const phone = await device()
    await phone.join('me@example.com')
    expect(await phone.account.setShareActivity(true)).toBe(true)
    const desk = await device()
    await desk.join('me@example.com') // the desk's copy of the row says sharing is on
    desk.lib.set({ tracks: { dQw4w9WgXcQ: track('dQw4w9WgXcQ', { title: 'Guilty pleasure' }) }, order: ['dQw4w9WgXcQ'] })
    await desk.on(() => desk.sync.syncNow())

    tick(60_000)
    expect(await phone.account.setShareActivity(false)).toBe(true)
    tick(60_000)
    const offPlay = now
    desk.plays.usePlayLog.setState({ plays: [['dQw4w9WgXcQ', offPlay, 200_000]] })
    await desk.on(() => desk.sync.syncNow())
    expect(server.tables.plays).toEqual([])
    expect(desk.account.useAccount.getState().row?.share_activity).toBe(false)

    // Sharing back on: still not that play, only new ones.
    tick(60_000)
    expect(await phone.account.setShareActivity(true)).toBe(true)
    tick(60_000)
    desk.plays.usePlayLog.setState({ plays: [['dQw4w9WgXcQ', offPlay, 200_000], ['dQw4w9WgXcQ', now, 1000]] })
    await desk.on(async () => {
      await desk.account.refreshRow()
      await desk.sync.syncNow()
    })
    expect(server.tables.plays.map((r) => r.played_at)).toEqual([new Date(now).toISOString()])
  })
})

describe('row shapes', () => {
  it('the fake profile row has every column the client reads', () => {
    expect(Object.keys(blankRow('x'))).toContain('backdrop_still_path')
  })
})
