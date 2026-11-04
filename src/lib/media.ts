// Profile, Canvas and post media: checks a picked image, animated image or video, shrinks still images, and makes
// the still copy that lists and paused cards show. Decoding happens on detached elements and never touches the
// music <audio> element or the Media Session.
import type { MediaKind } from '../types.ts'

export type MediaSlot = 'avatar' | 'banner' | 'backdrop' | 'canvas' | 'post' | 'video'
export type MediaErrorCode = 'too-large' | 'too-long' | 'unsupported'

/** A processed pick: what gets stored under the slot's key, plus its `-still` copy for animations and videos. */
export interface Media {
  blob: Blob
  still?: Blob
  kind: MediaKind
  duration?: number // seconds, for a video
}

export class MediaError extends Error {
  code: MediaErrorCode
  constructor(code: MediaErrorCode) {
    super(code)
    this.code = code
  }
}

interface Limits {
  still: { width: number; height: number; quality: number; crop: boolean }
  /** Without it, an animated image becomes its first frame (a still image). */
  animated?: { bytes: number; maxWidth?: number; maxSide?: number; pixels: number }
  video?: { bytes: number; seconds: number; maxSide?: number }
  /** False: the slot takes videos only. */
  images?: false
}

const MB = 1024 * 1024

export const LIMITS: Record<MediaSlot, Limits> = {
  avatar: {
    still: { width: 512, height: 512, quality: 0.86, crop: true },
    animated: { bytes: 2 * MB, maxSide: 640, pixels: 16e6 },
  },
  banner: {
    still: { width: 1500, height: 500, quality: 0.85, crop: true },
    animated: { bytes: 4 * MB, maxWidth: 1200, pixels: 48e6 },
  },
  backdrop: {
    still: { width: 1080, height: 1350, quality: 0.82, crop: true },
    animated: { bytes: 4 * MB, maxWidth: 1080, pixels: 48e6 },
    video: { bytes: 8 * MB, seconds: 12, maxSide: 1920 },
  },
  // Shown full-bleed in either orientation, so a still is shrunk to fit (long side 1350) rather than cropped.
  canvas: {
    still: { width: 1350, height: 1350, quality: 0.82, crop: false },
    animated: { bytes: 4 * MB, maxWidth: 1080, pixels: 48e6 },
    video: { bytes: 8 * MB, seconds: 12 },
  },
  // A post's images: re-encoded (which drops EXIF, location included), never cropped; an animated one keeps its first frame.
  post: {
    still: { width: 1600, height: 1600, quality: 0.82, crop: false },
  },
  // A posted video is stored as it is, with sound (it plays muted until unmuted), but without its metadata (location
  // included: withoutMetadata), plus a still for lists.
  video: {
    still: { width: 1080, height: 1080, quality: 0.82, crop: false },
    video: { bytes: 50 * MB, seconds: 60 },
    images: false,
  },
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/apng': 'apng',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
}

/** The file extension the media bucket takes for this MIME type, if it takes it at all. */
export const extOf = (type: string): string | undefined => EXT[type]

// ── Reading the bytes (pure, tested) ─────────────────────────────────────

export interface ImageInfo {
  type: 'gif' | 'png' | 'webp' | 'other'
  width: number
  height: number
  frames: number
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))

/** GIF: walks the block structure and counts image descriptors (0x2C also occurs inside image data). */
export function gifInfo(b: Uint8Array): ImageInfo | undefined {
  if (b.length < 13 || !ascii(b, 0, 6).startsWith('GIF8')) return
  const width = b[6] | (b[7] << 8)
  const height = b[8] | (b[9] << 8)
  let at = 13
  if (b[10] & 0x80) at += 3 << ((b[10] & 7) + 1)
  const skipSubBlocks = () => {
    while (at < b.length) {
      const size = b[at++]
      if (size === 0) return
      at += size
    }
  }
  let frames = 0
  while (at < b.length) {
    const block = b[at++]
    if (block === 0x21) {
      at++ // label
      skipSubBlocks()
    } else if (block === 0x2c) {
      frames++
      const packed = b[at + 8]
      at += 9
      if (packed & 0x80) at += 3 << ((packed & 7) + 1)
      at++ // LZW minimum code size
      skipSubBlocks()
    } else break // 0x3B trailer, or a damaged file
  }
  return { type: 'gif', width, height, frames }
}

/** PNG: animated (APNG) when an acTL chunk comes before IDAT; the frame count is its num_frames. */
export function pngInfo(b: Uint8Array): ImageInfo | undefined {
  if (b.length < 24 || b[0] !== 0x89 || ascii(b, 1, 3) !== 'PNG') return
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  let frames = 1
  for (let at = 8; at + 8 <= b.length; ) {
    const length = view.getUint32(at)
    const type = ascii(b, at + 4, 4)
    if (type === 'IDAT') break
    if (type === 'acTL' && at + 12 <= b.length) frames = view.getUint32(at + 8)
    at += 12 + length
  }
  return { type: 'png', width, height, frames }
}

/** WebP: animated when the VP8X animation flag is set; frames are the ANMF chunks. */
export function webpInfo(b: Uint8Array): ImageInfo | undefined {
  if (b.length < 16 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return
  const u24 = (at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)
  const u32 = (at: number) => (u24(at) | (b[at + 3] << 24)) >>> 0
  let width = 0
  let height = 0
  let animated = false
  let frames = 0
  for (let at = 12; at + 8 <= b.length; ) {
    const type = ascii(b, at, 4)
    const size = u32(at + 4)
    const data = at + 8
    if (type === 'VP8X') {
      animated = !!(b[data] & 0x02)
      width = u24(data + 4) + 1
      height = u24(data + 7) + 1
    } else if (type === 'ANMF') frames++
    else if (type === 'VP8 ' && !width) {
      width = (b[data + 6] | (b[data + 7] << 8)) & 0x3fff
      height = (b[data + 8] | (b[data + 9] << 8)) & 0x3fff
    } else if (type === 'VP8L' && !width) {
      const bits = u32(data + 1)
      width = (bits & 0x3fff) + 1
      height = ((bits >> 14) & 0x3fff) + 1
    }
    at = data + size + (size & 1)
  }
  return { type: 'webp', width, height, frames: animated ? Math.max(frames, 1) : 1 }
}

export function imageInfo(b: Uint8Array): ImageInfo {
  return gifInfo(b) ?? pngInfo(b) ?? webpInfo(b) ?? { type: 'other', width: 0, height: 0, frames: 1 }
}

/** An MP4 or QuickTime box's type and extent, read from its header at `at`, or undefined when there is no well-formed
 * box there. `end` is where its parent ends (a size of 0 runs to it). */
function boxAt(b: Uint8Array, at: number, end: number): { type: string; size: number; body: number } | undefined {
  if (at + 8 > end || at + 8 > b.length) return
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let size = view.getUint32(at)
  let body = at + 8
  if (size === 1) {
    if (at + 16 > b.length) return
    size = Number(view.getBigUint64(at + 8))
    body = at + 16
  } else if (size === 0) size = end - at
  if (size < body - at || at + size > end) return
  return { type: ascii(b, at + 4, 4), size, body }
}

const METADATA = new Set(['udta', 'meta'])

/** A metadata box: where it starts, where its body starts (after the header) and where it ends. */
export interface Span {
  at: number
  body: number
  end: number
}

/** Where a `moov` box's metadata is: each `udta` and `meta` box in it and in its tracks. That's where the place a
 * video was filmed lives (©xyz, com.apple.quicktime.location.ISO6709), and the camera. */
export function metadataBoxes(moov: Uint8Array): Span[] {
  const found: Span[] = []
  const walk = (from: number, end: number, inTrack: boolean) => {
    for (let at = from; at < end; ) {
      const box = boxAt(moov, at, end)
      if (!box) return
      if (METADATA.has(box.type)) found.push({ at, body: box.body, end: at + box.size })
      else if (box.type === 'trak' && !inTrack) walk(box.body, at + box.size, true)
      at += box.size
    }
  }
  const top = boxAt(moov, 0, moov.length)
  if (top?.type === 'moov') walk(top.body, top.size, false)
  return found
}

/**
 * A video without its metadata: each `udta` and `meta` box at the top, in `moov` and in its tracks becomes a `free`
 * box of the same size, its body zeroed. Nothing moves (chunk offsets stay right), players skip it, and the bytes are
 * gone. Only the box headers and `moov` are read, not the media. MP4 and QuickTime; anything else, or a file it
 * can't walk, comes back as it is.
 */
export async function withoutMetadata(file: Blob): Promise<Blob> {
  if (file.type !== 'video/mp4' && file.type !== 'video/quicktime') return file
  const read = async (at: number, n: number) => new Uint8Array(await file.slice(at, at + n).arrayBuffer())
  const spans: Span[] = []
  for (let at = 0; at < file.size; ) {
    const box = boxAt(await read(at, 16), 0, file.size - at)
    if (!box) break
    if (METADATA.has(box.type)) spans.push({ at, body: at + box.body, end: at + box.size })
    else if (box.type === 'moov') spans.push(...metadataBoxes(await read(at, box.size)).map((m) => ({ at: at + m.at, body: at + m.body, end: at + m.end })))
    at += box.size
  }
  if (!spans.length) return file
  const parts: BlobPart[] = []
  let from = 0
  for (const { at, body, end } of spans.sort((a, b) => a.at - b.at)) {
    // Its size stays (and a 64-bit size's extra 8 bytes); the type becomes `free`; the body, zeros.
    parts.push(file.slice(from, at + 4), 'free', file.slice(at + 8, body), new Uint8Array(end - body))
    from = end
  }
  parts.push(file.slice(from))
  return new Blob(parts, { type: file.type })
}

/** The cap an animated image breaks in this slot, if any. A slot without animations keeps the first frame instead. */
export function checkAnimated(slot: MediaSlot, bytes: number, info: Pick<ImageInfo, 'width' | 'height' | 'frames'>): MediaErrorCode | undefined {
  const cap = LIMITS[slot].animated
  if (!cap) return
  const { width, height, frames } = info
  if (bytes > cap.bytes) return 'too-large'
  if (cap.maxSide && Math.max(width, height) > cap.maxSide) return 'too-large'
  if (cap.maxWidth && width > cap.maxWidth) return 'too-large'
  if (width * height * frames > cap.pixels) return 'too-large'
}

/** The cap a video breaks in this slot, if any. Avatar and banner take no video (it goes through the GIF maker), nor
 * does a post's image slot. */
export function checkVideo(slot: MediaSlot, bytes: number, video: { duration: number; width: number; height: number }): MediaErrorCode | undefined {
  const cap = LIMITS[slot].video
  if (!cap) return 'unsupported'
  if (!(video.duration > 0) || !video.width) return 'unsupported'
  if (video.duration > cap.seconds + 0.25) return 'too-long'
  if (bytes > cap.bytes) return 'too-large'
  if (cap.maxSide && Math.max(video.width, video.height) > cap.maxSide) return 'too-large'
}

/** The source rectangle and output size for a still: center-cropped to the slot's shape, never enlarged. */
export function stillPlan(slot: MediaSlot, width: number, height: number) {
  const target = LIMITS[slot].still
  let sx = 0
  let sy = 0
  let sw = width
  let sh = height
  if (target.crop) {
    const aspect = target.width / target.height
    if (width / height > aspect) {
      sw = Math.round(height * aspect)
      sx = Math.round((width - sw) / 2)
    } else {
      sh = Math.round(width / aspect)
      sy = Math.round((height - sh) / 2)
    }
  }
  const scale = Math.min(1, target.width / sw, target.height / sh)
  return { sx, sy, sw, sh, width: Math.max(1, Math.round(sw * scale)), height: Math.max(1, Math.round(sh * scale)), quality: target.quality }
}

// ── Decoding (browser) ───────────────────────────────────────────────────

type Drawable = HTMLImageElement | HTMLVideoElement | ImageBitmap

function encode(source: Drawable, plan: ReturnType<typeof stillPlan>): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = plan.width
  canvas.height = plan.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new MediaError('unsupported'))
  ctx.fillStyle = '#151518' // transparent PNGs shouldn't turn black
  ctx.fillRect(0, 0, plan.width, plan.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.width, plan.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.width = canvas.height = 0 // give the memory back now (iOS caps canvas memory)
      if (blob) resolve(blob)
      else reject(new MediaError('unsupported'))
    }, 'image/jpeg', plan.quality)
  })
}

/** An <img> applies the photo's EXIF orientation, and WebKit decodes huge photos subsampled when drawn smaller. */
async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  try {
    await img.decode()
    if (!img.naturalWidth) throw new Error('empty')
    return img
  } catch {
    throw new MediaError('unsupported')
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

async function stillOf(blob: Blob, slot: MediaSlot): Promise<Blob> {
  const img = await loadImage(blob)
  return encode(img, stillPlan(slot, img.naturalWidth, img.naturalHeight))
}

/** The first frame of an animated image. */
async function firstFrame(blob: Blob, slot: MediaSlot): Promise<Blob> {
  let source: Drawable
  try {
    source = await createImageBitmap(blob)
  } catch {
    source = await loadImage(blob)
  }
  const width = 'naturalWidth' in source ? source.naturalWidth : source.width
  const height = 'naturalHeight' in source ? source.naturalHeight : source.height
  try {
    return await encode(source, stillPlan(slot, width, height))
  } finally {
    if ('close' in source) source.close()
  }
}

function canPlay(type: string): boolean {
  if (type === 'video/webm') return !!document.createElement('video').canPlayType('video/webm; codecs="vp9"')
  return true // MP4 and MOV: whether this device decodes it shows when it loads
}

const once = (target: EventTarget, events: string[], ms: number) =>
  new Promise<string>((resolve) => {
    const done = (what: string) => {
      clearTimeout(timer)
      for (const e of events) target.removeEventListener(e, handler)
      resolve(what)
    }
    const handler = (e: Event) => done(e.type)
    const timer = setTimeout(() => done('timeout'), ms)
    for (const e of events) target.addEventListener(e, handler)
  })

/** Reads a video's length and size, and grabs a frame at 0.1 s as its still. */
async function readVideo(
  blob: Blob,
  slot: MediaSlot,
): Promise<{ duration: number; width: number; height: number; still: () => Promise<Blob>; release: () => void }> {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.preload = 'auto'
  video.src = url
  const cleanup = () => {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
  if ((await once(video, ['loadedmetadata', 'error'], 10000)) !== 'loadedmetadata' || !video.videoWidth) {
    cleanup()
    throw new MediaError('unsupported')
  }
  const still = async () => {
    try {
      video.currentTime = 0.1
      if ((await once(video, ['seeked', 'error'], 2000)) !== 'seeked') {
        // iOS may not load a detached video's frames until it plays.
        await video.play().catch(() => {})
        video.pause()
        video.currentTime = 0.1
        if ((await once(video, ['seeked', 'error'], 3000)) !== 'seeked') throw new MediaError('unsupported')
      }
      return await encode(video, stillPlan(slot, video.videoWidth, video.videoHeight))
    } finally {
      cleanup()
    }
  }
  return { duration: video.duration, width: video.videoWidth, height: video.videoHeight, still, release: cleanup }
}

/**
 * Turns a picked file into what a slot stores. Still images are shrunk to JPEG and never rejected; animated
 * images and videos are stored as they are, within the slot's caps (a video without its metadata). `made` marks a GIF the GIF maker just
 * produced, which its own limits already bound. Throws a MediaError.
 */
export async function processMedia(file: Blob, slot: MediaSlot, { made }: { made?: boolean } = {}): Promise<Media> {
  const type = file.type
  if (type.startsWith('video/')) {
    if (!LIMITS[slot].video || !canPlay(type)) throw new MediaError('unsupported')
    const video = await readVideo(file, slot)
    const error = checkVideo(slot, file.size, video)
    if (error) {
      video.release()
      throw new MediaError(error)
    }
    return { blob: await withoutMetadata(file), still: await video.still(), kind: 'video', duration: video.duration }
  }
  if ((type && !type.startsWith('image/')) || LIMITS[slot].images === false) throw new MediaError('unsupported')
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 64 * MB)).arrayBuffer())
  const info = imageInfo(bytes)
  if (info.frames > 1 && !LIMITS[slot].animated) return { blob: await firstFrame(file, slot), kind: 'image' }
  if (info.frames > 1) {
    const error = made ? undefined : checkAnimated(slot, file.size, info)
    if (error) throw new MediaError(error)
    const blob = file.type ? file : new Blob([file], { type: `image/${info.type}` })
    return { blob, still: await firstFrame(blob, slot), kind: 'animated' }
  }
  return { blob: await stillOf(file, slot), kind: 'image' }
}

/** One word for the editor's tile label. */
export function errorLabel(error: unknown): string {
  if (error instanceof MediaError) return { 'too-large': 'Too Large', 'too-long': 'Too Long', unsupported: 'Unsupported' }[error.code]
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'Storage Full'
  return 'Unsupported'
}
