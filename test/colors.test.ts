import { describe, expect, it } from 'vitest'
import { BOTTOM_L, OVERLAY, OVERLAY_RGB, PRESETS, TOP_L, capLightness, contrast, hexToRgb, over, toOklch } from '../src/ui/profile/colors.ts'

const white: [number, number, number] = [1, 1, 1]
const text = { name: 1, bio: 0.78, 'text-2': 0.72 }

/** Every text color on the card, measured against a background color. */
function check(background: [number, number, number]) {
  for (const [label, alpha] of Object.entries(text)) {
    const ratio = contrast(over(white, alpha, background), background)
    expect(ratio, `${label} at ${alpha}`).toBeGreaterThanOrEqual(4.5)
  }
}

const pairs: [string, string][] = [...PRESETS, ['#ffffff', '#ffffff'], ['#000000', '#000000'], ['#ffff00', '#00ffff'], ['#0000ff', '#ff00ff']]

describe('profile colors', () => {
  it.each(pairs)('keeps text readable on %s → %s', (top, bottom) => {
    const pa = capLightness(top, TOP_L)
    const pb = capLightness(bottom, BOTTOM_L)
    check(hexToRgb(pa))
    check(hexToRgb(pb))
    expect(contrast(white, hexToRgb(pa))).toBeGreaterThanOrEqual(7)
  })

  it('caps lightness and keeps dark colors as they are', () => {
    expect(toOklch(capLightness('#ffffff', TOP_L))[0]).toBeCloseTo(TOP_L, 2)
    expect(capLightness('#020617', TOP_L)).toBe('#020617')
  })

  it('keeps the hue of a capped color', () => {
    const [, , hue] = toOklch('#ff7ab8')
    expect(toOklch(capLightness('#ff7ab8', TOP_L))[2]).toBeCloseTo(hue, 1)
  })

  it('keeps text readable on a pure-white Background under the overlay', () => {
    const rgb = OVERLAY_RGB.map((c) => c / 255) as [number, number, number]
    check(over(rgb, OVERLAY[0], white))
  })
})
