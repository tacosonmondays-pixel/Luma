import { describe, expect, it } from 'vitest'
import { accentOf, contrast, hexToRgb, inGamut, pickAccent, pickColors, rgbToOklch } from '../src/lib/palette.ts'

/** n RGBA pixels of one color. */
const fill = (rgb: [number, number, number], n = 144) => Array.from({ length: n }, () => [...rgb, 255]).flat()
const hueOf = (hex: string) => rgbToOklch(hexToRgb(hex))[2]
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

describe('sRGB → OKLCH', () => {
  // Reference values from the OKLab paper's conversion (Björn Ottosson), as CSS Color 4 prints them.
  it.each([
    [[255, 255, 255], [1, 0, 0]],
    [[255, 0, 0], [0.628, 0.2577, 29.23]],
    [[0, 255, 0], [0.8664, 0.2948, 142.5]],
    [[0, 0, 255], [0.452, 0.3132, 264.05]],
    [[255, 255, 0], [0.968, 0.211, 109.77]],
    [[128, 128, 128], [0.5999, 0, 0]],
  ] as const)('%j', (rgb, [L, C, h]) => {
    const [l, c, hh] = rgbToOklch([...rgb])
    expect(Math.abs(l - L)).toBeLessThan(0.005)
    expect(Math.abs(c - C)).toBeLessThan(0.005)
    if (C > 0) expect(hueGap(hh, h)).toBeLessThan(0.5)
  })
})

describe('pickAccent', () => {
  it('returns undefined for grey pixels', () => {
    expect(pickAccent(fill([128, 128, 128]))).toBeUndefined()
    const greys = Array.from({ length: 144 }, (_, i) => [i, i + 2, i + 1, 255]).flat()
    expect(pickAccent(greys)).toBeUndefined()
  })

  it('ignores near-black and near-white pixels', () => {
    expect(pickAccent([...fill([4, 0, 0], 100), ...fill([255, 252, 252], 44)])).toBeUndefined()
  })

  it('gives a red hue at L 0.76 for a red-dominant sample, inside sRGB', () => {
    const pixels = [...fill([200, 30, 40], 100), ...fill([30, 60, 200], 20), ...fill([20, 20, 20], 24)]
    const accent = pickAccent(pixels)!
    expect(accent).toMatch(/^#[0-9a-f]{6}$/)
    const [L, C, h] = rgbToOklch(hexToRgb(accent))
    expect(hueGap(h, 29)).toBeLessThan(15)
    expect(Math.abs(L - 0.76)).toBeLessThan(0.01)
    expect(C).toBeLessThanOrEqual(0.15)
    expect(inGamut([0.76, C - 0.002, h])).toBe(true)
  })

  it('reads at least 5.4:1 on Fjord for every hue', () => {
    for (let h = 0; h < 360; h += 5) {
      const accent = accentOf(fitTest(h))
      expect(contrast(accent, '#2e3440')).toBeGreaterThanOrEqual(5.4)
      expect(contrast(accent, '#0a0a0c')).toBeGreaterThanOrEqual(8.5)
    }
  })
})

/** A saturated sRGB color at hue h. */
function fitTest(h: number): string {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

describe('pickColors (imageColors)', () => {
  it('returns two hues at least 40° apart when the image has them', () => {
    const [a, b] = pickColors([...fill([220, 60, 120], 90), ...fill([40, 160, 200], 54)])!
    expect(hueGap(hueOf(a), hueOf(b))).toBeGreaterThanOrEqual(40)
  })

  it('returns one hue at two lightnesses when the image has only one', () => {
    const [a, b] = pickColors(fill([60, 120, 220]))!
    expect(hueGap(hueOf(a), hueOf(b))).toBeLessThan(15)
    expect(rgbToOklch(hexToRgb(a))[0] - rgbToOklch(hexToRgb(b))[0]).toBeGreaterThan(0.1)
  })

  it('returns undefined for a grey image', () => {
    expect(pickColors(fill([90, 90, 90]))).toBeUndefined()
  })
})

describe('accentOf', () => {
  it('lifts a dark color to L 0.76 and keeps its hue', () => {
    const accent = accentOf('#1e3a8a')
    const [L, , h] = rgbToOklch(hexToRgb(accent))
    expect(Math.abs(L - 0.76)).toBeLessThan(0.01)
    expect(hueGap(h, hueOf('#1e3a8a'))).toBeLessThan(5)
  })
})
