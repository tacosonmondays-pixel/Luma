// The play log. Listens to the player (never changes it) and records each listen that counts as a play.
//
// Storage: its own IndexedDB store, so scans never walk the audio blobs.
//   <YYYY-MM-DD>  Play[] started that local day
//   badges        Partial<Record<BadgeId, Tier>>, the tiers already shown (they never go down)
//
// The counting rules live in the pure `listen` reducer; the wiring at the bottom feeds it audio events.

import { create } from 'zustand'
import { createStore, entries, get, set, update } from 'idb-keyval'
import { audio, usePlayer } from './player.ts'
import type { BadgeId, Play, Tier } from '../types.ts'

// ── Counting (pure) ──────────────────────────────────────────────────────

export interface ListenState {
  id?: string
  playing: boolean
  at: number // Date.now() when this listen started
  listened: number // seconds
  time: number // audio time at the last event
  wall: number // performance.now() at the last event
  written: number // listened ms in the last write, -1 before the play counts
  writtenAt: number // performance.now() of the last write
}

export interface ListenEvent {
  type: 'time' | 'play' | 'pause' | 'flush'
  id: string | undefined
  time: number // audio.currentTime
  wall: number // performance.now()
  now: number // Date.now()
  duration: number // seconds, 0 when unknown
}

export const idle: ListenState = { playing: false, at: 0, listened: 0, time: 0, wall: 0, written: -1, writtenAt: 0 }

/** Seconds of listening a song needs to count as a play. */
export const needed = (duration: number) => (duration > 0 ? Math.min(30, Math.max(10, duration / 2)) : 30)

const start = (e: ListenEvent, playing: boolean): ListenState => ({
  ...idle,
  id: e.id,
  playing,
  at: e.now,
  time: e.time,
  wall: e.wall,
})

const ms = (s: ListenState) => Math.round(s.listened * 1000)

/** The write that brings a counted play up to date, if it has changed. */
const flush = (s: ListenState): Play | undefined =>
  s.id !== undefined && s.written >= 0 && ms(s) !== s.written ? [s.id, s.at, ms(s)] : undefined

/** Mark a write as done. */
const wrote = (s: ListenState, wall: number): ListenState => ({ ...s, written: ms(s), writtenAt: wall })

/** Add the time played since the last event, unless it moved faster than the clock (a seek or a scan). */
function advance(s: ListenState, e: ListenEvent, to = e.time): ListenState {
  const delta = to - s.time
  const wallDelta = (e.wall - s.wall) / 1000
  const listened = s.playing && delta > 0 && delta <= wallDelta + 0.5 ? s.listened + delta : s.listened
  return { ...s, listened, time: e.time, wall: e.wall }
}

/** One step of the play log: the new state, and the plays to write (new, or updated by `[id, at]`). */
export function listen(state: ListenState, e: ListenEvent): { state: ListenState; writes: Play[] } {
  const writes: Play[] = []
  let s = state

  // Another song (or none): close the last listen and start a new one.
  if (e.id !== s.id) {
    const last = flush(s)
    if (last) writes.push(last)
    s = start(e, e.type === 'play' || (s.playing && e.type !== 'pause'))
  }
  // A wrap to the start of the same song (repeat one, or the always-on loop): two listens.
  else if (e.duration > 0 && s.time >= e.duration - 1.5 && e.time < 1 && s.playing) {
    s = advance(s, e, e.duration)
    const counted = countOrFlush(s, e)
    if (counted) writes.push(counted)
    s = start(e, true)
  } else if (e.type === 'play') {
    s = { ...s, playing: true, time: e.time, wall: e.wall } // nothing counts while paused, seeks included
  } else {
    s = advance(s, e)
  }

  if (e.type === 'pause') s = { ...s, playing: false }

  const due = e.type !== 'time' || e.wall - s.writtenAt >= 60_000
  const write = s.written < 0 ? countOrFlush(s, e) : due ? flush(s) : undefined
  if (write) {
    writes.push(write)
    s = wrote(s, e.wall)
  }
  return { state: s, writes }
}

/** The first write of a listen that has just reached a play, or the update of one already written. */
function countOrFlush(s: ListenState, e: ListenEvent): Play | undefined {
  if (s.id === undefined) return
  if (s.written < 0) return s.listened >= needed(e.duration) ? [s.id, s.at, ms(s)] : undefined
  return flush(s)
}

// ── Storage ──────────────────────────────────────────────────────────────

const store = createStore('luma-plays', 'days')
const BADGES = 'badges'

/** The local date of a moment, `YYYY-MM-DD`. */
export function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Tiers = Partial<Record<BadgeId, Tier>>

interface PlayLog {
  plays?: Play[] // every play, oldest first; a new array only when a play is added
  tiers?: Tiers
}

/** The log in memory, loaded on first use (`loadPlays`). */
export const usePlayLog = create<PlayLog>()(() => ({}))

let loading: Promise<void> | undefined
let saving: Promise<unknown> = Promise.resolve()

export function loadPlays(): Promise<void> {
  return (loading ??= (async () => {
    const all = await entries<string, unknown>(store).catch(() => [])
    const plays: Play[] = []
    let tiers: Tiers = {}
    for (const [key, value] of all) {
      if (key === BADGES) tiers = value as Tiers
      else if (Array.isArray(value)) plays.push(...(value as Play[]))
    }
    plays.sort((a, b) => a[1] - b[1])
    usePlayLog.setState({ plays, tiers })
  })())
}

/** Upsert plays by `[id, at]` into a list. Returns whether any was new. */
function upsert(list: Play[], plays: Play[]): boolean {
  let added = false
  for (const p of plays) {
    const i = list.findIndex((q) => q[0] === p[0] && q[1] === p[1])
    if (i < 0) {
      list.push(p)
      added = true
    } else list[i] = p
  }
  return added
}

function write(plays: Play[]) {
  const days = new Map<string, Play[]>()
  for (const p of plays) days.set(dayKey(p[1]), [...(days.get(dayKey(p[1])) ?? []), p])
  for (const [day, list] of days)
    saving = saving.then(() =>
      update<Play[]>(day, (stored = []) => (upsert(stored, list), stored), store).catch(() => {}),
    )
}

/** Memory: updates change their entry in place; new plays make a new array, so stats recompute. */
function remember(plays: Play[]) {
  const current = usePlayLog.getState().plays
  if (!current) return
  const next = [...current]
  if (upsert(next, plays)) usePlayLog.setState({ plays: next.sort((a, b) => a[1] - b[1]) })
  else upsert(current, plays)
}

function save(plays: Play[]) {
  write(plays)
  // The log may still be loading; its read can miss this write, so merge once it has loaded.
  void loadPlays().then(() => remember(plays))
}

/** Add plays to the log (also how Playwright seeds history in dev). */
export async function addPlays(plays: Play[]): Promise<void> {
  await loadPlays()
  write(plays)
  remember(plays)
  await saving
}

/** Remember tiers as shown, so they never go down and shine only once. */
export async function storeTiers(tiers: Tiers): Promise<void> {
  await loadPlays()
  const merged = { ...usePlayLog.getState().tiers }
  for (const [id, tier] of Object.entries(tiers) as [BadgeId, Tier][]) merged[id] = Math.max(merged[id] ?? 0, tier) as Tier
  usePlayLog.setState({ tiers: merged })
  saving = saving.then(() => set(BADGES, merged, store).catch(() => {}))
  await saving
}

/** The stored tiers straight from IndexedDB (tests and checks). */
export const storedTiers = () => get<Tiers>(BADGES, store)

// ── Wiring ───────────────────────────────────────────────────────────────

if (typeof document !== 'undefined') {
  let state = idle
  const feed = (type: ListenEvent['type']) => {
    const { queue } = usePlayer.getState()
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0
    const event = { type, id: queue.ids[queue.index], time: audio.currentTime, wall: performance.now(), now: Date.now(), duration }
    const result = listen(state, event)
    state = result.state
    if (result.writes.length) save(result.writes)
  }
  audio.addEventListener('timeupdate', () => feed('time'))
  audio.addEventListener('play', () => feed('play'))
  audio.addEventListener('pause', () => feed('pause'))
  audio.addEventListener('emptied', () => feed('flush'))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && feed('flush'))
  window.addEventListener('pagehide', () => feed('flush'))
}
