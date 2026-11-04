import { describe, expect, it } from 'vitest'
import { clampOptions, fitCrop, frameDelays, frameTimes, moveCrop, sampleTimes, scaleCrop } from '../src/lib/gif.ts'

const video = { duration: 30, width: 1280, height: 720 }
const crop = { x: 280, y: 0, w: 720, h: 720 }

describe('clampOptions', () => {
  it('keeps valid options', () => {
    expect(clampOptions({ start: 2, end: 5, crop, width: 320, fps: 12 }, video)).toEqual({
      start: 2,
      end: 5,
      crop,
      width: 320,
      height: 320,
      fps: 12,
    })
  })

  it('caps the length at 10 seconds', () => {
    const plan = clampOptions({ start: 4, end: 25, crop, width: 320, fps: 12 }, video)
    expect(plan.end).toBe(14)
  })

  it('keeps the range inside the video', () => {
    const plan = clampOptions({ start: -3, end: 99, crop, width: 320, fps: 12 }, { ...video, duration: 6 })
    expect([plan.start, plan.end]).toEqual([0, 6])
    const late = clampOptions({ start: 40, end: 50, crop, width: 320, fps: 12 }, video)
    expect([late.start, late.end]).toEqual([30, 30])
  })

  it('caps width at 480 and fps at 15', () => {
    const plan = clampOptions({ start: 0, end: 1, crop, width: 2000, fps: 60 }, video)
    expect(plan.width).toBe(480)
    expect(plan.height).toBe(480)
    expect(plan.fps).toBe(15)
    expect(clampOptions({ start: 0, end: 1, crop, width: 0, fps: 0 }, video)).toMatchObject({ width: 1, fps: 1 })
  })

  it('never upscales a small crop', () => {
    const plan = clampOptions({ start: 0, end: 1, crop: { x: 0, y: 0, w: 300, h: 100 }, width: 480, fps: 10 }, video)
    expect([plan.width, plan.height]).toEqual([300, 100])
  })

  it('keeps the crop inside the frame, in whole pixels', () => {
    const plan = clampOptions({ start: 0, end: 1, crop: { x: 1100.4, y: -20, w: 400, h: 900 }, width: 100, fps: 10 }, video)
    expect(plan.crop).toEqual({ x: 1100, y: 0, w: 180, h: 720 })
    expect(plan.height).toBe(400)
  })

  it('survives NaN', () => {
    const plan = clampOptions({ start: NaN, end: NaN, crop: { x: NaN, y: NaN, w: NaN, h: NaN }, width: NaN, fps: NaN }, video)
    expect(plan).toEqual({ start: 0, end: 10, crop: { x: 0, y: 0, w: 1280, h: 720 }, width: 480, height: 270, fps: 15 })
  })
})

describe('frameTimes', () => {
  it('samples every 1/fps from the start, before the end', () => {
    expect(frameTimes(1, 2, 4)).toEqual([1, 1.25, 1.5, 1.75])
  })

  it('counts frames for the full range', () => {
    expect(frameTimes(0, 10, 15)).toHaveLength(150)
    expect(frameTimes(0, 3, 12)).toHaveLength(36)
    expect(frameTimes(0.5, 0.6, 15)).toHaveLength(2)
  })

  it('always has a frame', () => {
    expect(frameTimes(3, 3, 15)).toEqual([3])
  })
})

describe('frameDelays', () => {
  it('adds up to the real duration in hundredths of a second', () => {
    const delays = frameDelays(150, 15)
    expect(delays.reduce((a, b) => a + b, 0)).toBe(10000)
    expect(new Set(delays)).toEqual(new Set([60, 70]))
    expect(frameDelays(4, 10)).toEqual([100, 100, 100, 100])
  })
})

describe('sampleTimes', () => {
  it('spreads palette samples over the range', () => {
    expect(sampleTimes([0, 1, 2, 3, 4], 3)).toEqual([0, 2, 4])
    expect(sampleTimes([0, 1], 6)).toEqual([0, 1])
  })
})

describe('crop math', () => {
  it('fits the largest centred crop for an aspect', () => {
    expect(fitCrop(1280, 720, 1)).toEqual({ x: 280, y: 0, w: 720, h: 720 })
    expect(fitCrop(1280, 720, 3)).toEqual({ x: 0, y: (720 - 1280 / 3) / 2, w: 1280, h: 1280 / 3 })
    expect(fitCrop(720, 1280, 3)).toEqual({ x: 0, y: 520, w: 720, h: 240 })
  })

  it('moves inside the video', () => {
    expect(moveCrop(crop, 100, 50, 1280, 720)).toEqual({ x: 380, y: 0, w: 720, h: 720 })
    expect(moveCrop(crop, 1000, 0, 1280, 720).x).toBe(560)
    expect(moveCrop(crop, -1000, 0, 1280, 720).x).toBe(0)
  })

  it('scales around a point and keeps the aspect', () => {
    const zoomed = scaleCrop(crop, 2, 640, 360, 1280, 720, 40)
    expect(zoomed).toEqual({ x: 460, y: 180, w: 360, h: 360 })
    const banner = scaleCrop(fitCrop(1280, 720, 3), 1.5, 640, 360, 1280, 720, 40)
    expect(banner.w / banner.h).toBeCloseTo(3)
  })

  it('stops at the video size and the minimum width', () => {
    expect(scaleCrop(crop, 0.25, 640, 360, 1280, 720, 40)).toEqual(crop)
    expect(scaleCrop(crop, 100, 0, 0, 1280, 720, 40).w).toBe(40)
  })

  it('stays inside the video when scaling near an edge', () => {
    const corner = { x: 0, y: 0, w: 360, h: 360 }
    const out = scaleCrop(corner, 0.5, 0, 0, 1280, 720, 40)
    expect(out).toEqual({ x: 0, y: 0, w: 720, h: 720 })
  })
})
