import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/player.ts', () => ({ audio: {}, usePlayer: { getState: () => ({}) } }))
const { idle, listen, needed } = await import('../src/lib/plays.ts')
type Event = Parameters<typeof listen>[1]
type State = Parameters<typeof listen>[0]
type Play = [string, number, number]

const T0 = 1_750_000_000_000

/** Drives the reducer like the audio element would: timeupdates every `step` seconds of wall and audio time. */
function session(duration = 200, id = 'a') {
  let state: State = idle
  let time = 0
  let wall = 0
  const writes: Play[] = []
  const send = (type: Event['type'], overrides: Partial<Event> = {}) => {
    const r = listen(state, { type, id, time, wall: wall * 1000, now: T0 + wall * 1000, duration, ...overrides })
    state = r.state
    writes.push(...r.writes)
  }
  return {
    writes,
    play: () => send('play'),
    pause: () => send('pause'),
    /** Play for `seconds`, with an event every `step` seconds. */
    run(seconds: number, step = 0.25) {
      for (let t = 0; t < seconds - 1e-9; t += step) {
        time += step
        wall += step
        send('time')
      }
    },
    seek(to: number, wallDelta = 0.25) {
      time = to
      wall += wallDelta
      send('time')
    },
    /** The loop wraps to the start (repeat one). */
    wrap() {
      wall += 0.25
      time = 0.1
      send('time')
    },
    get state() {
      return state
    },
  }
}

describe('needed', () => {
  it('is 30 s, or half a short song but at least 10 s', () => {
    expect(needed(0)).toBe(30)
    expect(needed(200)).toBe(30)
    expect(needed(40)).toBe(20)
    expect(needed(16)).toBe(10)
  })
})

describe('listen', () => {
  it('counts a play at 30 s, not 29 s', () => {
    const s = session()
    s.play()
    s.run(29)
    expect(s.writes).toEqual([])
    s.run(1)
    expect(s.writes).toEqual([['a', T0, 30000]])
  })

  it('counts a 16 s song at 10 s', () => {
    const s = session(16)
    s.play()
    s.run(9.75)
    expect(s.writes).toEqual([])
    s.run(0.25)
    expect(s.writes).toEqual([['a', T0, 10000]])
  })

  it('leaves out a seek', () => {
    const s = session()
    s.play()
    s.run(10)
    s.seek(40, 0.25) // 30 s further within 0.25 s of wall time
    s.run(19.5)
    expect(s.state.listened).toBeCloseTo(29.5)
    expect(s.writes).toEqual([])
  })

  it('counts throttled background events in full', () => {
    const s = session()
    s.play()
    s.run(32, 4)
    expect(s.writes).toEqual([['a', T0, 32000]])
  })

  it('makes two plays of a wrap in repeat one', () => {
    const s = session(60)
    s.play()
    s.run(59.75)
    s.wrap()
    s.run(40)
    s.pause()
    const plays = s.writes.filter((w, i, all) => all.findIndex((v) => v[1] === w[1]) === i)
    expect(plays.map((p) => p[1])).toEqual([T0, T0 + 60_000])
    const last = (at: number) => s.writes.filter((w) => w[1] === at).at(-1)![2]
    expect(last(T0)).toBe(60000)
    expect(last(T0 + 60_000)).toBe(40000)
  })

  it('writes the listened time on pause', () => {
    const s = session()
    s.play()
    s.run(45)
    s.pause()
    expect(s.writes.at(-1)).toEqual(['a', T0, 45000])
  })

  it('adds nothing while paused, and goes on after play', () => {
    const s = session()
    s.play()
    s.run(20)
    s.pause()
    s.seek(100, 30) // a seek while paused
    s.play()
    s.run(15)
    expect(s.state.listened).toBeCloseTo(35)
    expect(s.writes).toEqual([['a', T0, 30000]])
  })

  it('updates a counted play at most once a minute between events', () => {
    const s = session(600)
    s.play()
    s.run(150)
    expect(s.writes.map((w) => w[2])).toEqual([30000, 90000, 150000])
  })

  it('closes a play on a track change', () => {
    const s = session()
    s.play()
    s.run(40)
    const r = listen(s.state, { type: 'time', id: 'b', time: 0.2, wall: 40_250, now: T0 + 40_250, duration: 200 })
    expect(r.writes).toEqual([['a', T0, 40000]])
    expect(r.state).toMatchObject({ id: 'b', listened: 0, at: T0 + 40_250, playing: true })
  })
})
