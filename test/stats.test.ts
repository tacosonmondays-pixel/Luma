process.env.TZ = 'America/New_York'

import { describe, expect, it, vi } from 'vitest'
import type { Play, Track } from '../src/types.ts'

vi.mock('../src/lib/player.ts', () => ({ audio: {}, usePlayer: { getState: () => ({}) } }))
vi.mock('../src/lib/library.ts', () => ({ useLibrary: () => undefined, useReady: () => true }))
const { artistKey, badgesFrom, computeStats, earnedTiers, onRepeat, rules } = await import('../src/lib/stats.ts')
type Stats = ReturnType<typeof computeStats>

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const track = (id: string, artist = 'Someone', addedAt = at(2027, 6, 1)): Track => ({
  id,
  title: id,
  artist,
  duration: 200,
  source: 'file',
  addedAt,
})
const lib = (tracks: Track[] = [], playlists = 0) => ({
  tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
  order: tracks.map((t) => t.id),
  playlists: Array.from({ length: playlists }, (_, i) => ({ id: `p${i}`, name: '', trackIds: [], createdAt: 0 })),
})
const daily = (from: number, days: number): Play[] =>
  Array.from({ length: days }, (_, i) => ['a', from + i * 86_400_000, 60_000] as Play)

describe('streaks', () => {
  it('runs unbroken across the March daylight-saving change', () => {
    // 2027-03-14 is 23 hours long in New York; plays at 00:30 each day.
    const plays = Array.from({ length: 7 }, (_, i) => ['a', at(2027, 3, 11 + i, 0, 30), 1000] as Play)
    expect(computeStats(plays, lib()).longestStreak).toBe(7)
  })

  it('runs unbroken across the November change', () => {
    // 2027-11-07 is 25 hours long; plays at 23:30 each day.
    const plays = Array.from({ length: 7 }, (_, i) => ['a', at(2027, 11, 4 + i, 23, 30), 1000] as Play)
    expect(computeStats(plays, lib()).longestStreak).toBe(7)
  })

  it('breaks on a missed day and counts several plays a day once', () => {
    const plays: Play[] = [
      ['a', at(2027, 5, 1, 9), 1],
      ['a', at(2027, 5, 1, 22), 1],
      ['a', at(2027, 5, 2), 1],
      ['a', at(2027, 5, 4), 1],
    ]
    expect(computeStats(plays, lib()).longestStreak).toBe(2)
  })
})

describe('time of day', () => {
  it('counts 00:00 as night and 23:59 not', () => {
    const s = computeStats(
      [
        ['a', at(2027, 5, 1, 23, 59), 1],
        ['a', at(2027, 5, 2, 0, 0), 1],
        ['a', at(2027, 5, 2, 3, 59), 1],
        ['a', at(2027, 5, 2, 4, 0), 1],
      ],
      lib(),
    )
    expect(s.night).toBe(2)
  })

  it('counts 05:00–07:59 as early', () => {
    const s = computeStats(
      [
        ['a', at(2027, 5, 1, 4, 59), 1],
        ['a', at(2027, 5, 1, 5, 0), 1],
        ['a', at(2027, 5, 1, 7, 59), 1],
        ['a', at(2027, 5, 1, 8, 0), 1],
      ],
      lib(),
    )
    expect(s.early).toBe(2)
  })
})

describe('sessions', () => {
  const start = at(2027, 5, 1, 20)
  const min = 60_000
  it('joins plays 10 minutes apart', () => {
    const plays: Play[] = [
      ['a', start, 30 * min],
      ['b', start + 40 * min, 30 * min], // 10 min after the first ended
    ]
    expect(computeStats(plays, lib()).longestSessionMs).toBe(60 * min)
  })

  it('splits plays more than 10 minutes apart', () => {
    const plays: Play[] = [
      ['a', start, 30 * min],
      ['b', start + 40 * min + 1, 20 * min],
    ]
    expect(computeStats(plays, lib()).longestSessionMs).toBe(30 * min)
  })
})

describe('artists', () => {
  it('counts main artists of songs still in the library', () => {
    expect(artistKey('  Daft Punk feat. Pharrell ')).toBe('daft punk')
    expect(artistKey('Simon & Garfunkel')).toBe('simon')
    expect(artistKey('A, B')).toBe('a')
    expect(artistKey('X ft. Y')).toBe('x')
    const tracks = [track('a', 'Daft Punk'), track('b', 'daft punk ft. Someone'), track('c', 'Other')]
    const plays: Play[] = [['a', 1, 1], ['b', 2, 1], ['c', 3, 1], ['gone', 4, 1]]
    expect(computeStats(plays, lib(tracks)).artists).toBe(2)
  })
})

describe('On Repeat', () => {
  const now = at(2027, 6, 30)
  const day = 86_400_000
  const tracks = lib(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => track(id))).tracks
  const times = (id: string, n: number, last = now - day): Play[] =>
    Array.from({ length: n }, (_, i) => [id, last - i * 3_600_000, 60_000] as Play)

  it('orders by plays, then by the latest play, top 5', () => {
    const plays = [
      ...times('a', 3, now - 5 * day),
      ...times('b', 6),
      ...times('c', 3, now - 2 * day),
      ...times('d', 4),
      ...times('e', 3, now - 9 * day),
      ...times('f', 3, now - 1 * day),
    ]
    expect(onRepeat(plays, tracks, now)).toEqual(['b', 'd', 'f', 'c', 'a'])
  })

  it('needs 3 plays a song, 3 songs, and the last 30 days', () => {
    const base = [...times('a', 3), ...times('b', 3)]
    expect(onRepeat([...base, ...times('c', 2)], tracks, now)).toEqual([])
    expect(onRepeat([...base, ...times('c', 3, now - 31 * day)], tracks, now)).toEqual([])
    expect(onRepeat([...base, ...times('c', 3)], tracks, now)).toHaveLength(3)
  })

  it('leaves out deleted songs', () => {
    const plays = [...times('a', 3), ...times('b', 3), ...times('c', 3), ...times('gone', 9)]
    expect(onRepeat(plays, tracks, now)).not.toContain('gone')
    const { c: _, ...withoutC } = tracks
    expect(onRepeat(plays, withoutC, now)).toEqual([])
  })
})

describe('badges', () => {
  const zero: Stats = {
    plays: 0,
    hours: 0,
    longestStreak: 0,
    maxSongPlays: 0,
    night: 0,
    early: 0,
    longestSessionMs: 0,
    artists: 0,
    songs: 0,
    playlists: 0,
  }
  const cases: [string, keyof Stats, number[], number][] = [
    ['first-spin', 'plays', [1], 1],
    ['hours', 'hours', [10, 100, 500, 1000], 1],
    ['streak', 'longestStreak', [7, 30, 100, 365], 1],
    ['on-repeat', 'maxSongPlays', [25, 50, 100, 250], 1],
    ['night-owl', 'night', [25, 100, 500, 1000], 1],
    ['early-bird', 'early', [25, 100, 500, 1000], 1],
    ['marathon', 'longestSessionMs', [1, 2, 4, 8], 3.6e6],
    ['explorer', 'artists', [25, 100, 250, 500], 1],
    ['crate-digger', 'songs', [100, 500, 1000, 5000], 1],
    ['curator', 'playlists', [5, 10, 25, 50], 1],
  ]
  for (const [id, key, steps, unit] of cases)
    it(`${id} tiers at n − 1 and n`, () => {
      steps.forEach((n, i) => {
        const below = earnedTiers({ ...zero, [key]: n * unit - 1 }) // one unit (or 1 ms) short
        const exact = earnedTiers({ ...zero, [key]: n * unit })
        expect(below[id as never] ?? 0).toBe(id === 'first-spin' ? 0 : i)
        expect(exact[id as never]).toBe(id === 'first-spin' ? 1 : i + 1)
      })
    })

  it('founder is holo for first use before 2027-01-01 local time', () => {
    expect(earnedTiers({ ...zero, firstUse: at(2026, 12, 31, 23, 59) }).founder).toBe(4)
    expect(earnedTiers({ ...zero, firstUse: at(2027, 1, 1, 0, 0) }).founder).toBeUndefined()
    expect(earnedTiers(zero).founder).toBeUndefined()
  })

  it('takes first use from songs added and the first play', () => {
    const s = computeStats([['a', at(2027, 3, 1), 1]], lib([track('a', 'x', at(2026, 12, 1))]))
    expect(s.firstUse).toBe(at(2026, 12, 1))
  })

  it('names tiers, sorts highest first, and marks new tiers fresh', () => {
    const badges = badgesFrom({ hours: 2, 'first-spin': 1, founder: 4, streak: 2 }, { hours: 2, streak: 1 })
    expect(badges.map((b) => [b.id, b.tier, b.name, b.fresh])).toEqual([
      ['founder', 4, 'Founder', true],
      ['hours', 2, '100 Hours', false],
      ['streak', 2, '30 Days', true],
      ['first-spin', 1, 'First Spin', true],
    ])
  })

  it('never drops a stored tier after a song is deleted', () => {
    const tracks = Array.from({ length: 100 }, (_, i) => track(`t${i}`))
    const before = earnedTiers(computeStats([], lib(tracks)))
    expect(before['crate-digger']).toBe(1)
    const after = earnedTiers(computeStats([], lib(tracks.slice(1))))
    expect(after['crate-digger']).toBeUndefined()
    const shown = badgesFrom(after, before)
    expect(shown.find((b) => b.id === 'crate-digger')).toMatchObject({ tier: 1, fresh: false })
  })

  it('has a rule, in table order, for every badge', () => {
    expect(rules.map((r) => r.id)).toEqual([
      'first-spin', 'hours', 'streak', 'on-repeat', 'night-owl', 'early-bird',
      'marathon', 'explorer', 'crate-digger', 'curator', 'founder',
    ])
  })
})

describe('hours', () => {
  it('sums listened time', () => {
    expect(computeStats(daily(at(2027, 1, 1), 60), lib()).hours).toBe(1)
  })
})
