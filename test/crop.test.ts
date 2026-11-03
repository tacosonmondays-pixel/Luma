import { describe, expect, it } from 'vitest'
import { CENTER, clampCrop, coverSize, cropOffset, panBy, storedCrop, zoomAt } from '../src/lib/crop.ts'

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)

describe('coverSize', () => {
  it('covers the frame on the tighter side', () => {
    expect(coverSize(2, 100, 100)).toEqual({ w: 200, h: 100 }) // wide image in a square
    expect(coverSize(0.5, 300, 100)).toEqual({ w: 300, h: 600 }) // tall image in a banner
    expect(coverSize(2, 100, 100, 3)).toEqual({ w: 600, h: 300 })
  })
})

describe('clampCrop', () => {
  it('defaults to the center at 1×', () => {
    expect(clampCrop(undefined, 1.5, 100, 100)).toEqual(CENTER)
  })

  it('keeps zoom within 1..4', () => {
    expect(clampCrop({ x: 0.5, y: 0.5, zoom: 0.2 }, 1, 100, 100).zoom).toBe(1)
    expect(clampCrop({ x: 0.5, y: 0.5, zoom: 9 }, 1, 100, 100).zoom).toBe(4)
    expect(clampCrop({ x: 0.5, y: 0.5, zoom: Number.NaN }, 1, 100, 100).zoom).toBe(1)
  })

  it('never leaves an empty edge', () => {
    // A 2:1 image in a square at 1×: 200×100, so x can go from .25 to .75 and y is fixed at .5.
    const c = clampCrop({ x: 0, y: 0, zoom: 1 }, 2, 100, 100)
    close(c.x, 0.25)
    close(c.y, 0.5)
    const d = clampCrop({ x: 1, y: 1, zoom: 2 }, 2, 100, 100) // 400×200
    close(d.x, 0.875)
    close(d.y, 0.75)
  })

  it('keeps any focus that is already inside the limits', () => {
    expect(clampCrop({ x: 0.6, y: 0.5, zoom: 1 }, 2, 100, 100)).toEqual({ x: 0.6, y: 0.5, zoom: 1 })
  })
})

describe('cropOffset', () => {
  it('centered at 1× is object-fit: cover', () => {
    expect(cropOffset(undefined, 2, 100, 100)).toEqual({ left: -50, top: 0, w: 200, h: 100 })
    expect(cropOffset(undefined, 1, 300, 100)).toEqual({ left: 0, top: -100, w: 300, h: 300 })
  })

  it('puts the focus point at the frame center', () => {
    const o = cropOffset({ x: 0.4, y: 0.6, zoom: 2 }, 1, 100, 100) // 200×200
    close(o.left + 0.4 * o.w, 50)
    close(o.top + 0.6 * o.h, 50)
  })

  it('stops at the edges', () => {
    const o = cropOffset({ x: 0, y: 1, zoom: 2 }, 1, 100, 100)
    close(o.left, 0)
    close(o.top, -100)
  })
})

describe('gestures', () => {
  it('panning moves the focus against the drag', () => {
    const c = panBy({ x: 0.5, y: 0.5, zoom: 2 }, 1, 100, 100, 20, -10) // 200×200
    close(c.x, 0.4)
    close(c.y, 0.55)
  })

  it('zooming keeps the point under the fingers still', () => {
    const before = { x: 0.5, y: 0.5, zoom: 1.5 }
    const after = zoomAt(before, 1, 100, 100, 3, 20, -10)
    const a = cropOffset(before, 1, 100, 100)
    const b = cropOffset(after, 1, 100, 100)
    // The source point at (70, 40) in the frame stays there.
    close((70 - a.left) / a.w, (70 - b.left) / b.w)
    close((40 - a.top) / a.h, (40 - b.top) / b.h)
  })

  it('zoom stops at 1× and 4×', () => {
    expect(zoomAt(CENTER, 1, 100, 100, 0.5).zoom).toBe(1)
    expect(zoomAt(CENTER, 1, 100, 100, 10).zoom).toBe(4)
  })
})

describe('storedCrop', () => {
  it('stores nothing for the default', () => {
    expect(storedCrop(CENTER)).toBeUndefined()
    expect(storedCrop({ x: 0.5002, y: 0.4999, zoom: 1.0001 })).toBeUndefined()
    expect(storedCrop({ x: 0.123456, y: 0.5, zoom: 2 })).toEqual({ x: 0.1235, y: 0.5, zoom: 2 })
  })
})
