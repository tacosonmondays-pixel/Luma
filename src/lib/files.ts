// Import audio files from the device into the library.
import { create } from 'zustand'
import { addTrack, useLibrary } from './library.ts'

const AUDIO_EXTENSIONS = /\.(mp3|m4a|m4b|aac|wav|wave|flac|ogg|oga|opus|weba|webm|aif|aiff|aifc|caf|alac|mp4)$/i
const MP4_EXTENSIONS = /\.(m4a|m4b|mp4|aac|alac)$/i
/** yt-dlp's `[%(id)s]` in a file name. */
const VIDEO_ID = /\s*\[([A-Za-z0-9_-]{11})\](?=\.[^.]+$|$)/

export function isAudioFile(file: { name: string; type: string }): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name)
}

/** A CD rip's track number: "01 - ", "1. ", "01 ". Not "311 - " (a band) or "7 Rings" (a title). */
const TRACK_NUMBER = /^(?:\d{1,2}\s*[-–—.]|0\d)\s+/

/** "Artist - Title.mp3" → { artist, title }; anything else is all title. A leading track number is dropped. */
export function parseFileName(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[^./\\]+$/, '').replace(/_/g, ' ').trim().replace(TRACK_NUMBER, '')
  const match = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base)
  if (match) return { artist: match[1].trim(), title: match[2].trim() }
  return { title: base || name, artist: '' }
}

/** A stable id for an imported file, so importing the same file again finds the song already there.
 *  Name and size only: iOS gives picked files a new modification date each time. */
export function fileId(file: { name: string; size: number }): string {
  // cyrb53: a small 53-bit string hash.
  const key = `${file.name}|${file.size}`
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 'f-' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** "Artist - Title [dQw4w9WgXcQ].m4a" → the YouTube id, and the name without it. */
export function videoIdOf(name: string): { id: string | null; name: string } {
  const match = VIDEO_ID.exec(name)
  return match ? { id: match[1], name: name.replace(match[0], '') } : { id: null, name }
}

// ── MP4 metadata ─────────────────────────────────────────────────────────

export interface Tags {
  title?: string
  artist?: string
  cover?: Blob
  duration?: number // seconds
}

interface Box {
  type: string
  start: number // of the payload
  end: number
}

/** The boxes in view[from, to). */
function boxes(view: DataView, from: number, to: number): Box[] {
  const found: Box[] = []
  let at = from
  while (at + 8 <= to) {
    let size = view.getUint32(at)
    const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7))
    let header = 8
    if (size === 1) {
      if (at + 16 > to) break
      size = Number(view.getBigUint64(at + 8))
      header = 16
    } else if (size === 0) size = to - at
    if (size < header || at + size > to) break
    found.push({ type, start: at + header, end: at + size })
    at += size
  }
  return found
}

const child = (view: DataView, box: Box | undefined, type: string, skip = 0) =>
  box && boxes(view, box.start + skip, box.end).find((b) => b.type === type)

/** Read title, artist, cover and duration from an MP4/M4A `moov` box (moov/udta/meta/ilst, moov/mvhd). */
export function readMoov(moov: ArrayBuffer): Tags {
  const view = new DataView(moov)
  const root: Box = { type: 'moov', start: 0, end: moov.byteLength }
  const tags: Tags = {}

  const mvhd = child(view, root, 'mvhd')
  if (mvhd && mvhd.end - mvhd.start >= 32) {
    const v1 = view.getUint8(mvhd.start) === 1
    const scale = view.getUint32(mvhd.start + (v1 ? 20 : 12))
    const length = v1 ? Number(view.getBigUint64(mvhd.start + 24)) : view.getUint32(mvhd.start + 16)
    if (scale) tags.duration = length / scale
  }

  const meta = child(view, child(view, root, 'udta'), 'meta')
  // iTunes' meta is a full box (4 bytes of version and flags); QuickTime's isn't.
  const ilst = meta && (child(view, meta, 'ilst', 4) ?? child(view, meta, 'ilst'))
  if (!ilst) return tags
  for (const item of boxes(view, ilst.start, ilst.end)) {
    const data = child(view, item, 'data')
    if (!data || data.end - data.start < 8) continue
    const kind = view.getUint32(data.start) & 0xffffff
    const bytes = new Uint8Array(moov, data.start + 8, data.end - data.start - 8)
    if (item.type === '\xa9nam' && kind === 1) tags.title = new TextDecoder().decode(bytes).trim()
    else if (item.type === '\xa9ART' && kind === 1) tags.artist = new TextDecoder().decode(bytes).trim()
    else if (item.type === 'covr' && bytes.length && !tags.cover) {
      tags.cover = new Blob([bytes.slice()], { type: kind === 14 ? 'image/png' : 'image/jpeg' })
    }
  }
  return tags
}

/** Find the top-level `moov` box without reading the audio, and read its tags. */
export async function readTags(file: Blob): Promise<Tags> {
  let at = 0
  while (at + 8 <= file.size) {
    const head = new DataView(await file.slice(at, at + 16).arrayBuffer())
    let size = head.getUint32(0)
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7))
    let header = 8
    if (size === 1 && head.byteLength >= 16) {
      size = Number(head.getBigUint64(8))
      header = 16
    } else if (size === 0) size = file.size - at
    if (size < header) break
    if (type === 'moov') return readMoov(await file.slice(at + header, at + size).arrayBuffer())
    at += size
  }
  return {}
}

// ── Import ───────────────────────────────────────────────────────────────

/** True when the last import stopped early (storage full); Songs' Import button shows it until the next one. */
export const useImport = create<{ failed: boolean }>(() => ({ failed: false }))

/** Add audio files from the device to the library, on top of Songs in the order they were picked. Songs
 *  already in the library are skipped. Stops at the first file that can't be saved. */
export async function importFiles(files: File[]): Promise<void> {
  useImport.setState({ failed: false })
  let at = 0
  for (const file of files.filter(isAudioFile)) {
    const { id: videoId, name } = videoIdOf(file.name)
    const id = videoId ?? fileId(file)
    if (useLibrary.getState().tracks[id]) continue
    const tags = MP4_EXTENSIONS.test(file.name) ? await readTags(file).catch(() => ({}) as Tags) : {}
    const fromName = parseFileName(name)
    const title = tags.title || fromName.title
    const artist = tags.artist || fromName.artist
    const duration = Math.round(tags.duration ?? 0)
    try {
      await addTrack({ id, title, artist, duration, source: videoId ? 'youtube' : 'file', addedAt: Date.now() }, file, tags.cover, at++)
    } catch {
      useImport.setState({ failed: true })
      return
    }
  }
}
