// Colors from cover art: the app accent and the Now Playing wash. Placeholder — WP-A (Look) fills in the bodies.
import type { Version } from '../types.ts'

export interface CoverLook {
  accent?: string // '#rrggbb', undefined for grey covers (use the theme accent)
  wash: string // data URL of the softened 64×64 cover
}

export async function coverLook(_blobKey: string, _v: number): Promise<CoverLook | undefined> {
  return undefined
}

export function useCoverLook(_blobKey: string, _v: Version): CoverLook | undefined {
  return undefined
}

/** Two colors ('#rrggbb', top and bottom) for a profile image, or undefined for grey images. */
export async function imageColors(_blob: Blob): Promise<[string, string] | undefined> {
  return undefined
}

/** The readable accent version of a color (OKLCH L 0.76, clipped to sRGB). */
export function accentOf(hex: string): string {
  return hex
}
