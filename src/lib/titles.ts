// Turn a YouTube video title and channel into a song title and artist.

const NOISE = [
  'official',
  'music',
  'video',
  'audio',
  'lyrics?',
  'lyric',
  'visuali[sz]er',
  'hd',
  'hq',
  '4k',
  'mv',
  'm/v',
  'remastered',
  'color coded',
]
const WORDS = `(?:${NOISE.join('|')})`
/** A bracketed group made only of noise words, like "(Official Music Video)" or "[4K]". */
const BRACKETED = new RegExp(`\\s*[(\\[]\\s*${WORDS}(?:[\\s/&-]+${WORDS})*\\s*[)\\]]`, 'gi')
/** A trailing "| Official Video" style suffix. */
const PIPED = new RegExp(`\\s*\\|\\s*${WORDS}(?:[\\s/&-]+${WORDS})*\\s*$`, 'i')
const DASH = /\s+[-–—]\s+/

export function cleanTitle(videoTitle: string, channel: string): { title: string; artist: string } {
  const text = videoTitle.replace(BRACKETED, '').replace(PIPED, '').replace(/\s+/g, ' ').trim()
  const dash = DASH.exec(text)
  let title = text
  let artist = channel.replace(/\s+-\s+Topic$/i, '').replace(/\s*VEVO$/i, '').trim()
  if (dash) {
    const before = text.slice(0, dash.index).trim()
    const after = text.slice(dash.index + dash[0].length).trim()
    if (before && after) {
      artist = before
      title = after
    }
  }
  title = title.trim() || videoTitle.trim() || 'Untitled'
  return { title, artist }
}
