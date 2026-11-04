// social.ts, posting.ts, moderation.ts and viewer.ts against the fake Supabase, with an in-memory uploader.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addMember, createClient, createServer, type FakeServer } from './fake-supabase.ts'
import { MemoryStorage } from './mocks.ts'
import type { Media } from '../../src/lib/media.ts'
import type { Uploader } from '../../src/lib/posting.ts'

// supabase-js itself: counts its loads. Every test here hands the modules the fake client instead, so a load means
// some code path reached for the real one.
const loads = vi.hoisted(() => ({ n: 0 }))
vi.mock('@supabase/supabase-js', () => {
  loads.n++
  return { createClient: () => ({}) }
})
const player = vi.hoisted(() => {
  const audio = { paused: false }
  return { audio, pause: () => void (audio.paused = true), play: () => void (audio.paused = false) }
})
vi.mock('../../src/lib/player.ts', () => player)

const MB = 1024 * 1024
const HOUR = 3600_000
const DAY = 24 * HOUR
let server: FakeServer

async function device({ connect = true } = {}) {
  vi.resetModules()
  // A document, so social.ts follows the account (as in the browser).
  Object.assign(globalThis, { localStorage: new MemoryStorage(), document: { addEventListener() {}, visibilityState: 'visible' } })
  const client = createClient(server)
  if (connect) (await import('../../src/lib/supabase.ts')).setClient(client as never)
  const account = await import('../../src/lib/account.ts')
  const social = await import('../../src/lib/social.ts')
  const posting = await import('../../src/lib/posting.ts')
  const moderation = await import('../../src/lib/moderation.ts')
  const viewer = await import('../../src/lib/viewer.ts')
  posting.setUploader(memoryUploader)
  const state = () => social.useSocial.getState()
  return { client, account, social, posting, moderation, viewer, state }
}
type Device = Awaited<ReturnType<typeof device>>

/** Sign in; with a handle, also redeem an invite and claim it. Resolves the user id. */
async function signIn(d: Device, email: string, handle?: string): Promise<string> {
  await d.account.signIn(email)
  expect(await d.account.verify(email, server.codes.get(email)!)).toBe(true)
  if (handle && !d.account.useAccount.getState().row?.member) {
    server.invites.add(`INVITE${handle.toUpperCase()}`)
    expect(await d.account.redeemInvite(`INVITE${handle.toUpperCase()}`)).toBe('ok')
    expect(await d.account.claimHandle(handle)).toBe('ok')
  }
  return d.account.useAccount.getState().user!.id
}

async function makeAdmin(d: Device, id: string) {
  server.tables.profiles.find((r) => r.id === id)!.admin = true
  await d.account.refreshRow()
}

const memoryUploader: Uploader = async (path, blob, { signal, onProgress }) => {
  server.calls.push(`upload ${path}`)
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  onProgress(blob.size / 2)
  server.files.set(path, blob)
  server.fileTimes.set(path, Date.now())
  onProgress(blob.size)
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const image = (bytes = 100): Media => ({ blob: new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), kind: 'image' })
const clip = (bytes = 300): Media => ({
  blob: new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), still: new Blob([new Uint8Array(40)], { type: 'image/jpeg' }), kind: 'video', duration: 2.5,
})
const postRow = (id: string, user: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: user, body: id, image_paths: [], youtube_id: null, track_title: null, track_artist: null, created_at: ago(HOUR), removed_at: null, ...extra,
})
const videoRow = (id: string, user: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: user, path: `${user}/videos/${id}.mp4`, still_path: `${user}/videos/${id}-still.jpg`, caption: '', youtube_id: null,
  track_title: null, track_artist: null, duration: 3, created_at: ago(HOUR), removed_at: null, ...extra,
})
const files = (prefix: string) => [...server.files.keys()].filter((p) => p.startsWith(prefix)).sort()

beforeEach(() => {
  server = createServer()
  player.audio.paused = false
})
afterEach(() => vi.unstubAllGlobals())

describe('follows', () => {
  it('follow is optimistic; a refusal undoes it; "already following" counts as done', async () => {
    const d = await device()
    const me = await signIn(d, 'me@example.com', 'mira')
    addMember(server, 'u-bob', 'bob')
    addMember(server, 'u-carol', 'carol')
    expect(await d.social.loadMine()).toBe(true)
    expect(d.state().following).toEqual([])

    const bob = d.social.follow('u-bob')
    expect(d.state().following).toEqual(['u-bob'])
    expect(await bob).toBe(true)
    expect(server.tables.follows).toMatchObject([{ follower_id: me, followee_id: 'u-bob' }])

    server.errors.set('insert follows', { code: '08006', message: 'connection failure' })
    const carol = d.social.follow('u-carol')
    expect(d.state().following).toEqual(['u-bob', 'u-carol'])
    expect(await carol).toBe(false)
    expect(d.state().following).toEqual(['u-bob'])
    server.errors.clear()

    // Followed on another device meanwhile: the server answers 23505.
    server.tables.follows.push({ follower_id: me, followee_id: 'u-carol', created_at: ago(1000) })
    expect(await d.social.follow('u-carol')).toBe(true)
    expect(server.calls.at(-1)).toBe('insert follows')
    expect(d.state().following).toEqual(['u-bob', 'u-carol'])
  })

  it('unfollow is optimistic too, and undone on an error', async () => {
    const d = await device()
    const me = await signIn(d, 'me@example.com', 'mira')
    addMember(server, 'u-bob', 'bob')
    server.tables.follows.push({ follower_id: me, followee_id: 'u-bob', created_at: ago(1000) })
    await d.social.loadMine()
    expect(d.state().following).toEqual(['u-bob'])

    server.errors.set('delete follows', { message: 'boom' })
    const off = d.social.unfollow('u-bob')
    expect(d.state().following).toEqual([])
    expect(await off).toBe(false)
    expect(d.state().following).toEqual(['u-bob'])
    server.errors.clear()

    expect(await d.social.unfollow('u-bob')).toBe(true)
    expect(server.tables.follows).toEqual([])
  })

  it('a second press while one is on its way changes nothing (a double tap, both refused)', async () => {
    const d = await device()
    await signIn(d, 'me@example.com', 'mira')
    addMember(server, 'u-bob', 'bob')
    await d.social.loadMine()
    server.errors.set('insert follows', { message: 'TypeError: Failed to fetch' })
    server.errors.set('delete follows', { message: 'TypeError: Failed to fetch' })
    const on = d.social.follow('u-bob')
    const off = d.social.unfollow('u-bob') // the pill already says Following
    expect(d.state().following).toEqual(['u-bob'])
    expect(await on).toBe(false)
    expect(await off).toBe(false)
    expect(server.tables.follows).toEqual([])
    expect(d.state().following).toEqual([])
    expect(server.calls.filter((c) => c.endsWith(' follows') && !c.startsWith('select'))).toEqual(['insert follows'])
  })

  it('lists who someone follows and who follows them, for anyone', async () => {
    const d = await device()
    addMember(server, 'u-bob', 'bob')
    addMember(server, 'u-carol', 'carol')
    addMember(server, 'u-dave', 'dave', { banned: true })
    server.tables.follows.push(
      { follower_id: 'u-bob', followee_id: 'u-carol', created_at: ago(2000) },
      { follower_id: 'u-dave', followee_id: 'u-carol', created_at: ago(1000) },
    )
    expect((await d.social.loadFollows('u-carol', 'followers'))?.people.map((p) => p.handle)).toEqual(['bob'])
    expect(await d.social.loadFollows('u-bob', 'following')).toMatchObject({ people: [{ handle: 'carol' }], done: true })
  })
})

describe('feed', () => {
  async function friends() {
    const d = await device()
    const me = await signIn(d, 'me@example.com', 'mira')
    addMember(server, 'u-bob', 'bob', { share_activity: true })
    addMember(server, 'u-carol', 'carol', { share_activity: true })
    addMember(server, 'u-dave', 'dave') // doesn't share
    addMember(server, 'u-eve', 'eve', { share_activity: true }) // not followed
    for (const who of ['u-bob', 'u-carol', 'u-dave']) server.tables.follows.push({ follower_id: me, followee_id: who, created_at: ago(DAY) })
    const play = (user: string, title: string, youtube: string | null, at: number) =>
      server.tables.plays.push({ id: `${user}-${title}`, user_id: user, track_id: title, youtube_id: youtube, title, artist: 'Artist', played_at: ago(at), listened_ms: 60_000 })
    play('u-bob', 'Song A', 'aaaaaaaaaaa', 5 * 60_000)
    play('u-carol', 'Song A', 'aaaaaaaaaaa', 3 * 60_000)
    play('u-carol', 'Imported', null, 10 * 60_000)
    play('u-dave', 'Private', 'ddddddddddd', 60_000)
    play('u-eve', 'Stranger', 'eeeeeeeeeee', 60_000)
    play('u-bob', 'Last Month', 'fffffffffff', 30 * DAY)
    server.tables.posts.push(postRow('p1', 'u-bob', { created_at: ago(2 * HOUR) }), postRow('p-eve', 'u-eve'))
    server.tables.videos.push(videoRow('v1', 'u-carol', { created_at: ago(HOUR) }), videoRow('v-gone', 'u-bob', { removed_at: ago(1) }))
    return d
  }

  it("holds only followees' shared plays, one tile per song with faces, and their posts", async () => {
    const d = await friends()
    const feed = await d.social.loadFeed()
    expect(feed?.plays).toEqual([
      { key: 'aaaaaaaaaaa', song: { youtubeId: 'aaaaaaaaaaa', title: 'Song A', artist: 'Artist' }, userIds: ['u-carol', 'u-bob'] },
      { key: 'imported|artist', song: { youtubeId: undefined, title: 'Imported', artist: 'Artist' }, userIds: ['u-carol'] },
    ])
    expect(feed?.posts.map((p) => p.id)).toEqual(['v1', 'p1'])
    expect(Object.keys(d.state().people).sort()).toEqual(['u-bob', 'u-carol'])

    server.calls.length = 0
    expect(await d.social.loadFeed()).toBe(feed) // a minute's cache
    expect(server.calls).toEqual([])
  })

  it('a failure hides it; the next load (Home, on its next visit) asks again', async () => {
    const d = await friends()
    server.errors.set('select videos', { message: 'timeout' })
    expect(await d.social.loadFeed()).toBeNull()
    expect(d.state().feed).toBeNull()
    server.errors.clear()
    await d.social.loadMine(true) // nothing else brings it back
    expect(d.state().feed).toBeNull()
    expect((await d.social.loadFeed())?.posts.map((p) => p.id)).toEqual(['v1', 'p1'])
  })

  it('following no one, nothing loads', async () => {
    const d = await device()
    await signIn(d, 'me@example.com', 'mira')
    server.calls.length = 0
    expect(await d.social.loadFeed()).toMatchObject({ plays: [], posts: [] })
    expect(server.calls.filter((c) => /plays|videos|posts/.test(c))).toEqual([])
  })

  it('a follow or an unfollow makes it stale', async () => {
    const d = await friends()
    const first = await d.social.loadFeed()
    await d.social.unfollow('u-carol')
    expect(d.state().feed?.at).toBe(0)
    const second = await d.social.loadFeed()
    expect(second).not.toBe(first)
    expect(second?.posts.map((p) => p.id)).toEqual(['p1'])
  })

  it("someone's posts page through both tables", async () => {
    const d = await device()
    addMember(server, 'u-bob', 'bob')
    for (let i = 0; i < 30; i++) server.tables.posts.push(postRow(`p${i}`, 'u-bob', { created_at: ago((2 * i + 1) * 60_000) }))
    for (let i = 0; i < 10; i++) server.tables.videos.push(videoRow(`v${i}`, 'u-bob', { created_at: ago(2 * i * 60_000) }))
    const first = await d.social.loadPosts('u-bob')
    expect(first?.items).toHaveLength(24)
    expect(first?.done).toBe(false)
    const second = await d.social.loadPosts('u-bob', true)
    expect(second?.items).toHaveLength(40)
    expect(second?.done).toBe(true)
    expect(new Set(second?.items.map((p) => p.id)).size).toBe(40)
  })
})

describe('publish', () => {
  it('uploads a video in order (still, video), then inserts it; the post comes first in my list', async () => {
    const d = await device()
    const me = await signIn(d, 'me@example.com', 'mira')
    server.calls.length = 0
    const progress: number[] = []
    const post = await d.posting.publish(
      { text: '  Watch this  ', media: [clip()], track: { id: 'dQw4w9WgXcQ', title: 'Never', artist: 'Rick', source: 'youtube' } },
      { onProgress: (sent, total) => progress.push(sent / total) },
    )
    const steps = server.calls.filter((c) => /^(upload|insert|rpc)/.test(c))
    const base = /^upload [^/]+\/videos\/(.+)-still\.jpg$/.exec(steps[1])?.[1]
    expect(steps).toEqual(['rpc media_left', `upload ${me}/videos/${base}-still.jpg`, `upload ${me}/videos/${base}.mp4`, 'insert videos'])
    expect(server.tables.videos).toMatchObject([{
      user_id: me, path: `${me}/videos/${base}.mp4`, still_path: `${me}/videos/${base}-still.jpg`, caption: 'Watch this',
      youtube_id: 'dQw4w9WgXcQ', track_title: 'Never', track_artist: 'Rick', duration: 2.5,
    }])
    expect(post).toMatchObject({ kind: 'video', userId: me, text: 'Watch this', song: { youtubeId: 'dQw4w9WgXcQ', title: 'Never' } })
    expect(d.state().lists[me].items[0]).toEqual(post)
    expect(progress.at(-1)).toBe(1)
    expect(progress).toEqual([...progress].sort((a, b) => a - b))
  })

  it('uploads images, then the post; a song from a file has no YouTube id', async () => {
    const d = await device()
    const me = await signIn(d, 'me@example.com', 'mira')
    const post = await d.posting.publish({ text: 'three', media: [image(), image(), image()], track: { id: 'f-1', title: 'Demo', artist: 'Me', source: 'file' } })
    expect(files(`${me}/posts/`)).toHaveLength(3)
    expect(server.tables.posts).toMatchObject([{ body: 'three', image_paths: files(`${me}/posts/`), youtube_id: null, track_title: 'Demo' }])
    expect(post?.images).toHaveLength(3)
  })

  it("the insert's daily limit removes what went up", async () => {
    const d = await device()
    const me = await signIn(d, 'me@example.com', 'mira')
    server.errors.set('insert posts', { code: '54000', message: 'posts limit reached' })
    const failed = d.posting.publish({ text: 'x', media: [image(), image()] })
    await expect(failed).rejects.toMatchObject({ code: 'daily-limit' })
    expect(d.posting.postErrorLabel(await failed.catch((e) => e))).toBe('Daily Limit')
    expect(files(`${me}/`)).toEqual([])
    expect(server.calls.filter((c) => c.startsWith('remove'))).toHaveLength(1)
  })

  it("an insert whose answer was lost keeps the files (the row may be in), and the sweep keeps them if it is", async () => {
    const d = await device()
    const me = await signIn(d, 'me@example.com', 'mira')
    server.lost.add('insert posts')
    await expect(d.posting.publish({ text: 'two pictures', media: [image(), image()] })).rejects.toMatchObject({ code: 'failed' })
    server.lost.clear()
    const row = server.tables.posts[0]
    expect(row.image_paths).toHaveLength(2)
    expect(files(`${me}/posts/`)).toEqual([...(row.image_paths as string[])].sort())
    expect(server.calls.filter((c) => c.startsWith('remove'))).toEqual([])
    await d.posting.sweepOrphans(Date.now() + 2 * DAY)
    expect(files(`${me}/posts/`)).toHaveLength(2)
  })

  it('an abort removes what went up, and inserts nothing', async () => {
    const d = await device()
    const me = await signIn(d, 'me@example.com', 'mira')
    const stop = new AbortController()
    d.posting.setUploader(async (path, blob, o) => {
      await memoryUploader(path, blob, o)
      stop.abort() // the sheet closes after the still
    })
    await expect(d.posting.publish({ text: '', media: [clip()] }, { signal: stop.signal })).rejects.toMatchObject({ code: 'failed' })
    expect(files(`${me}/`)).toEqual([])
    expect(server.calls.filter((c) => c.startsWith('upload'))).toHaveLength(1)
    expect(server.calls).not.toContain('insert videos')
  })

  it('without room for it and the reserve, nothing goes up', async () => {
    const d = await device()
    await signIn(d, 'me@example.com', 'mira')
    server.quota = 30 * MB
    const big = { ...clip(), blob: new Blob([new Uint8Array(15 * MB)], { type: 'video/mp4' }) }
    await expect(d.posting.publish({ text: '', media: [big] })).rejects.toMatchObject({ code: 'storage-full' })
    expect(server.calls.filter((c) => c.startsWith('upload'))).toEqual([])
    server.quota = 40 * MB
    expect(await d.posting.publish({ text: '', media: [big] })).toBeDefined()
  })

  it('names refused uploads: full when no room is left, too large, else failed', async () => {
    const d = await device()
    await signIn(d, 'me@example.com', 'mira')
    const refuse = (status: number, message: string, after?: () => void): Uploader => async () => {
      after?.()
      throw new d.posting.UploadError(status, message)
    }
    d.posting.setUploader(refuse(400, 'new row violates row-level security policy', () => (server.quota = 0)))
    await expect(d.posting.publish({ text: 'x', media: [image()] })).rejects.toMatchObject({ code: 'storage-full' })
    server.quota = 200 * MB
    d.posting.setUploader(refuse(403, 'new row violates row-level security policy'))
    await expect(d.posting.publish({ text: 'x', media: [image()] })).rejects.toMatchObject({ code: 'failed' })
    d.posting.setUploader(refuse(413, 'Payload too large'))
    await expect(d.posting.publish({ text: 'x', media: [image()] })).rejects.toMatchObject({ code: 'too-large' })
  })

  it('offline, it fails at once without a call', async () => {
    const d = await device()
    await signIn(d, 'me@example.com', 'mira')
    vi.stubGlobal('navigator', { onLine: false })
    server.calls.length = 0
    await expect(d.posting.publish({ text: 'x', media: [] })).rejects.toMatchObject({ code: 'offline' })
    expect(server.calls).toEqual([])
  })
})

describe('delete', () => {
  it('deletes the row, then the files; a refusal brings the post back', async () => {
    const d = await device()
    const me = await signIn(d, 'me@example.com', 'mira')
    const post = (await d.posting.publish({ text: 'mine', media: [image()] }))!
    expect(files(`${me}/posts/`)).toHaveLength(1)

    server.errors.set('delete posts', { message: 'timeout' })
    const refused = d.posting.deletePost(post)
    expect(d.state().lists[me].items).toEqual([])
    expect(await refused).toBe(false)
    expect(d.state().lists[me].items).toEqual([post])
    expect(d.state().hidden.has(`post:${post.id}`)).toBe(false)
    server.errors.clear()

    server.calls.length = 0
    expect(await d.posting.deletePost(post)).toBe(true)
    expect(server.calls).toEqual(['delete posts', `remove ${post.paths[0]}`])
    expect(server.tables.posts).toEqual([])
    expect(files(`${me}/`)).toEqual([])
    expect(d.state().lists[me].items).toEqual([])
  })
})

describe('report', () => {
  it('hides at once; "already reported" stays hidden; a refusal brings it back; the server rebuilds it', async () => {
    const d = await device()
    const me = await signIn(d, 'me@example.com', 'mira')
    addMember(server, 'u-bob', 'bob')
    server.tables.posts.push(postRow('p1', 'u-bob'), postRow('p2', 'u-bob'), postRow('p3', 'u-bob'))
    await d.social.loadPosts('u-bob')
    const ids = () => d.state().lists['u-bob'].items.map((p) => p.id).sort()

    const r = d.social.report('post', 'p1', 'spam')
    expect(ids()).toEqual(['p2', 'p3'])
    expect(d.state().hidden.has('post:p1')).toBe(true)
    expect(await r).toBe(true)
    expect(server.tables.reports).toMatchObject([{ reporter_id: me, kind: 'post', target_id: 'p1', reason: 'spam' }])

    server.tables.reports.push({ id: 'r2', reporter_id: me, kind: 'post', target_id: 'p2', reason: 'abuse', created_at: ago(1), resolved_at: null })
    expect(await d.social.report('post', 'p2', 'spam')).toBe(true) // 23505
    expect(d.state().hidden.has('post:p2')).toBe(true)

    server.errors.set('insert reports', { code: '54000', message: 'reports limit reached' })
    expect(await d.social.report('post', 'p3', 'other')).toBe(false)
    expect(d.state().hidden.has('post:p3')).toBe(false)
    expect(ids()).toEqual(['p3'])
    server.errors.clear()

    const other = await device()
    await signIn(other, 'me@example.com')
    await other.social.loadMine()
    expect([...other.state().hidden].sort()).toEqual(['post:p1', 'post:p2'])
    expect((await other.social.loadPosts('u-bob'))?.items.map((p) => p.id)).toEqual(['p3'])
  })
})

describe('Luma search', () => {
  it('people first, in rank order; removed, banned and hidden items left out', async () => {
    const d = await device()
    const me = await signIn(d, 'me@example.com', 'mira')
    addMember(server, 'u-bob', 'bob')
    addMember(server, 'u-dave', 'dave')
    addMember(server, 'u-carol', 'carol')
    server.tables.posts.push(postRow('p1', 'u-bob'), postRow('p2', 'u-bob'), postRow('p-removed', 'u-bob', { removed_at: ago(1) }),
      postRow('p-banned', 'u-carol'), postRow('p-hidden', 'u-bob'))
    server.tables.videos.push(videoRow('v1', 'u-dave'))
    server.tables.reports.push({ id: 'r', reporter_id: me, kind: 'post', target_id: 'p-hidden', reason: 'spam', created_at: ago(1), resolved_at: null })
    await d.social.loadMine()
    server.tables.profiles.find((r) => r.id === 'u-carol')!.banned = true // banned since the search ran
    const row = (kind: string, id: string, user: string, rank: number) => ({ kind, id, user_id: user, handle: '', title: '', rank })
    server.search = [
      row('post', 'p1', 'u-bob', 0.9), row('profile', 'u-dave', 'u-dave', 0.8), row('video', 'v1', 'u-dave', 0.7),
      row('post', 'p-removed', 'u-bob', 0.6), row('post', 'p-banned', 'u-carol', 0.5), row('post', 'p-hidden', 'u-bob', 0.4),
      row('profile', 'u-carol', 'u-carol', 0.35), row('profile', 'u-bob', 'u-bob', 0.3), row('post', 'p2', 'u-bob', 0.2),
    ]
    const hits = await d.social.lumaSearch('anything')
    expect(hits?.map((h) => (h.kind === 'person' ? `@${h.person.handle}` : `${h.post.kind}:${h.post.id}`))).toEqual(['@dave', '@bob', 'post:p1', 'video:v1', 'post:p2'])

    const stop = new AbortController()
    stop.abort()
    expect(await d.social.lumaSearch('anything', stop.signal)).toBeNull()
  })

  it('finds posts by their song', async () => {
    const d = await device()
    await signIn(d, 'me@example.com', 'mira')
    addMember(server, 'u-bob', 'bob')
    server.tables.posts.push(postRow('p1', 'u-bob', { body: 'tonight', track_title: 'Neverland Synth' }))
    const hits = await d.social.lumaSearch('neverla')
    expect(hits).toMatchObject([{ kind: 'post', post: { id: 'p1', song: { title: 'Neverland Synth' } } }])
  })
})

describe('moderation', () => {
  async function admin() {
    const d = await device()
    const me = await signIn(d, 'admin@example.com', 'boss')
    await makeAdmin(d, me)
    addMember(server, 'u-bob', 'bob', { avatar_path: 'u-bob/profile/avatar-1.jpg', avatar_kind: 'image' })
    addMember(server, 'u-carol', 'carol')
    return { d, me }
  }
  const put = (path: string) => {
    server.files.set(path, new Blob(['x']))
    server.fileTimes.set(path, Date.now())
  }

  it('removes the files before the row; a file failure stops it there', async () => {
    const { d } = await admin()
    server.tables.posts.push(postRow('p1', 'u-bob', { image_paths: ['u-bob/posts/a.jpg', 'u-bob/posts/b.jpg'] }))
    put('u-bob/posts/a.jpg')
    put('u-bob/posts/b.jpg')
    server.tables.reports.push({ id: 'r1', reporter_id: 'u-carol', kind: 'post', target_id: 'p1', reason: 'spam', created_at: ago(1), resolved_at: null })
    const post = (await d.social.loadPosts('u-bob'))!.items[0]

    server.errors.set('remove', { message: 'storage down' })
    expect(await d.moderation.removeContent(post)).toBe(false)
    expect(server.calls).not.toContain('rpc admin_remove')
    server.errors.clear()

    server.calls.length = 0
    expect(await d.moderation.removeContent(post)).toBe(true)
    expect(server.calls).toEqual(['remove u-bob/posts/a.jpg u-bob/posts/b.jpg', 'rpc admin_remove'])
    expect(files('u-bob/')).toEqual([])
    expect(server.tables.posts[0].removed_at).not.toBeNull()
    expect(server.tables.reports[0].resolved_at).not.toBeNull()
    expect(d.state().lists['u-bob'].items).toEqual([])
  })

  it('a ban calls admin_ban, then admin_purge, then empties all three folders', async () => {
    const { d } = await admin()
    put('u-bob/profile/avatar-1.jpg')
    put('u-bob/videos/v.mp4')
    for (let i = 0; i < 250; i++) put(`u-bob/posts/p-${i}.jpg`)
    put('u-carol/posts/keep.jpg')
    server.tables.posts.push(postRow('p1', 'u-bob'))
    server.calls.length = 0
    expect(await d.moderation.ban('u-bob')).toBe(true)
    const steps = server.calls.map((c) => c.split(' ').slice(0, 2).join(' '))
    expect(steps.slice(0, 3)).toEqual(['rpc admin_ban', 'rpc admin_purge', 'list u-bob/profile'])
    expect(steps.indexOf('list u-bob/profile')).toBeLessThan(steps.indexOf('list u-bob/videos'))
    expect(steps.indexOf('list u-bob/videos')).toBeLessThan(steps.indexOf('list u-bob/posts'))
    expect(steps.filter((s) => s.startsWith('remove u-bob/posts'))).toHaveLength(3) // 100 at a time
    expect(files('u-bob/')).toEqual([])
    expect(files('u-carol/')).toEqual(['u-carol/posts/keep.jpg'])
    expect(server.tables.profiles.find((r) => r.id === 'u-bob')).toMatchObject({ banned: true, name: '', avatar_path: null })
    expect(server.tables.posts[0].removed_at).not.toBeNull()
  })

  it('groups open reports by target, newest first, with their reasons; dismiss and invites', async () => {
    const { d } = await admin()
    server.tables.posts.push(postRow('p1', 'u-bob', { image_paths: ['u-bob/posts/a.jpg'] }))
    const reported = (id: string, kind: string, target: string, reason: string, at: number) =>
      server.tables.reports.push({ id, reporter_id: `r-${id}`, kind, target_id: target, reason, created_at: ago(at), resolved_at: null })
    reported('1', 'post', 'p1', 'abuse', 5000)
    reported('2', 'post', 'p1', 'spam', 4000)
    reported('3', 'profile', 'u-bob', 'other', 3000)
    reported('4', 'post', 'p1', 'spam', 2000)
    reported('5', 'post', 'p-deleted', 'not a reason', 1000)
    expect(await d.moderation.hasOpenReports()).toBe(true)
    const groups = await d.moderation.loadReports()
    expect(groups?.map((g) => [g.key, g.reasons])).toEqual([['post:p-deleted', ['other']], ['post:p1', ['spam', 'abuse']], ['profile:u-bob', ['other']]])
    expect(groups?.[1]).toMatchObject({ post: { id: 'p1' }, person: { handle: 'bob' } })
    expect(groups?.[2].person?.avatar).toContain('u-bob/profile/avatar-1.jpg')

    for (const g of groups!) expect(await d.moderation.dismiss(g.kind, g.targetId)).toBe(true)
    expect(await d.moderation.hasOpenReports()).toBe(false)
    expect(server.tables.posts[0].removed_at).toBeNull()

    const code = await d.moderation.createInvite()
    expect(code).toMatch(/^[A-Z0-9]{6,32}$/)
    expect(server.invites.has(code!)).toBe(true)
  })

  it('does nothing for members who aren’t admins', async () => {
    const d = await device()
    await signIn(d, 'me@example.com', 'mira')
    addMember(server, 'u-bob', 'bob')
    server.calls.length = 0
    expect(await d.moderation.ban('u-bob')).toBe(false)
    expect(await d.moderation.removeProfile('u-bob')).toBe(false)
    expect(await d.moderation.removeFolder('u-bob', 'posts')).toBe(false)
    expect(await d.moderation.hasOpenReports()).toBe(false)
    expect(await d.moderation.createInvite()).toBeNull()
    expect(server.calls).toEqual([])
  })
})

describe('orphan sweep', () => {
  it('removes only unreferenced files over a day old, at most once a day', async () => {
    const d = await device()
    const me = await signIn(d, 'me@example.com', 'mira')
    const put = (name: string, age: number) => {
      server.files.set(`${me}/${name}`, new Blob(['x']))
      server.fileTimes.set(`${me}/${name}`, Date.now() - age)
    }
    server.tables.videos.push(videoRow('v1', me))
    server.tables.posts.push(postRow('p1', me, { image_paths: [`${me}/posts/kept-0.jpg`], removed_at: ago(1) }))
    put('videos/v1.mp4', 2 * DAY)
    put('videos/v1-still.jpg', 2 * DAY)
    put('videos/orphan.mp4', 2 * DAY)
    put('posts/kept-0.jpg', 2 * DAY)
    put('posts/old-0.jpg', 2 * DAY)
    put('posts/new-0.jpg', 2 * HOUR)
    put('profile/avatar-1.jpg', 9 * DAY)

    await d.posting.sweepOrphans()
    expect(files(`${me}/`)).toEqual([`${me}/posts/kept-0.jpg`, `${me}/posts/new-0.jpg`, `${me}/profile/avatar-1.jpg`, `${me}/videos/v1-still.jpg`, `${me}/videos/v1.mp4`])

    put('posts/later.jpg', 2 * HOUR)
    server.calls.length = 0
    await d.posting.sweepOrphans()
    expect(server.calls).toEqual([])
    await d.posting.sweepOrphans(Date.now() + DAY + 1) // a day on: everything unreferenced is old by then
    expect(files(`${me}/posts/`)).toEqual([`${me}/posts/kept-0.jpg`])
  })

  it("leaves another device's post alone while it uploads, even with a clock hours ahead", async () => {
    const phone = await device()
    const me = await signIn(phone, 'me@example.com', 'mira')
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    let stillUp!: () => void
    const firstUp = new Promise<void>((r) => (stillUp = r))
    phone.posting.setUploader(async (path, blob, o) => {
      await memoryUploader(path, blob, o)
      if (path.endsWith('-still.jpg')) {
        stillUp()
        await held // the video itself is still going up
      }
    })
    const publishing = phone.posting.publish({ text: 'clip', media: [clip()] })
    await firstUp

    // The laptop (same account) opens the composer; its clock is 2 hours ahead of the server's.
    const laptop = await device()
    expect(await signIn(laptop, 'me@example.com')).toBe(me)
    await laptop.posting.sweepOrphans(Date.now() + 2 * HOUR)

    release()
    const post = await publishing
    const still = server.tables.videos[0].still_path as string
    expect(post?.paths).toContain(still)
    expect(server.files.has(still)).toBe(true)
  })
})

describe('accounts', () => {
  it("a row that failed to load at start is asked for again (a profile page waits for it), joining a load under way", async () => {
    const d = await device()
    await signIn(d, 'me@example.com', 'mira')
    d.account.useAccount.setState({ row: undefined }) // the next start: the session is back, the row not yet
    server.errors.set('select profiles', { message: 'TypeError: Failed to fetch' })
    await d.account.refreshRow()
    expect(d.account.useAccount.getState()).toMatchObject({ ready: true, row: undefined }) // nothing asks again by itself
    expect(d.social.currentMe()).toBeUndefined()

    server.calls.length = 0
    await d.account.ensureRow() // still failing: it settles, the row still unknown
    expect(d.account.useAccount.getState().row).toBeUndefined()
    expect(server.calls).toEqual(['select profiles'])

    // A load under way (the start's own) that fails: it waits for it, then asks once more.
    server.calls.length = 0
    const failing = d.account.refreshRow()
    const ensured = d.account.ensureRow()
    await failing
    server.errors.clear()
    await ensured
    expect(server.calls).toEqual(['select profiles', 'select profiles'])
    expect(d.social.currentMe()).toMatchObject({ handle: 'mira' })

    // One that brings it: nothing more. Known: no call at all.
    d.account.useAccount.setState({ row: undefined })
    server.calls.length = 0
    const loading = d.account.refreshRow()
    await d.account.ensureRow()
    await loading
    expect(server.calls).toEqual(['select profiles'])
    await d.account.ensureRow()
    expect(server.calls).toEqual(['select profiles'])
  })

  it('a sign-out resets every social store, with no network call; late answers are dropped', async () => {
    const d = await device()
    const me = await signIn(d, 'me@example.com', 'mira')
    addMember(server, 'u-bob', 'bob', { share_activity: true })
    server.tables.posts.push(postRow('p1', 'u-bob'))
    await d.social.follow('u-bob')
    await d.social.report('profile', 'u-bob', 'spam')
    await d.social.loadFeed()
    await d.social.loadPosts(me)
    await d.social.loadPeople(['u-bob'])
    expect(d.state().following).toEqual(['u-bob'])

    server.calls.length = 0
    const late = d.social.loadPosts('u-bob')
    await d.account.signOut()
    await late
    expect(d.state()).toEqual({ following: undefined, hidden: new Set(), people: {}, feed: undefined, lists: {} })
    expect(server.calls).toEqual(['select videos', 'select posts']) // the late load's own, nothing from the sign-out
  })

  it('signed out, nothing social loads supabase-js', async () => {
    const d = await device({ connect: false })
    loads.n = 0
    expect(await d.social.lumaSearch('synthwave')).toBeNull()
    expect(await d.social.loadFeed()).toBeNull()
    expect(await d.social.loadMine()).toBe(false)
    expect(await d.social.loadListening('u-bob')).toBeNull()
    expect(await d.social.follow('u-bob')).toBe(false)
    expect(await d.social.unfollow('u-bob')).toBe(false)
    expect(await d.social.report('post', 'p1', 'spam')).toBe(false)
    expect(await d.social.loadPeople([])).toEqual({})
    await expect(d.posting.publish({ text: 'hi', media: [] })).rejects.toMatchObject({ code: 'failed' })
    expect(await d.posting.deletePost({ kind: 'post', id: 'p', userId: 'u', text: '', createdAt: '', images: [], paths: [] })).toBe(false)
    await d.posting.sweepOrphans()
    expect(await d.moderation.hasOpenReports()).toBe(false)
    expect(await d.moderation.loadReports()).toBeNull()
    expect(loads.n).toBe(0)
    // The check itself works: asking for the client does load it.
    await (await import('../../src/lib/supabase.ts')).supabase()
    expect(loads.n).toBe(1)
  })

  it('banned and handle-less accounts are not members here', async () => {
    const d = await device()
    const me = await signIn(d, 'me@example.com', 'mira')
    expect(d.social.currentMe()).toEqual({ id: me, handle: 'mira', admin: false })
    server.tables.profiles.find((r) => r.id === me)!.banned = true
    await d.account.refreshRow()
    expect(d.social.currentMe()).toBeUndefined()
    server.calls.length = 0
    expect(await d.social.loadFeed()).toBeNull()
    expect(server.calls).toEqual([])
  })
})

describe('viewer', () => {
  it('plays only a video with a picture, within the 60 s cap (no song audio from the server)', async () => {
    const d = await device()
    const clip = { videoWidth: 1080, videoHeight: 1920, duration: 59.9 }
    expect(d.viewer.playable(clip)).toBe(true)
    expect(d.viewer.playable({ ...clip, duration: 60.25 })).toBe(true)
    expect(d.viewer.playable({ ...clip, currentTime: 30 })).toBe(true)
    expect(d.viewer.playable({ ...clip, videoWidth: 0, videoHeight: 0 })).toBe(false) // a song in an MP4
    expect(d.viewer.playable({ ...clip, duration: 240 })).toBe(false)
    expect(d.viewer.playable({ ...clip, duration: Infinity })).toBe(false)
    expect(d.viewer.playable({ ...clip, duration: NaN })).toBe(false)
    expect(d.viewer.playable({ ...clip, currentTime: 61 })).toBe(false) // its header said less
  })

  it('closing resumes the music only when unmuting paused it', async () => {
    const d = await device()
    const post = { kind: 'post' as const, id: 'p', userId: 'u', text: 'hi', createdAt: '', images: [], paths: [] }
    d.viewer.openPost(post)
    d.viewer.closePost()
    expect(player.audio.paused).toBe(false)

    d.viewer.openPost(post)
    d.viewer.pauseForSound()
    expect(player.audio.paused).toBe(true)
    expect(d.viewer.useViewer.getState().paused).toBe(true)
    d.viewer.closePost()
    expect(player.audio.paused).toBe(false)
    expect(d.viewer.useViewer.getState()).toMatchObject({ post: undefined, paused: false })

    player.audio.paused = true // nothing playing: unmuting leaves it be, and closing doesn't start it
    d.viewer.openPost(post)
    d.viewer.pauseForSound()
    d.viewer.closePost()
    expect(player.audio.paused).toBe(true)
  })
})
