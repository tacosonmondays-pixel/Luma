// Listening stats, badges and On Repeat, worked out from the play log (plays.ts) and the library.

import { useEffect, useMemo } from 'react'
import { useLibrary, useReady } from './library.ts'
import { loadPlays, storeTiers, usePlayLog } from './plays.ts'
import type { Badge, BadgeId, Play, Playlist, Tier, Track } from '../types.ts'

// ── Stats (pure) ─────────────────────────────────────────────────────────

export interface LibraryShape {
  tracks: Record<string, Track>
  order: string[]
  playlists: Playlist[]
}

export interface Stats {
  plays: number
  hours: number
  longestStreak: number // days
  maxSongPlays: number
  night: number // plays starting 00:00–03:59
  early: number // plays starting 05:00–07:59
  longestSessionMs: number
  artists: number
  songs: number
  playlists: number
  firstUse?: number
}

const DAY = 86_400_000
const SESSION_GAP = 10 * 60_000

/** The main artist, for counting distinct artists: lowercased, trimmed, cut before any featured or second artist. */
export function artistKey(artist: string): string {
  const a = artist.toLowerCase()
  const cut = [',', '&', ' feat.', ' ft.'].map((s) => a.indexOf(s)).filter((i) => i >= 0)
  return (cut.length ? a.slice(0, Math.min(...cut)) : a).trim()
}

/** Local noon of a play's day, so a daylight-saving change never makes a day 23 or 25 hours long. */
const noon = (at: number) => {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime()
}

export function computeStats(plays: Play[], library: LibraryShape): Stats {
  const sorted = [...plays].sort((a, b) => a[1] - b[1])
  let ms = 0
  let night = 0
  let early = 0
  const perSong = new Map<string, number>()
  const days = new Set<number>()
  const artists = new Set<string>()
  for (const [id, at, listened] of sorted) {
    ms += listened
    const hour = new Date(at).getHours()
    if (hour < 4) night++
    else if (hour >= 5 && hour < 8) early++
    perSong.set(id, (perSong.get(id) ?? 0) + 1)
    days.add(noon(at))
    const track = library.tracks[id]
    const artist = track && artistKey(track.artist)
    if (artist) artists.add(artist)
  }

  let longestStreak = 0
  let run = 0
  let lastDay = -Infinity
  for (const day of [...days].sort((a, b) => a - b)) {
    run = Math.round((day - lastDay) / DAY) === 1 ? run + 1 : 1
    longestStreak = Math.max(longestStreak, run)
    lastDay = day
  }

  let longestSessionMs = 0
  let session = 0
  let end = -Infinity
  for (const [, at, listened] of sorted) {
    session = at - end <= SESSION_GAP ? session + listened : listened
    end = Math.max(end, at + listened)
    longestSessionMs = Math.max(longestSessionMs, session)
  }

  let firstUse = sorted[0]?.[1]
  for (const t of Object.values(library.tracks)) if (firstUse === undefined || t.addedAt < firstUse) firstUse = t.addedAt

  return {
    plays: sorted.length,
    hours: ms / 3.6e6,
    longestStreak,
    maxSongPlays: Math.max(0, ...perSong.values()),
    night,
    early,
    longestSessionMs,
    artists: artists.size,
    songs: library.order.length,
    playlists: library.playlists.length,
    firstUse,
  }
}

// ── Badges (pure) ────────────────────────────────────────────────────────

interface Rule {
  id: BadgeId
  value: (s: Stats) => number
  steps: number[] // the value each tier needs; one step means a single tier
  tier?: Tier // the tier a single-step badge shows
  names: string[] // one per tier, or one for all
}

const hour = 3.6e6
const FOUNDER_BEFORE = () => new Date(2027, 0, 1).getTime() // local midnight, 2027-01-01

/** In display order (ties in tier keep this order). */
export const rules: Rule[] = [
  { id: 'first-spin', value: (s) => s.plays, steps: [1], tier: 1, names: ['First Spin'] },
  { id: 'hours', value: (s) => s.hours, steps: [10, 100, 500, 1000], names: ['10 Hours', '100 Hours', '500 Hours', '1,000 Hours'] },
  { id: 'streak', value: (s) => s.longestStreak, steps: [7, 30, 100, 365], names: ['7 Days', '30 Days', '100 Days', '365 Days'] },
  { id: 'on-repeat', value: (s) => s.maxSongPlays, steps: [25, 50, 100, 250], names: ['On Repeat'] },
  { id: 'night-owl', value: (s) => s.night, steps: [25, 100, 500, 1000], names: ['Night Owl'] },
  { id: 'early-bird', value: (s) => s.early, steps: [25, 100, 500, 1000], names: ['Early Bird'] },
  { id: 'marathon', value: (s) => s.longestSessionMs / hour, steps: [1, 2, 4, 8], names: ['Marathon'] },
  { id: 'explorer', value: (s) => s.artists, steps: [25, 100, 250, 500], names: ['Explorer'] },
  { id: 'crate-digger', value: (s) => s.songs, steps: [100, 500, 1000, 5000], names: ['Crate Digger'] },
  { id: 'curator', value: (s) => s.playlists, steps: [5, 10, 25, 50], names: ['Curator'] },
  {
    id: 'founder',
    value: (s) => (s.firstUse !== undefined && s.firstUse < FOUNDER_BEFORE() ? 1 : 0),
    steps: [1],
    tier: 4,
    names: ['Founder'],
  },
]

export type Tiers = Partial<Record<BadgeId, Tier>>

/** The tier each badge has earned from these stats (badges not earned are left out). */
export function earnedTiers(stats: Stats): Tiers {
  const tiers: Tiers = {}
  for (const rule of rules) {
    const v = rule.value(stats)
    const reached = rule.steps.filter((step) => v >= step).length
    if (reached) tiers[rule.id] = rule.tier ?? (reached as Tier)
  }
  return tiers
}

export function badgeName(id: BadgeId, tier: Tier): string {
  const rule = rules.find((r) => r.id === id)!
  const names = rule.names
  return names.length > 1 ? names[tier - 1] : names[0]
}

/** Badges to show: each at the higher of its earned and stored tier, highest tier first. */
export function badgesFrom(earned: Tiers, stored: Tiers): Badge[] {
  const badges: Badge[] = []
  for (const { id } of rules) {
    const tier = Math.max(earned[id] ?? 0, stored[id] ?? 0) as Tier | 0
    if (tier) badges.push({ id, tier, name: badgeName(id, tier), fresh: (earned[id] ?? 0) > (stored[id] ?? 0) })
  }
  return badges.sort((a, b) => b.tier - a.tier) // stable: the rules' order within a tier
}

// ── On Repeat (pure) ─────────────────────────────────────────────────────

/** The songs played most in the 30 days before `now`: at least 3 plays each, top 5; empty when fewer than 3 qualify. */
export function onRepeat(plays: Play[], tracks: Record<string, Track>, now: number): string[] {
  const since = now - 30 * DAY
  const counts = new Map<string, { n: number; last: number }>()
  for (const [id, at] of plays) {
    if (at < since || at > now || !tracks[id]) continue
    const c = counts.get(id) ?? { n: 0, last: 0 }
    counts.set(id, { n: c.n + 1, last: Math.max(c.last, at) })
  }
  const top = [...counts]
    .filter(([, c]) => c.n >= 3)
    .sort(([, a], [, b]) => b.n - a.n || b.last - a.last)
    .slice(0, 5)
    .map(([id]) => id)
  return top.length >= 3 ? top : []
}

// ── Hooks ────────────────────────────────────────────────────────────────

const none: never[] = []

function useLog() {
  useEffect(() => void loadPlays(), [])
  return usePlayLog()
}

/** Track ids played most in the last 30 days (at least 3 qualify, else empty). */
export function useOnRepeat(): string[] {
  const { plays } = useLog()
  const ready = useReady()
  const tracks = useLibrary((s) => s.tracks)
  return useMemo(() => (plays && ready ? onRepeat(plays, tracks, Date.now()) : none), [plays, ready, tracks])
}

/** Earned badges. A badge is `fresh` until `markShown` stores its tier. */
export function useBadges(): Badge[] {
  const { plays, tiers } = useLog()
  const ready = useReady()
  const tracks = useLibrary((s) => s.tracks)
  const order = useLibrary((s) => s.order)
  const playlists = useLibrary((s) => s.playlists)
  const earned = useMemo(
    () => (plays && ready ? earnedTiers(computeStats(plays, { tracks, order, playlists })) : undefined),
    [plays, ready, tracks, order, playlists],
  )
  return useMemo(() => (earned && tiers ? badgesFrom(earned, tiers) : none), [earned, tiers])
}

/** Store the tiers of badges that have now been shown, so they stay and don't shine again. */
export function markShown(badges: Badge[]): Promise<void> {
  const tiers: Tiers = {}
  for (const b of badges) tiers[b.id] = b.tier
  return storeTiers(tiers)
}
