import { describe, expect, it } from 'vitest'
import { emptyQueue, insertNext, next, previous, remove, setShuffle, shuffled, start, type Queue } from '../src/lib/queue.ts'

const ids = ['a', 'b', 'c', 'd', 'e']
/** A deterministic "random" that always picks the lowest index, so shuffled() reverses-ish predictably. */
const zero = () => 0
/** A seeded generator for checks that need a real permutation. */
function seeded(seed = 1) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
}
const at = (index: number, list = ids): Queue => ({ ids: [...list], index, original: null })

describe('shuffled', () => {
  it('is a permutation and leaves the input alone', () => {
    const input = [...ids]
    const out = shuffled(input, seeded())
    expect([...out].sort()).toEqual(ids)
    expect(input).toEqual(ids)
  })

  it('is deterministic for an injected random', () => {
    expect(shuffled(ids, zero)).toEqual(['b', 'c', 'd', 'e', 'a'])
  })
})

describe('start', () => {
  it('is empty for no ids', () => {
    expect(start([], 0, false)).toEqual(emptyQueue)
    expect(start([], -1, true)).toEqual(emptyQueue)
  })

  it('plays in order from `at` without shuffle', () => {
    expect(start(ids, 2, false)).toEqual({ ids, index: 2, original: null })
  })

  it('clamps `at` without shuffle', () => {
    expect(start(ids, -1, false).index).toBe(0)
    expect(start(ids, 99, false).index).toBe(4)
  })

  it('copies the ids', () => {
    const input = [...ids]
    const q = start(input, 0, false)
    input.push('z')
    expect(q.ids).toEqual(ids)
  })

  it('with shuffle, puts `at` first and shuffles the rest', () => {
    const q = start(ids, 2, true, zero)
    expect(q).toEqual({ ids: ['c', ...shuffled(['a', 'b', 'd', 'e'], zero)], index: 0, original: ids })
  })

  it('with shuffle and at < 0, starts on a random track', () => {
    const q = start(ids, -1, true, () => 0.99)
    expect(q.ids[0]).toBe('e')
    expect(q.index).toBe(0)
    expect([...q.ids].sort()).toEqual(ids)
    expect(q.original).toEqual(ids)
  })

  it('with shuffle, clamps `at`', () => {
    expect(start(ids, 99, true, zero).ids[0]).toBe('e')
  })
})

describe('next', () => {
  it('advances in every repeat mode when not at the end', () => {
    for (const repeat of ['off', 'all', 'one'] as const) {
      expect(next(at(1), repeat, false)).toEqual({ index: 2, play: true })
    }
    expect(next(at(1), 'off', true)).toEqual({ index: 2, play: true })
    expect(next(at(1), 'all', true)).toEqual({ index: 2, play: true })
  })

  it('repeats the track when it ends on its own with repeat one', () => {
    expect(next(at(1), 'one', true)).toEqual({ index: 1, play: true })
    expect(next(at(4), 'one', true)).toEqual({ index: 4, play: true })
  })

  it('skips ahead from repeat one when pressed', () => {
    expect(next(at(1), 'one', false)).toEqual({ index: 2, play: true })
  })

  it('at the end, goes back to the start and stops with repeat off', () => {
    expect(next(at(4), 'off', true)).toEqual({ index: 0, play: false })
    expect(next(at(4), 'off', false)).toEqual({ index: 0, play: false })
  })

  it('at the end, wraps and keeps playing with repeat all', () => {
    expect(next(at(4), 'all', true)).toEqual({ index: 0, play: true })
    expect(next(at(4), 'all', false)).toEqual({ index: 0, play: true })
  })

  it('at the end, a pressed next with repeat one stops at the start', () => {
    expect(next(at(4), 'one', false)).toEqual({ index: 0, play: false })
  })
})

describe('previous', () => {
  it('restarts the track after 3 seconds, in every mode', () => {
    for (const repeat of ['off', 'all', 'one'] as const) {
      expect(previous(at(2), repeat, 3.5)).toEqual({ index: 2, restart: true })
      expect(previous(at(0), repeat, 10)).toEqual({ index: 0, restart: true })
    }
  })

  it('goes back within the first 3 seconds, in every mode', () => {
    for (const repeat of ['off', 'all', 'one'] as const) {
      expect(previous(at(2), repeat, 1)).toEqual({ index: 1, restart: false })
      expect(previous(at(2), repeat, 3)).toEqual({ index: 1, restart: false })
    }
  })

  it('restarts the first track with repeat off or one', () => {
    expect(previous(at(0), 'off', 0)).toEqual({ index: 0, restart: true })
    expect(previous(at(0), 'one', 0)).toEqual({ index: 0, restart: true })
  })

  it('wraps to the last track with repeat all', () => {
    expect(previous(at(0), 'all', 0)).toEqual({ index: 4, restart: false })
  })
})

describe('setShuffle', () => {
  it('keeps the current track first and remembers the order', () => {
    const q = setShuffle(at(2), true, zero)
    expect(q).toEqual({ ids: ['c', ...shuffled(['a', 'b', 'd', 'e'], zero)], index: 0, original: ids })
  })

  it('restores the order and finds the current track when turned off', () => {
    let q = setShuffle(at(2), true, seeded(7))
    q = { ...q, index: 3 }
    const current = q.ids[3]
    const off = setShuffle(q, false)
    expect(off).toEqual({ ids, index: ids.indexOf(current), original: null })
  })

  it('round-trips', () => {
    expect(setShuffle(setShuffle(at(1), true, seeded()), false)).toEqual(at(1))
  })

  it('does nothing when already in that state', () => {
    const plain = at(1)
    expect(setShuffle(plain, false)).toBe(plain)
    const on = setShuffle(plain, true, zero)
    expect(setShuffle(on, true, zero)).toBe(on)
  })

  it('does nothing on an empty queue', () => {
    expect(setShuffle(emptyQueue, true)).toBe(emptyQueue)
  })
})

describe('remove', () => {
  it('ignores an id that is not queued', () => {
    const q = at(2)
    expect(remove(q, 'z')).toBe(q)
  })

  it('removing before the current track keeps playing the same track', () => {
    expect(remove(at(2), 'a')).toEqual({ ids: ['b', 'c', 'd', 'e'], index: 1, original: null })
  })

  it('removing the current track moves to the one after it', () => {
    expect(remove(at(2), 'c')).toEqual({ ids: ['a', 'b', 'd', 'e'], index: 2, original: null })
  })

  it('removing the current last track moves to the new last track', () => {
    expect(remove(at(4), 'e')).toEqual({ ids: ['a', 'b', 'c', 'd'], index: 3, original: null })
  })

  it('removing after the current track keeps the index', () => {
    expect(remove(at(2), 'e')).toEqual({ ids: ['a', 'b', 'c', 'd'], index: 2, original: null })
  })

  it('removing the only track empties the queue', () => {
    expect(remove(at(0, ['a']), 'a')).toEqual(emptyQueue)
  })

  it('removes from the original order too while shuffled', () => {
    const q = remove(setShuffle(at(0), true, zero), 'c')
    expect(q.ids).not.toContain('c')
    expect(q.original).toEqual(['a', 'b', 'd', 'e'])
    expect(setShuffle(q, false)).toEqual({ ids: ['a', 'b', 'd', 'e'], index: 0, original: null })
  })
})

describe('insertNext', () => {
  it('starts a queue when empty', () => {
    expect(insertNext(emptyQueue, 'a')).toEqual({ ids: ['a'], index: 0, original: null })
  })

  it('inserts after the current track', () => {
    expect(insertNext(at(1), 'z')).toEqual({ ids: ['a', 'b', 'z', 'c', 'd', 'e'], index: 1, original: null })
  })

  it('moves an already queued track from later on', () => {
    expect(insertNext(at(1), 'e')).toEqual({ ids: ['a', 'b', 'e', 'c', 'd'], index: 1, original: null })
  })

  it('moves an already queued track from earlier on', () => {
    expect(insertNext(at(3), 'a')).toEqual({ ids: ['b', 'c', 'd', 'a', 'e'], index: 2, original: null })
  })

  it('does nothing for the current track', () => {
    const q = at(2)
    expect(insertNext(q, 'c')).toBe(q)
  })

  it('while shuffled, inserts after the current track in both orders', () => {
    const on = setShuffle(at(1), true, zero) // current is 'b'
    const q = insertNext(on, 'z')
    expect(q.ids[q.index]).toBe('b')
    expect(q.ids[q.index + 1]).toBe('z')
    expect(q.original).toEqual(['a', 'b', 'z', 'c', 'd', 'e'])
    expect(setShuffle(q, false)).toEqual({ ids: ['a', 'b', 'z', 'c', 'd', 'e'], index: 1, original: null })
  })

  it('while shuffled, moves an already queued track in both orders', () => {
    const on = setShuffle(at(1), true, zero)
    const q = insertNext(on, 'e')
    expect(q.ids[q.index + 1]).toBe('e')
    expect(q.ids.filter((x) => x === 'e')).toHaveLength(1)
    expect(q.original).toEqual(['a', 'b', 'e', 'c', 'd'])
  })

  it('does not mutate the input', () => {
    const on = setShuffle(at(1), true, zero)
    const copy = structuredClone(on)
    insertNext(on, 'e')
    expect(on).toEqual(copy)
  })
})
