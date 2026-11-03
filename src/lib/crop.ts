// Crop math for the profile's avatar, banner and Background. A crop is stored as data (a focus point and a zoom),
// never baked into the file, so it can be adjusted again and GIFs keep their animation.
//
// The media is scaled to cover its frame (like `object-fit: cover`), times `zoom`. The focus point sits at the
// frame's center unless that would leave an empty edge, in which case it is pushed back just enough. The card
// draws this with CSS (`cropStyle`, `.crop` in base.css) and the crop sheet with the same numbers in pixels, so
// both show exactly the same part of the image.
import { useState, type CSSProperties, type SyntheticEvent } from 'react'
import type { Crop } from '../types.ts'

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4
export const CENTER: Crop = { x: 0.5, y: 0.5, zoom: 1 }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The media's size at `zoom` in a fw×fh frame; `aspect` is the media's width / height. */
export function coverSize(aspect: number, fw: number, fh: number, zoom = 1): { w: number; h: number } {
  const w = Math.max(fw, fh * aspect) * zoom
  return { w, h: w / aspect }
}

/** Zoom kept in 1..4 and the focus kept where the media still covers the whole frame. */
export function clampCrop(crop: Crop | undefined, aspect: number, fw: number, fh: number): Crop {
  const c = crop ?? CENTER
  const zoom = clamp(Number.isFinite(c.zoom) ? c.zoom : 1, MIN_ZOOM, MAX_ZOOM)
  const { w, h } = coverSize(aspect, fw, fh, zoom)
  const hx = fw / 2 / w
  const hy = fh / 2 / h
  return { x: clamp(Number.isFinite(c.x) ? c.x : 0.5, hx, 1 - hx), y: clamp(Number.isFinite(c.y) ? c.y : 0.5, hy, 1 - hy), zoom }
}

/** Where the media's top-left corner sits inside the frame, and its size, in the frame's units. */
export function cropOffset(crop: Crop | undefined, aspect: number, fw: number, fh: number): { left: number; top: number; w: number; h: number } {
  const c = clampCrop(crop, aspect, fw, fh)
  const { w, h } = coverSize(aspect, fw, fh, c.zoom)
  return { left: fw / 2 - c.x * w, top: fh / 2 - c.y * h, w, h }
}

/** Moves the media by (dx, dy) frame units. */
export function panBy(crop: Crop, aspect: number, fw: number, fh: number, dx: number, dy: number): Crop {
  const { w, h } = coverSize(aspect, fw, fh, crop.zoom)
  return clampCrop({ x: crop.x - dx / w, y: crop.y - dy / h, zoom: crop.zoom }, aspect, fw, fh)
}

/** Zooms to `zoom`, keeping the point at (px, py) from the frame's center where it is on screen. */
export function zoomAt(crop: Crop, aspect: number, fw: number, fh: number, zoom: number, px = 0, py = 0): Crop {
  const from = clampCrop(crop, aspect, fw, fh)
  const before = coverSize(aspect, fw, fh, from.zoom)
  const to = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
  const after = coverSize(aspect, fw, fh, to)
  // The source point under (px, py), measured from the frame's center.
  const ux = from.x + px / before.w
  const uy = from.y + py / before.h
  return clampCrop({ x: ux - px / after.w, y: uy - py / after.h, zoom: to }, aspect, fw, fh)
}

/** Undefined when the crop is (about) centered at 1×, so an untouched slot stores nothing. */
export function storedCrop(crop: Crop | undefined): Crop | undefined {
  if (!crop) return undefined
  const near = (a: number, b: number) => Math.abs(a - b) < 0.001
  if (near(crop.zoom, 1) && near(crop.x, 0.5) && near(crop.y, 0.5)) return undefined
  const r = (n: number) => Math.round(n * 10000) / 10000
  return { x: r(crop.x), y: r(crop.y), zoom: r(crop.zoom) }
}

/** The style for a `.crop` image or video inside a `.crop-box`: the same math as `cropOffset`, done by CSS against
 * the box's own size, so it holds at any card width and height. Undefined (plain cover) until the aspect is known. */
export function cropStyle(crop: Crop | undefined, aspect: number | undefined): CSSProperties | undefined {
  if (!crop || !aspect) return undefined
  return { '--ca': aspect, '--cx': crop.x, '--cy': crop.y, '--cz': clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM) } as CSSProperties
}

/** Props for a cropped `<img>` or `<video>` inside a `.crop-box`: they measure the media's aspect once it loads and
 * then place it with `cropStyle`. Without a crop the media stays a plain centered cover. */
export function useCrop(crop: Crop | undefined, className?: string) {
  const [aspect, setAspect] = useState<number>()
  const measure = (el: HTMLImageElement | HTMLVideoElement) => {
    const [w, h] = el instanceof HTMLVideoElement ? [el.videoWidth, el.videoHeight] : [el.naturalWidth, el.naturalHeight]
    if (w && h) setAspect(w / h)
  }
  const style = cropStyle(crop, aspect)
  return {
    className: [className, style && 'crop'].filter(Boolean).join(' ') || undefined,
    style,
    onLoad: (e: SyntheticEvent<HTMLImageElement | HTMLVideoElement>) => measure(e.currentTarget),
    onLoadedMetadata: (e: SyntheticEvent<HTMLImageElement | HTMLVideoElement>) => measure(e.currentTarget),
  }
}
