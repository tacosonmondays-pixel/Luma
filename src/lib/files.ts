// Import audio files from the device into the library.
import { uid } from './format.ts'
import { addTrack } from './library.ts'

const AUDIO_EXTENSIONS = /\.(mp3|m4a|m4b|aac|wav|wave|flac|ogg|oga|opus|weba|webm|aif|aiff|aifc|caf|alac|mp4)$/i

export function isAudioFile(file: { name: string; type: string }): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name)
}

/** "Artist - Title.mp3" → { artist, title }; anything else is all title. */
export function parseFileName(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[^./\\]+$/, '').replace(/_/g, ' ').trim()
  const match = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base)
  if (match) return { artist: match[1].trim(), title: match[2].trim() }
  return { title: base || name, artist: '' }
}

/** Add audio files from the device to the library. */
export async function importFiles(files: File[]): Promise<void> {
  // addTrack puts each song on top, so go in reverse to keep the picked order.
  for (const file of files.filter(isAudioFile).reverse()) {
    const { title, artist } = parseFileName(file.name)
    await addTrack({ id: 'f-' + uid(), title, artist, duration: 0, source: 'file', addedAt: Date.now() }, file)
  }
}
