// The profile card's own colors, kept readable: white text on any of them measures at least 8:1.
import type { CSSProperties } from 'react'
import { accentOf } from '../../lib/palette.ts'
import type { Profile } from '../../types.ts'

/** Top → bottom. */
export const PRESETS: [string, string][] = [
  ['#ff7ab8', '#6b5bff'],
  ['#38bdf8', '#1e3a8a'],
  ['#a3e635', '#065f46'],
  ['#fb923c', '#7f1d1d'],
  ['#fda4af', '#9d174d'],
  ['#fde68a', '#92400e'],
  ['#6ee7b7', '#0f766e'],
  ['#c4b5fd', '#4c1d95'],
  ['#e5e7eb', '#374151'],
  ['#1e293b', '#020617'],
]

/** The lightest OKLCH lightness for the card's top and bottom colors. */
export const TOP_L = 0.42
export const BOTTOM_L = 0.24

/** The dark overlay over a Background image: the lightest and darkest stop. */
export const OVERLAY: [number, number] = [0.7, 0.88]
export const OVERLAY_RGB = [10, 10, 12]

type RGB = [number, number, number] // 0–1, sRGB

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1, 7), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function rgbToHex(rgb: RGB): string {
  return '#' + rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')
}

/** sRGB → OKLCH [L, C, h in radians]. */
export function toOklch(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), Math.atan2(B, A)]
}

/** OKLCH → linear sRGB, possibly out of gamut. */
function oklchToLinear(L: number, C: number, h: number): RGB {
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (rgb: RGB) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4)

/** The color with its OKLCH lightness capped at `max`, chroma lowered until it fits sRGB. */
export function capLightness(hex: string, max: number): string {
  const [L0, C0, h] = toOklch(hex)
  const L = Math.min(L0, max)
  let C = C0
  if (!inGamut(oklchToLinear(L, C, h))) {
    let lo = 0
    let hi = C0
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid
      else hi = mid
    }
    C = lo
  }
  return rgbToHex(oklchToLinear(L, C, h).map(toGamma) as RGB)
}

// ── Contrast (WCAG 2) ───────────────────────────────────────────────────

export function luminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** `top` at `alpha` over `under`. */
export function over(top: RGB, alpha: number, under: RGB): RGB {
  return top.map((c, i) => c * alpha + under[i] * (1 - alpha)) as RGB
}

// ── The card's CSS variables ────────────────────────────────────────────

/** The colors in use: the user's pick, else those from the avatar or banner, else none (the cover accent). */
export const colorsOf = (profile: Profile) => profile.colors ?? profile.autoColors

export function profileColors(profile: Profile, withBackdrop: boolean): CSSProperties {
  const pair = colorsOf(profile)
  const vars: Record<string, string> = pair
    ? {
        '--pa-raw': pair[0],
        '--pb-raw': pair[1],
        '--pa': capLightness(pair[0], TOP_L),
        '--pb': capLightness(pair[1], BOTTOM_L),
        '--pc-accent': accentOf(pair[0]),
        '--pc-accent-2': accentOf(pair[1]),
      }
    : {
        // The accent over the theme's surface, or over the dark `--pc-ground` a light theme (Y2K) sets instead:
        // the card's text is white in every theme.
        '--pa-raw': 'var(--accent)',
        '--pb-raw': 'var(--pc-ground-2, var(--surface-2))',
        '--pa': 'color-mix(in oklab, var(--accent) 22%, var(--pc-ground, var(--surface)))',
        '--pb': 'var(--pc-ground, var(--surface))',
        '--pc-accent': 'var(--accent)',
        '--pc-accent-2': '#fff',
      }
  vars['--pc-ring'] = withBackdrop ? '#0d0d10' : vars['--pa']
  return vars as CSSProperties
}
