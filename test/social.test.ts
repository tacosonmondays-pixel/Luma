// The social screens' pure parts: rows read as anyone's JSON, friends' plays as songs, and paging over two tables.
import { describe, expect, it } from 'vitest'
import { friendsListening, mergePosts, personOf, postOf, takePage, type Person, type Post } from '../src/lib/social.ts'
import type { PlayRow } from '../src/types.ts'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const url = (path: string) => `https://kbdevcrqrjnqxsfeszbe.supabase.co/storage/v1/object/public/media/${path}`

describe('personOf', () => {
  const row = (extra: Record<string, unknown>) => ({ id: A, handle: 'alice', name: 'Alice', admin: false, banned: false, ...extra })

  it('reads a person, and leaves out what is not well-formed', () => {
    expect(personOf(row({ name_style: 'neon', colors: ['#ff0000', '#00ff00'], auto_colors: ['red', '#fff'], crops: { avatar: { x: 0.5, y: 0.2, zoom: 2 } } }))).toEqual({
      id: A, handle: 'alice', name: 'Alice', avatar: undefined, crop: { x: 0.5, y: 0.2, zoom: 2 }, nameStyle: 'neon',
      colors: ['#ff0000', '#00ff00'], autoColors: undefined, admin: false, banned: false,
    })
    expect(personOf(row({ name: 'x'.repeat(80), name_style: 'boom', crops: 'x', admin: 'yes', banned: 1 }))).toMatchObject({
      name: 'x'.repeat(40), nameStyle: undefined, crop: undefined, admin: false, banned: false,
    })
  })

  it('rejects bad handles', () => {
    for (const handle of [null, '', 'Al', 'ALICE', 'a-b-c', 'x'.repeat(21), '../x', 5]) expect(personOf(row({ handle }))).toBeUndefined()
    expect(personOf(null)).toBeUndefined()
    expect(personOf({ handle: 'alice' })).toBeUndefined()
  })

  it('shows the still of an animated avatar, and only their own profile files', () => {
    const own = `${A}/profile/avatar-1.jpg`
    expect(personOf(row({ avatar_kind: 'image', avatar_path: own }))?.avatar).toBe(url(own))
    expect(personOf(row({ avatar_kind: 'animated', avatar_path: `${A}/profile/avatar-2.gif`, avatar_still_path: own }))?.avatar).toBe(url(own))
    expect(personOf(row({ avatar_kind: 'animated', avatar_path: own, avatar_still_path: null }))?.avatar).toBeUndefined()
    for (const path of [`${B}/profile/a.jpg`, `${A}/profile/../../${B}/profile/a.jpg`, `${A}/profile/x/a.jpg`, `${A}/posts/a.jpg`, `${A}/profile/..a.jpg`])
      expect(personOf(row({ avatar_kind: 'image', avatar_path: path }))?.avatar).toBeUndefined()
  })
})

describe('postOf', () => {
  const at = '2026-11-02T10:00:00.123456+00:00'
  const post = (extra: Record<string, unknown>) => ({ id: 'p1', user_id: A, body: 'hello', image_paths: [], created_at: at, ...extra })
  const video = (extra: Record<string, unknown>) => ({ id: 'v1', user_id: A, path: `${A}/videos/v.mp4`, still_path: `${A}/videos/v-still.jpg`, caption: 'hi', duration: 12.5, created_at: at, ...extra })

  it('reads a post with images and a song', () => {
    const images = [`${A}/posts/x-0.jpg`, `${A}/posts/x-1.jpg`]
    expect(postOf('post', post({ image_paths: images, youtube_id: 'dQw4w9WgXcQ', track_title: 'Song', track_artist: 'Artist' }))).toEqual({
      kind: 'post', id: 'p1', userId: A, text: 'hello', createdAt: at, images: images.map(url), paths: images,
      song: { youtubeId: 'dQw4w9WgXcQ', title: 'Song', artist: 'Artist' },
    })
  })

  it('reads a video with its still', () => {
    expect(postOf('video', video({}))).toEqual({
      kind: 'video', id: 'v1', userId: A, text: 'hi', createdAt: at, images: [], song: undefined,
      video: { url: url(`${A}/videos/v.mp4`), still: url(`${A}/videos/v-still.jpg`), duration: 12.5 },
      paths: [`${A}/videos/v.mp4`, `${A}/videos/v-still.jpg`],
    })
  })

  it("keeps only paths in the author's own folder, one level deep", () => {
    const bad = [`${B}/posts/a.jpg`, `${A}/videos/a.jpg`, `${A}/posts/x/a.jpg`, `${A}/posts/../../${B}/posts/a.jpg`, `${A}/posts/`, null, 5]
    expect(postOf('post', post({ image_paths: [...bad, `${A}/posts/ok.jpg`] }))?.paths).toEqual([`${A}/posts/ok.jpg`])
    for (const path of [`${B}/videos/v.mp4`, `${A}/posts/v.mp4`, `${A}/videos/x/v.mp4`, `${A}/videos/../v.mp4`, null])
      expect(postOf('video', video({ path }))).toBeUndefined()
    expect(postOf('video', video({ still_path: `${B}/videos/s.jpg` }))?.video?.still).toBeUndefined()
  })

  it('keeps at most 4 images, drops empty posts and bad YouTube ids', () => {
    const six = Array.from({ length: 6 }, (_, i) => `${A}/posts/i-${i}.jpg`)
    expect(postOf('post', post({ image_paths: six }))?.images).toHaveLength(4)
    expect(postOf('post', post({ body: '', image_paths: [] }))).toBeUndefined()
    expect(postOf('post', post({ body: '  ', image_paths: [`${B}/posts/a.jpg`] }))).toBeUndefined()
    expect(postOf('post', post({ youtube_id: 'not-an-id', track_title: 'Song' }))?.song).toEqual({ youtubeId: undefined, title: 'Song', artist: '' })
    expect(postOf('post', post({ youtube_id: 'dQw4w9WgXcQ', track_title: '' }))?.song).toBeUndefined()
    expect(postOf('post', post({ body: 'x'.repeat(2000) }))?.text).toHaveLength(1000)
    expect(postOf('video', video({ caption: 'x'.repeat(2000), duration: 'long' }))).toMatchObject({ text: 'x'.repeat(300), video: { duration: 0 } })
    expect(postOf('post', { ...post({}), id: undefined })).toBeUndefined()
  })
})

describe('friendsListening', () => {
  let t = 0
  const play = (user: string, title: string, artist = 'Artist', youtube: string | null = null, at = ++t): PlayRow => ({
    user_id: user, track_id: title, youtube_id: youtube, title, artist, played_at: new Date(Date.UTC(2026, 10, 1, 0, at)).toISOString(),
  })

  it('one tile per song, by YouTube id, else by title and artist; the newest play first', () => {
    const rows = [
      play('u1', 'One', 'X', 'aaaaaaaaaaa'),
      play('u2', 'One (Live)', 'X', 'aaaaaaaaaaa'),
      play('u3', 'Imported', 'Band'),
      play('u4', 'IMPORTED', 'band'),
      play('u1', 'Two', 'X', 'bbbbbbbbbbb'),
    ]
    const songs = friendsListening(rows.reverse())
    expect(songs.map((s) => s.key)).toEqual(['bbbbbbbbbbb', 'imported|band', 'aaaaaaaaaaa'])
    expect(songs[1]).toEqual({ key: 'imported|band', song: { youtubeId: undefined, title: 'IMPORTED', artist: 'band' }, userIds: ['u4', 'u3'] })
    expect(songs[2]).toMatchObject({ song: { title: 'One (Live)' }, userIds: ['u2', 'u1'] })
  })

  it('up to 3 faces each, newest first, and up to 20 songs', () => {
    const rows = ['u1', 'u2', 'u1', 'u3', 'u4', 'u5'].map((u) => play(u, 'Same', 'X', 'ccccccccccc'))
    expect(friendsListening(rows)[0].userIds).toEqual(['u5', 'u4', 'u3'])
    const many = Array.from({ length: 30 }, (_, i) => play(`u${i % 2}`, `Song ${i}`))
    const top = friendsListening(many)
    expect(top).toHaveLength(20)
    expect(top[0].song.title).toBe('Song 29')
    expect(friendsListening(many, 5)).toHaveLength(5)
  })

  it('skips plays without a title', () => {
    expect(friendsListening([play('u1', ''), { ...play('u1', 'x'), title: 5 as never }])).toEqual([])
  })
})

const item = (id: string, minute: number, userId = A, kind: Post['kind'] = 'post'): Post => ({
  kind, id, userId, text: id, createdAt: new Date(Date.UTC(2026, 10, 1, 0, minute)).toISOString(), images: [], paths: [],
})
const person = (id: string, banned = false): Person => ({ id, handle: id === A ? 'alice' : 'bob', name: '', admin: false, banned })

describe('mergePosts', () => {
  it('newest first, without hidden posts or unknown and banned authors', () => {
    const videos = [item('v1', 5, A, 'video'), item('v2', 1, B, 'video')]
    const posts = [item('p1', 4), item('p2', 3), item('p3', 2, 'nobody'), item('p4', 6)]
    const people = { [A]: person(A), [B]: person(B) }
    expect(mergePosts(videos, posts, 30, { hidden: new Set(['post:p4']), people }).map((p) => p.id)).toEqual(['v1', 'p1', 'p2', 'v2'])
    expect(mergePosts(videos, posts, 2, { hidden: new Set(), people }).map((p) => p.id)).toEqual(['p4', 'v1'])
    expect(mergePosts(videos, posts, 30, { hidden: new Set(), people: { ...people, [B]: person(B, true) } }).map((p) => p.id)).toEqual(['p4', 'v1', 'p1', 'p2'])
    // The same id in both tables is two posts.
    expect(mergePosts([item('x', 1, A, 'video')], [item('x', 2)], 30, { hidden: new Set(['video:x']), people }).map((p) => p.kind)).toEqual(['post'])
  })
})

describe('takePage', () => {
  /** A table answering `created_at < cursor order by created_at desc limit n`. */
  const table = (rows: Post[]) => (cursor: string | undefined, n: number) =>
    rows.filter((r) => !cursor || r.createdAt < cursor).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, n)

  it('pages through two uneven tables with no gaps and no repeats', () => {
    const n = 4
    for (const [nv, np] of [[0, 9], [9, 0], [3, 11], [10, 10], [1, 1], [4, 4], [0, 0]]) {
      const minutes = [...Array(nv + np).keys()]
      for (let i = minutes.length - 1, seed = nv * 31 + np; i > 0; i--) {
        seed = (seed * 1103515245 + 12345) % 2147483648 // a fixed shuffle, so the tables interleave unevenly
        const j = seed % (i + 1)
        ;[minutes[i], minutes[j]] = [minutes[j], minutes[i]]
      }
      const videos = minutes.slice(0, nv).map((m) => item(`v${m}`, m, A, 'video'))
      const posts = minutes.slice(nv).map((m) => item(`p${m}`, m))
      const v = table(videos)
      const p = table(posts)
      const seen: string[] = []
      let cursor: string | undefined
      for (let pages = 0; pages < 20; pages++) {
        const page = takePage(v(cursor, n), p(cursor, n), n)
        seen.push(...page.items.map((x) => x.id))
        if (page.done) break
        expect(page.items).toHaveLength(n)
        cursor = page.cursor
      }
      expect(seen).toEqual([...videos, ...posts].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((x) => x.id))
    }
  })

  it('is done only when neither table had more', () => {
    expect(takePage([item('a', 3), item('b', 2)], [item('c', 1)], 3)).toMatchObject({ done: true })
    expect(takePage([item('a', 3), item('b', 2), item('c', 1)], [], 3)).toMatchObject({ done: false, cursor: item('c', 1).createdAt })
    expect(takePage([item('a', 3)], [item('b', 2), item('c', 1)], 2)).toMatchObject({ done: false, cursor: item('b', 2).createdAt })
    expect(takePage([], [], 3)).toEqual({ items: [], cursor: undefined, done: true })
  })
})
