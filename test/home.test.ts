import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Play, Playlist, SearchResult, Track } from '../src/types.ts'

vi.mock('../src/lib/player.ts', () => ({ audio: {}, usePlayer: { getState: () => ({}), subscribe: () => () => {} } }))
vi.mock('../src/lib/library.ts', () => ({ useLibrary: Object.assign(() => undefined, { getState: () => ({}) }), useReady: () => true }))

// An in-memory localStorage, so the store persists as in the browser.
// zustand's persist reads window.localStorage.
const storage = new Map<string, string>()
vi.stubGlobal('window', {
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  },
})
storage.set('luma-home', JSON.stringify({ state: { order: ['saved', 'nope'], hidden: ['mix'], custom: [], played: [{ id: 'p', at: 1 }, { bad: 1 }] }, version: 0 }))

const home = await import('../src/lib/home.ts')
const shelves = await import('../src/lib/shelves.ts')
const { BUILTIN, defaultLayout, moved, normalize, visibleShelves, withCustom, withoutCustom, withPlayed, withVisible } = home
const { byArtists, continueItem, jumpBackIn, mainArtist, mixSeed, playlistOf, quickPicks, recentlySaved, topArtists } = shelves

const H = 3600_000
const DAY = 24 * H
const NOW = 1_800_000_000_000

const track = (id: string, artist = 'Someone', more: Partial<Track> = {}): Track => ({
  id,
  title: id,
  artist,
  duration: 200,
  source: 'youtube',
  addedAt: 0,
  ...more,
})
const lib = (...list: Track[]) => Object.fromEntries(list.map((t) => [t.id, t]))
const playlist = (id: string, trackIds: string[]): Playlist => ({ id, name: id, trackIds, createdAt: 0 })
/** `n` plays of `id`, an hour apart, the newest `ago` ms before NOW. */
const plays = (id: string, n: number, ago = H): Play[] => Array.from({ length: n }, (_, i) => [id, NOW - ago - i * H, 60_000] as Play)

// ── Layout ───────────────────────────────────────────────────────────────

describe('home layout', () => {
  it('starts with every built-in shelf, in the default order, all showing', () => {
    expect(defaultLayout()).toEqual({ order: BUILTIN, hidden: [], custom: [] })
    expect(BUILTIN).toEqual(['continue', 'quick', 'jump', 'repeat', 'mix', 'artists', 'friends', 'friends-new', 'saved', 'playlists'])
    expect(home.BUILTIN_TITLES.friends).toBe('Friends Are Listening To')
    expect(home.BUILTIN_TITLES['friends-new']).toBe('New from Friends')
    expect(visibleShelves(defaultLayout())).toEqual(BUILTIN)
  })

  it('moves a shelf down and up', () => {
    let l = moved(defaultLayout(), 0, 3)
    expect(l.order.slice(0, 4)).toEqual(['quick', 'jump', 'repeat', 'continue'])
    l = moved(l, 8, 0)
    expect(l.order).toEqual(['saved', 'quick', 'jump', 'repeat', 'continue', 'mix', 'artists', 'friends', 'friends-new', 'playlists'])
    expect(moved(l, 2, 2)).toBe(l)
    expect(moved(l, 99, 0)).toBe(l)
    expect(moved(l, 0, 99).order.at(-1)).toBe('saved')
  })

  it('hides and shows shelves, keeping their place', () => {
    let l = withVisible(defaultLayout(), 'mix', false)
    l = withVisible(l, 'quick', false)
    expect(l.hidden).toEqual(['mix', 'quick'])
    expect(visibleShelves(l)).toEqual(['continue', 'jump', 'repeat', 'artists', 'friends', 'friends-new', 'saved', 'playlists'])
    expect(withVisible(l, 'mix', false)).toBe(l)
    expect(withVisible(l, 'nope', false)).toBe(l)
    l = withVisible(l, 'mix', true)
    expect(visibleShelves(l)).toEqual(['continue', 'jump', 'repeat', 'mix', 'artists', 'friends', 'friends-new', 'saved', 'playlists'])
  })

  it('adds custom search shelves at the end, trimmed, and deletes them', () => {
    let l = withCustom(defaultLayout(), '  phonk  ', 'popular', 'c-1')
    l = withCustom(l, 'lofi', 'recent', 'c-2')
    expect(l.custom).toEqual([
      { id: 'c-1', query: 'phonk', sort: 'popular' },
      { id: 'c-2', query: 'lofi', sort: 'recent' },
    ])
    expect(l.order.slice(-2)).toEqual(['c-1', 'c-2'])
    expect(withCustom(l, '   ', 'recent')).toBe(l)
    expect(withCustom(l, 'x'.repeat(300), 'recent', 'c-3').custom[2].query).toHaveLength(home.MAX_QUERY)

    l = withVisible(l, 'c-1', false)
    l = withoutCustom(l, 'c-1')
    expect(l.custom.map((c) => c.id)).toEqual(['c-2'])
    expect(l.order).toEqual([...BUILTIN, 'c-2'])
    expect(l.hidden).toEqual([])
    expect(withoutCustom(l, 'mix')).toBe(l) // built-in shelves can only be hidden
  })

  it('gives each new custom shelf its own id', () => {
    const l = withCustom(withCustom(defaultLayout(), 'a', 'relevance'), 'b', 'relevance')
    expect(l.custom[0].id).toMatch(/^c-/)
    expect(l.custom[0].id).not.toBe(l.custom[1].id)
  })

  it('repairs stored layouts: unknown and repeated ids go, missing shelves come back in their place', () => {
    const l = normalize({
      order: ['saved', 'nope', 'continue', 'saved', 'c-1', 'mix'],
      hidden: ['mix', 'gone', 'mix', 'c-9'],
      custom: [
        { id: 'c-1', query: 'phonk', sort: 'popular' },
        { id: 'c-2', query: 'lofi', sort: 'recent' },
        { id: 'c-1', query: 'again', sort: 'recent' },
        { id: 'c-3', query: '  ', sort: 'recent' },
        { id: 'x-4', query: 'bad id', sort: 'recent' },
        { id: 'c-5', query: 'bad sort', sort: 'newest' as never },
      ],
    })
    // Playlists comes back after Saved, the shelf before it in the default order.
    expect(l.order).toEqual(['saved', 'playlists', 'continue', 'quick', 'jump', 'repeat', 'c-1', 'mix', 'artists', 'friends', 'friends-new', 'c-2'])
    expect(l.hidden).toEqual(['mix'])
    expect(l.custom.map((c) => c.id)).toEqual(['c-1', 'c-2'])
    expect(normalize(undefined)).toEqual(defaultLayout())
    expect(normalize({ order: 'junk' as never, hidden: null as never, custom: {} as never })).toEqual(defaultLayout())
  })

  it('slots the social shelves in right after New from Your Artists in a layout from before them', () => {
    const before = ['playlists', 'artists', 'continue', 'c-1', 'quick', 'jump', 'repeat', 'mix', 'saved']
    const l = normalize({ order: before, hidden: ['artists'], custom: [{ id: 'c-1', query: 'phonk', sort: 'popular' }] })
    expect(l.order).toEqual(['playlists', 'artists', 'friends', 'friends-new', 'continue', 'c-1', 'quick', 'jump', 'repeat', 'mix', 'saved'])
    expect(l.hidden).toEqual(['artists'])
  })

  it('notes playlist listens, merging a quick restart of the same playlist', () => {
    let p = withPlayed([], 'a', 0)
    p = withPlayed(p, 'a', 10 * 60_000)
    expect(p).toEqual([{ id: 'a', at: 10 * 60_000 }])
    p = withPlayed(p, 'b', 11 * 60_000)
    p = withPlayed(p, 'a', 12 * 60_000)
    expect(p.map((x) => x.id)).toEqual(['a', 'b', 'a'])
    for (let i = 0; i < 100; i++) p = withPlayed(p, `p${i}`, i)
    expect(p).toHaveLength(60)
    expect(p.at(-1)!.id).toBe('p99')
  })
})

describe('home store, as stored', () => {
  it('loads a stored layout under luma-home, repairing it', () => {
    const s = home.useHome.getState()
    expect(s.order).toEqual(['continue', 'quick', 'jump', 'repeat', 'mix', 'artists', 'friends', 'friends-new', 'saved', 'playlists'])
    expect(s.hidden).toEqual(['mix'])
    expect(s.played).toEqual([{ id: 'p', at: 1 }])
  })
})

describe('home store', () => {
  beforeEach(() => home.useHome.setState({ ...defaultLayout(), played: [] }))

  it('applies the actions to the persisted state', () => {
    home.moveShelf(0, 1)
    home.setShelfVisible('jump', false)
    home.addCustomShelf('phonk', 'popular')
    const s = home.useHome.getState()
    expect(s.order.slice(0, 2)).toEqual(['quick', 'continue'])
    expect(s.hidden).toEqual(['jump'])
    expect(s.custom).toEqual([{ id: expect.stringMatching(/^c-/), query: 'phonk', sort: 'popular' }])
    home.deleteCustomShelf(s.custom[0].id)
    expect(home.useHome.getState().custom).toEqual([])
    home.notePlaylistPlayed('p', 5)
    expect(home.useHome.getState().played).toEqual([{ id: 'p', at: 5 }])
  })

  it('persists under luma-home', () => {
    home.setShelfVisible('saved', false)
    expect(JSON.parse(storage.get('luma-home')!).state.hidden).toEqual(['saved'])
  })
})

// ── Shelves ──────────────────────────────────────────────────────────────

describe('playlistOf', () => {
  const tracks = lib(track('a'), track('b'), track('c', 'x', { missing: true }))
  const lists = [playlist('p1', ['a', 'c', 'b']), playlist('p2', ['b'])]

  it('finds the playlist a queue was started from, with or without its missing songs', () => {
    expect(playlistOf(['a', 'c', 'b'], lists, tracks)?.id).toBe('p1')
    expect(playlistOf(['a', 'b'], lists, tracks)?.id).toBe('p1') // TrackList plays only downloaded songs
    expect(playlistOf(['b'], lists, tracks)?.id).toBe('p2')
    expect(playlistOf(['b', 'a'], lists, tracks)).toBeUndefined()
    expect(playlistOf([], [playlist('e', [])], tracks)).toBeUndefined()
  })
})

describe('continueItem', () => {
  const tracks = lib(track('a'), track('b'), track('m', 'x', { missing: true }))
  const lists = [playlist('p', ['a', 'b'])]

  it("is the queue's playlist, even shuffled", () => {
    expect(continueItem({ ids: ['a', 'b'], index: 1, original: null }, lists, tracks, [])).toEqual({ kind: 'playlist', id: 'p' })
    expect(continueItem({ ids: ['b', 'a'], index: 0, original: ['a', 'b'] }, lists, tracks, [])).toEqual({ kind: 'playlist', id: 'p' })
  })

  it("is the queue's song otherwise, else the last song played", () => {
    expect(continueItem({ ids: ['b'], index: 0, original: null }, lists, tracks, [])).toEqual({ kind: 'song', id: 'b' })
    const log: Play[] = [['b', 1, 1], ['a', 2, 1], ['m', 3, 1], ['gone', 4, 1]]
    expect(continueItem({ ids: [], index: -1, original: null }, lists, tracks, log)).toEqual({ kind: 'song', id: 'a' })
    expect(continueItem({ ids: [], index: -1, original: null }, lists, tracks, [])).toBeUndefined()
  })
})

describe('quickPicks', () => {
  const songs = ['s1', 's2', 's3', 's4', 's5', 's6', 's7']
  const tracks = lib(...songs.map((id) => track(id)), track('gone', 'x', { missing: true }))
  const lists = [playlist('p1', ['s1']), playlist('p2', ['s2']), playlist('empty', [])]

  it('takes turns between the most played playlists and songs, up to 8', () => {
    const log = songs.flatMap((id, i) => plays(id, 10 - i))
    const played = [
      { id: 'p2', at: NOW - DAY },
      { id: 'p1', at: NOW - 2 * DAY },
      { id: 'p2', at: NOW - 3 * DAY },
      { id: 'empty', at: NOW - DAY },
      { id: 'deleted', at: NOW - DAY },
    ]
    const picks = quickPicks(log, played, tracks, lists, NOW)
    expect(picks.map((p) => p.id)).toEqual(['p2', 's1', 'p1', 's2', 's3', 's4', 's5', 's6'])
    expect(picks[0].kind).toBe('playlist')
    expect(picks[1].kind).toBe('song')
  })

  it('counts only the last 90 days, skips songs without audio, and keeps an even count', () => {
    const log = [...plays('s1', 3), ...plays('s2', 2), ...plays('s3', 1), ...plays('s4', 5, 100 * DAY), ...plays('gone', 9)]
    expect(quickPicks(log, [], tracks, lists, NOW).map((p) => p.id)).toEqual(['s1', 's2'])
    expect(quickPicks(plays('s1', 4), [], tracks, lists, NOW)).toEqual([])
    expect(quickPicks([], [{ id: 'p1', at: NOW - 200 * DAY }], tracks, lists, NOW)).toEqual([])
  })
})

describe('jumpBackIn', () => {
  const tracks = lib(track('a'), track('b'), track('c'), track('d'), track('m', 'x', { missing: true }))
  const lists = [playlist('p', ['a', 'b'])]

  it('orders songs and playlists by when they were last played, folding playlist songs into the playlist', () => {
    const log: Play[] = [
      ['c', NOW - 10 * H, 1],
      ['a', NOW - 5 * H, 1], // from the playlist started at -5.1h
      ['b', NOW - 4 * H, 1],
      ['d', NOW - 3 * H, 1],
      ['m', NOW - 1 * H, 1],
    ]
    const items = jumpBackIn(log, [{ id: 'p', at: NOW - 5.1 * H }], tracks, lists)
    expect(items).toEqual([
      { kind: 'song', id: 'd' },
      { kind: 'playlist', id: 'p' },
      { kind: 'song', id: 'c' },
    ])
  })

  it('counts a song as itself when its playlist started long before, and leaves out the Continue item', () => {
    const log: Play[] = [['a', NOW - H, 1]]
    const items = jumpBackIn(log, [{ id: 'p', at: NOW - 3 * DAY }], tracks, lists, { kind: 'playlist', id: 'p' })
    expect(items).toEqual([{ kind: 'song', id: 'a' }])
  })

  it('stops at 12', () => {
    const many = lib(...Array.from({ length: 20 }, (_, i) => track(`t${i}`)))
    const log = Array.from({ length: 20 }, (_, i) => [`t${i}`, NOW - i * H, 1] as Play)
    expect(jumpBackIn(log, [], many, [])).toHaveLength(12)
  })
})

describe('artists', () => {
  it('cuts the main artist as written', () => {
    expect(mainArtist('Daft Punk, Pharrell Williams')).toBe('Daft Punk')
    expect(mainArtist('Calvin Harris feat. Rihanna')).toBe('Calvin Harris')
    expect(mainArtist('Simon & Garfunkel')).toBe('Simon')
    expect(mainArtist(' M83 ')).toBe('M83')
  })

  it('ranks artists by plays in the last 90 days', () => {
    const tracks = lib(
      track('a1', 'M83'),
      track('a2', 'M83 feat. Someone'),
      track('b1', 'MGMT'),
      track('c1', 'The xx'),
      track('d1', 'Old Band'),
      track('u1', 'Unknown Artist'),
      track('e1', ''),
    )
    const log = [
      ...plays('a1', 2),
      ...plays('a2', 2, 3 * H),
      ...plays('b1', 3),
      ...plays('c1', 1),
      ...plays('d1', 9, 120 * DAY),
      ...plays('u1', 9),
      ...plays('e1', 9),
    ]
    expect(topArtists(log, tracks, NOW)).toEqual(['M83', 'MGMT', 'The xx'])
    expect(topArtists(log, tracks, NOW, 1)).toEqual(['M83'])
  })

  it("keeps only the artist's own results, taking turns, without repeats", () => {
    const r = (id: string, title: string, channel: string): SearchResult => ({ id, title, channel, duration: 0 })
    const m83 = [r('1', 'Wait', 'M83'), r('2', 'Reaction video', 'Some Guy'), r('3', 'M83 - Oblivion (Live)', 'Fan'), r('9', 'Shared', 'M83')]
    const mgmt = [r('4', 'Kids', 'MGMT Official'), r('9', 'Shared', 'MGMT'), r('5', 'Little Dark Age', 'mgmt')]
    expect(byArtists([m83, mgmt], ['M83', 'MGMT']).map((x) => x.id)).toEqual(['1', '4', '3', '9', '5'])
    expect(byArtists([m83], ['M83'], 1).map((x) => x.id)).toEqual(['1'])
    expect(byArtists([m83], [''])).toEqual([])
  })
})

describe('mixSeed', () => {
  const tracks = lib(track('f1', 'x', { source: 'file' }), track('y1'), track('y2'), track('y3'))

  it('is the top On Repeat song from YouTube', () => {
    expect(mixSeed(['f1', 'y2', 'y1'], [], tracks, NOW)).toBe('y2')
  })

  it('falls back to the most played YouTube song of the month, played at least twice', () => {
    const log = [...plays('f1', 9), ...plays('y1', 2), ...plays('y3', 3), ...plays('y2', 5, 40 * DAY)]
    expect(mixSeed([], log, tracks, NOW)).toBe('y3')
    expect(mixSeed([], plays('y1', 1), tracks, NOW)).toBeUndefined()
  })
})

describe('recentlySaved', () => {
  it('is the newest downloaded songs', () => {
    const tracks = lib(track('a'), track('b', 'x', { missing: true }), track('c'), track('d'))
    expect(recentlySaved(['a', 'b', 'c', 'gone', 'd'], tracks, 2)).toEqual(['a', 'c'])
    expect(recentlySaved(['a', 'b', 'c', 'd'], tracks)).toEqual(['a', 'c', 'd'])
  })
})
