// Colors from cover art: the app accent, the Now Playing wash and the Vinyl room tones.
//
// A cover is decoded once, shrunk to a few pixels and read in OKLCH (spec D1). The wash is a small, pre-softened
// bitmap (D2): the GPU only scales and moves it, so nothing is blurred live. Results are cached per blob version.

import { useEffect, useState } from 'react'
import { getBlob } from './blobs.ts'
import type { Version } from '../types.ts'

export interface CoverLook {
  accent?: string // '#rrggbb', undefined for grey covers (use the theme accent)
  wash: string // data URL of the softened 64×64 cover
  spots: string[] // softened, round crops of the cover that drift over the wash (Color style)
  tones?: [string, string] // two deep cover colors for the Vinyl room, undefined for grey covers
}

// ── Color math ──────────────────────────────────────────────────────────

export type Oklch = [l: number, c: number, h: number]
type Rgb = [r: number, g: number, b: number] // 0–255

const toLinear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const fromLinear = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export function rgbToOklch([r, g, b]: Rgb): Oklch {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const h = (Math.atan2(B, A) * 180) / Math.PI
  return [L, Math.hypot(A, B), h < 0 ? h + 360 : h]
}

/** Unclamped sRGB channels (0–255) for an OKLCH color; values outside 0–255 mean it is out of gamut. */
function oklchToRawRgb([L, C, h]: Oklch): Rgb {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

export function inGamut(lch: Oklch): boolean {
  return oklchToRawRgb(lch).every((v) => v >= -0.5 && v <= 255.5)
}

const hex2 = (v: number) =>
  Math.round(Math.min(255, Math.max(0, v)))
    .toString(16)
    .padStart(2, '0')

export const rgbToHex = ([r, g, b]: Rgb) => `#${hex2(r)}${hex2(g)}${hex2(b)}`

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace('#', '').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Lower chroma in 0.005 steps until the color fits sRGB, then return it as '#rrggbb'. */
export function fitHex([L, C, h]: Oklch): string {
  let c = C
  while (c > 0 && !inGamut([L, c, h])) c = Math.max(0, c - 0.005)
  return rgbToHex(oklchToRawRgb([L, c, h]))
}

/** WCAG contrast ratio of two '#rrggbb' colors. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = hexToRgb(hex).map(toLinear)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// ── Picking colors ──────────────────────────────────────────────────────

const ACCENT_L = 0.76
const GREY = 0.04 // below this chroma a cover counts as grey

interface Bin {
  w: number // total weight
  x: number // weighted hue vector, for the circular mean
  y: number
  c: number // weighted chroma sum
  l: number // weighted lightness sum
}

/** Sort RGBA pixels into 12 hue bins of 30°, weighted by C × (1 − |L − 0.6|). Heaviest first. */
function hueBins(pixels: ArrayLike<number>): Bin[] {
  const bins: Bin[] = Array.from({ length: 12 }, () => ({ w: 0, x: 0, y: 0, c: 0, l: 0 }))
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue
    const [L, C, h] = rgbToOklch([pixels[i], pixels[i + 1], pixels[i + 2]])
    if (L < 0.2 || L > 0.95) continue
    const w = C * (1 - Math.abs(L - 0.6))
    if (w <= 0) continue
    const bin = bins[Math.floor(h / 30) % 12]
    const rad = (h * Math.PI) / 180
    bin.w += w
    bin.x += w * Math.cos(rad)
    bin.y += w * Math.sin(rad)
    bin.c += w * C
    bin.l += w * L
  }
  return bins.filter((b) => b.w > 0).sort((a, b) => b.w - a.w)
}

const binColor = (b: Bin): Oklch => {
  const h = (Math.atan2(b.y, b.x) * 180) / Math.PI
  return [b.l / b.w, b.c / b.w, h < 0 ? h + 360 : h]
}

/** The accent for one hue: L 0.76, chroma clamped to 0.08–0.15, then fitted into sRGB. */
const accentFor = (C: number, h: number) => fitHex([ACCENT_L, Math.min(0.15, Math.max(0.08, C)), h])

/** The accent for a set of RGBA pixels (spec D1, steps 3–7), or undefined when they are grey. */
export function pickAccent(pixels: ArrayLike<number>): string | undefined {
  const [top] = hueBins(pixels)
  if (!top) return undefined
  const [, C, h] = binColor(top)
  return C < GREY ? undefined : accentFor(C, h)
}

/** Two colors (top, bottom) for a set of RGBA pixels: the two strongest hues at least 40° apart, else the
 * strongest hue at two lightnesses. Undefined when the pixels are grey. */
export function pickColors(pixels: ArrayLike<number>): [string, string] | undefined {
  const bins = hueBins(pixels)
  if (!bins.length) return undefined
  const first = binColor(bins[0])
  if (first[1] < GREY) return undefined
  const apart = (h: number) => {
    const d = Math.abs(h - first[2]) % 360
    return Math.min(d, 360 - d) >= 40
  }
  const second = bins
    .slice(1)
    .map(binColor)
    .find(([, C, h]) => C >= GREY && apart(h))
  if (second) return [fitHex(first), fitHex(second)]
  const [L, C, h] = first
  return [fitHex([Math.max(L, 0.62), C, h]), fitHex([Math.min(L, 0.42) - 0.08, C, h])]
}

/** The readable accent version of a color (OKLCH L 0.76, clipped to sRGB). Greys stay grey. */
export function accentOf(hex: string): string {
  const [, C, h] = rgbToOklch(hexToRgb(hex))
  return C < GREY ? fitHex([ACCENT_L, C, h]) : accentFor(C, h)
}

// ── Baking the wash ─────────────────────────────────────────────────────

const WASH = 64

/** Box blur, edges clamped, one horizontal and one vertical pass per round. */
function blur(px: Float32Array, size: number, radius: number, rounds: number) {
  const tmp = new Float32Array(px.length)
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let r = 0
        let g = 0
        let b = 0
        for (let k = -radius; k <= radius; k++) {
          const xx = horizontal ? Math.min(size - 1, Math.max(0, x + k)) : x
          const yy = horizontal ? y : Math.min(size - 1, Math.max(0, y + k))
          const j = (yy * size + xx) * 4
          r += src[j]
          g += src[j + 1]
          b += src[j + 2]
        }
        const i = (y * size + x) * 4
        const n = radius * 2 + 1
        dst[i] = r / n
        dst[i + 1] = g / n
        dst[i + 2] = b / n
        dst[i + 3] = src[i + 3]
      }
  }
  for (let p = 0; p < rounds; p++) {
    pass(px, tmp, true)
    pass(tmp, px, false)
  }
}

/** Richer color, and lightness pressed into a band that white text reads on. Plus ±1 of noise against banding. */
function tone(px: Float32Array) {
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255
    const g = px[i + 1] / 255
    const b = px[i + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    let l = (max + min) / 2
    let s = 0
    let h = 0
    if (max !== min) {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6
    }
    s = Math.min(1, s * 1.22 + 0.04)
    l = 0.12 + l * 0.54
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    const f = (t: number) => {
      t = (t + 1) % 1
      return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
    }
    px[i] = f(h + 1 / 3) * 255 + Math.random() * 2 - 1
    px[i + 1] = f(h) * 255 + Math.random() * 2 - 1
    px[i + 2] = f(h - 1 / 3) * 255 + Math.random() * 2 - 1
  }
}

function canvas(size: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return { c, ctx }
}

/** A 64×64 softened bitmap of part of the cover (fractions of the 96px sample). Round ones fade out at the edge,
 * so a turning copy never shows a corner. */
function bake(source: HTMLCanvasElement, crop: [number, number, number], round: boolean): string {
  const s = source.width
  const small = canvas(16)
  small.ctx.drawImage(source, crop[0] * s, crop[1] * s, crop[2] * s, crop[2] * s, 0, 0, 16, 16)
  const big = canvas(WASH)
  big.ctx.drawImage(small.c, 0, 0, WASH, WASH)
  const data = big.ctx.getImageData(0, 0, WASH, WASH)
  const px = new Float32Array(data.data)
  blur(px, WASH, 3, 2)
  tone(px)
  if (round)
    for (let y = 0; y < WASH; y++)
      for (let x = 0; x < WASH; x++) {
        const d = Math.hypot(x + 0.5 - WASH / 2, y + 0.5 - WASH / 2) / (WASH / 2)
        const a = Math.max(0, Math.min(1, (1 - d) / 0.55))
        px[(y * WASH + x) * 4 + 3] = 255 * a * a * (3 - 2 * a)
      }
  data.data.set(px)
  big.ctx.putImageData(data, 0, 0)
  return big.c.toDataURL('image/png')
}

/** Draw a blob center-cropped to a square at 96×96, then at 12×12 for the color sample. */
async function sample(blob: Blob): Promise<{ big: HTMLCanvasElement; pixels: Uint8ClampedArray }> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  const side = Math.min(bitmap.width, bitmap.height)
  const big = canvas(96)
  big.ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 96, 96)
  bitmap.close()
  const small = canvas(12)
  small.ctx.drawImage(big.c, 0, 0, 12, 12)
  return { big: big.c, pixels: small.ctx.getImageData(0, 0, 12, 12).data }
}

const SPOTS: [number, number, number][] = [
  [0, 0, 0.62],
  [0.38, 0.38, 0.62],
  [0.18, 0.3, 0.64],
]

/** Deep versions of the cover's two colors, for the Vinyl room. */
function roomTones(colors: [string, string] | undefined): [string, string] | undefined {
  if (!colors) return undefined
  return colors.map((hex) => {
    const [, C, h] = rgbToOklch(hexToRgb(hex))
    return fitHex([0.56, Math.min(0.16, Math.max(0.07, C)), h])
  }) as [string, string]
}

async function makeLook(blobKey: string): Promise<CoverLook | undefined> {
  const blob = await getBlob(blobKey)
  if (!blob) return undefined
  const { big, pixels } = await sample(blob)
  return {
    accent: pickAccent(pixels),
    wash: bake(big, [0, 0, 1], false),
    spots: SPOTS.map((crop) => bake(big, crop, true)),
    tones: roomTones(pickColors(pixels)),
  }
}

const cache = new Map<string, Promise<CoverLook | undefined>>()

/** The accent and wash for a stored cover, cached per blob version (the 64 most recent). */
export function coverLook(blobKey: string, v: number): Promise<CoverLook | undefined> {
  const key = `${blobKey}:${v}`
  let hit = cache.get(key)
  if (hit) {
    cache.delete(key) // move to the end: most recently used
  } else {
    hit = makeLook(blobKey).catch(() => undefined)
    if (cache.size >= 64) cache.delete(cache.keys().next().value!)
  }
  cache.set(key, hit)
  return hit
}

export function useCoverLook(blobKey: string, v: Version): CoverLook | undefined {
  const [look, setLook] = useState<{ key: string; look?: CoverLook }>()
  const key = `${blobKey}:${v}`
  useEffect(() => {
    if (v === undefined) return
    let live = true
    void coverLook(blobKey, v).then((l) => live && setLook({ key, look: l }))
    return () => {
      live = false
    }
  }, [blobKey, v, key])
  return v === undefined || look?.key !== key ? undefined : look.look
}

/** Two colors ('#rrggbb', top and bottom) for a profile image, or undefined for grey images. */
export async function imageColors(blob: Blob): Promise<[string, string] | undefined> {
  try {
    return pickColors((await sample(blob)).pixels)
  } catch {
    return undefined
  }
}
