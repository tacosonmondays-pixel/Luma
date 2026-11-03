// Avatar frames: the shapes of the SVG ones, in a 120×120 box whose center circle (radius 50) is the avatar.
// Decorations sit around radius 55, so nothing covers the face. Our own work.
import { FRAME_IDS, type FrameId } from '../../types.ts'

export const FRAMES: FrameId[] = [...FRAME_IDS]

const C = 60
const rad = (deg: number) => (deg * Math.PI) / 180
/** A point at `r` from the center, `deg` clockwise from the top. */
export const at = (r: number, deg: number): [number, number] => [C + r * Math.sin(rad(deg)), C - r * Math.cos(rad(deg))]
const round = (n: number) => Math.round(n * 100) / 100

/** A small, repeatable pseudo-random sequence, so frames look the same on every render. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
}

// ── Equalizer: 40 bars around the avatar ────────────────────────────────

export const EQ_BARS = (() => {
  const rand = seeded(7)
  return Array.from({ length: 40 }, (_, i) => ({ deg: i * 9, delay: round(-rand() * 0.8), alt: i % 2 === 1 }))
})()

// ── Laurel: 11 leaf pairs up each side ──────────────────────────────────

export interface Leaf {
  x: number
  y: number
  rotate: number
}

/** Leaves from the bottom up both sides; each pair leans out and in from the stem. */
export const LAUREL: { stems: string[]; leaves: Leaf[] } = (() => {
  const r = 55.5
  const leaves: Leaf[] = []
  const stems: string[] = []
  for (const side of [-1, 1]) {
    const from = 180 + side * -14 // just off the bottom
    const to = 180 + side * -150 // up near the top
    const [x0, y0] = at(r, from)
    const [x1, y1] = at(r, to)
    stems.push(`M${round(x0)} ${round(y0)}A${r} ${r} 0 0 ${side < 0 ? 1 : 0} ${round(x1)} ${round(y1)}`)
    for (let i = 0; i < 11; i++) {
      const deg = from + ((to - from) * (i + 0.5)) / 11
      const [x, y] = at(r, deg)
      // The direction of travel along the stem (towards the top): clockwise on the left, anticlockwise on the right.
      const tangent = deg + (side < 0 ? 90 : -90)
      for (const lean of [-38, 38]) leaves.push({ x: round(x), y: round(y), rotate: round(tangent + lean * side) })
    }
  }
  return { stems, leaves }
})()

/** One leaf, pointing up from its base at 0,0. */
export const LEAF = 'M0 0C2.6-2 2.8-5.4 0-8.6C-2.8-5.4-2.6-2 0 0Z'

// ── Blossoms: a branch with six flowers ─────────────────────────────────

export const BLOSSOM_BRANCHES = (() => {
  const arc = (r: number, a: number, b: number) => {
    const [x0, y0] = at(r, a)
    const [x1, y1] = at(r, b)
    return `M${round(x0)} ${round(y0)}A${r} ${r} 0 0 1 ${round(x1)} ${round(y1)}`
  }
  return [arc(56, 196, 292), arc(56, 30, 74)]
})()

export const BLOSSOMS = [
  { deg: 206, r: 56, size: 1.15 },
  { deg: 232, r: 57.5, size: 0.8 },
  { deg: 252, r: 55.5, size: 1.3 },
  { deg: 278, r: 57, size: 0.75 },
  { deg: 42, r: 56, size: 1 },
  { deg: 66, r: 57, size: 0.7 },
].map((b) => {
  const [x, y] = at(b.r, b.deg)
  return { x: round(x), y: round(y), size: b.size, rotate: b.deg }
})

/** Five petals around 0,0. */
export const PETALS = [0, 72, 144, 216, 288]

// ── Sparkles: a thin ring and nine four-point stars ─────────────────────

export const STAR = 'M0-1C.12-.3.3-.12 1 0C.3.12.12.3 0 1C-.12.3-.3.12-1 0C-.3-.12-.12-.3 0-1Z'

export const SPARKLES = (() => {
  const rand = seeded(11)
  return Array.from({ length: 9 }, (_, i) => {
    const deg = i * 40 + rand() * 18
    const [x, y] = at(53.5 + rand() * 4.5, deg)
    return { x: round(x), y: round(y), size: round(2.2 + rand() * 3.2), delay: round(-rand() * 2.4) }
  })
})()
