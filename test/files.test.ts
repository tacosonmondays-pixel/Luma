import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileId, importFiles, isAudioFile, parseFileName, readTags, useImport, videoIdOf } from '../src/lib/files.ts'
import { addTrack, useLibrary } from '../src/lib/library.ts'
import type { Track } from '../src/types.ts'

// The library lives in IndexedDB; here it is a plain object.
vi.mock('../src/lib/library.ts', () => {
  const state = { tracks: {} as Record<string, Track> }
  return {
    useLibrary: { getState: () => state },
    addTrack: vi.fn(async (track: Track) => void (state.tracks[track.id] = track)),
    isDownloaded: (track: Track | undefined) => !!track && !track.missing,
  }
})

// Made with ffmpeg: a 3 s sine with title, artist and a 64×64 JPEG cover, as yt-dlp --embed-metadata --embed-thumbnail
// writes them; and a 2 s sine with no tags.
const TAGGED = 'Rick Astley - Never Gonna Give You Up [dQw4w9WgXcQ].m4a'
const PLAIN = 'Daft Punk - One More Time.m4a'
const fixture = (name: string) => new File([readFileSync(new URL(`fixtures/${name}`, import.meta.url))], name, { type: 'audio/mp4' })
const COVER = readFileSync(new URL('fixtures/cover.jpg', import.meta.url))

describe('readTags', () => {
  it('reads title, artist, cover and duration from an M4A', async () => {
    const tags = await readTags(fixture(TAGGED))
    expect(tags.title).toBe('Never Gonna Give You Up')
    expect(tags.artist).toBe('Rick Astley')
    expect(tags.duration).toBeCloseTo(3, 1)
    expect(tags.cover?.type).toBe('image/jpeg')
    expect(Buffer.from(await tags.cover!.arrayBuffer()).equals(COVER)).toBe(true)
  })
  it('reads nothing from a file without tags', async () => {
    const tags = await readTags(fixture(PLAIN))
    expect(tags.title).toBeUndefined()
    expect(tags.cover).toBeUndefined()
    expect(await readTags(new File([new Uint8Array(100).fill(255)], 'x.m4a'))).toEqual({})
  })
})

describe('importFiles', () => {
  beforeEach(() => {
    vi.mocked(addTrack).mockClear()
    useLibrary.getState().tracks = {}
  })

  it('saves a yt-dlp download as that YouTube song, with its tags and cover', async () => {
    await importFiles([fixture(TAGGED)])
    const [track, , cover] = vi.mocked(addTrack).mock.calls[0]
    expect(track).toMatchObject({ id: 'dQw4w9WgXcQ', source: 'youtube', title: 'Never Gonna Give You Up', artist: 'Rick Astley', duration: 3 })
    expect(cover?.type).toBe('image/jpeg')
  })

  it('skips a YouTube song that is already saved', async () => {
    await importFiles([fixture(TAGGED)])
    await importFiles([fixture(TAGGED)])
    expect(addTrack).toHaveBeenCalledTimes(1)
  })

  it('falls back to the file name', async () => {
    await importFiles([fixture(PLAIN)])
    const [track, , cover] = vi.mocked(addTrack).mock.calls[0]
    expect(track).toMatchObject({ source: 'file', title: 'One More Time', artist: 'Daft Punk', duration: 2 })
    expect(track.id).toMatch(/^f-/)
    expect(cover).toBeUndefined()
  })

  it('skips a file that is already imported', async () => {
    await importFiles([fixture(PLAIN)])
    await importFiles([fixture(PLAIN)])
    expect(addTrack).toHaveBeenCalledTimes(1)
  })

  const mp3 = (name: string) => new File([new Uint8Array(name.length * 100)], name, { type: 'audio/mpeg' })

  it('puts the songs on top in the order they were picked', async () => {
    await importFiles([mp3('a.mp3'), mp3('bb.mp3'), mp3('ccc.mp3')])
    expect(vi.mocked(addTrack).mock.calls.map(([track, , , at]) => [track.title, at])).toEqual([
      ['a', 0],
      ['bb', 1],
      ['ccc', 2],
    ])
  })

  it('stops at the first song that cannot be saved, and says so until the next import', async () => {
    vi.mocked(addTrack).mockImplementationOnce(async (track) => void (useLibrary.getState().tracks[track.id] = track))
    vi.mocked(addTrack).mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
    await importFiles([mp3('a.mp3'), mp3('bb.mp3'), mp3('ccc.mp3')])
    expect(addTrack).toHaveBeenCalledTimes(2)
    expect(Object.values(useLibrary.getState().tracks).map((t) => t.title)).toEqual(['a'])
    expect(useImport.getState().failed).toBe(true)
    await importFiles([mp3('ccc.mp3')])
    expect(useImport.getState().failed).toBe(false)
  })
})

describe('fileId', () => {
  it('is the same for the same file and differs otherwise', () => {
    expect(fileId({ name: 'a.mp3', size: 1000 })).toBe(fileId({ name: 'a.mp3', size: 1000 }))
    expect(fileId({ name: 'a.mp3', size: 1000 })).toMatch(/^f-[0-9a-z]+$/)
    expect(fileId({ name: 'a.mp3', size: 1001 })).not.toBe(fileId({ name: 'a.mp3', size: 1000 }))
    expect(fileId({ name: 'b.mp3', size: 1000 })).not.toBe(fileId({ name: 'a.mp3', size: 1000 }))
  })
})

describe('parseFileName', () => {
  it('splits "Artist - Title"', () => {
    expect(parseFileName('Daft Punk - One More Time.mp3')).toEqual({ artist: 'Daft Punk', title: 'One More Time' })
    expect(parseFileName('A – B – C.flac')).toEqual({ artist: 'A', title: 'B – C' })
  })
  it('uses the whole name as the title otherwise', () => {
    expect(parseFileName('voice memo.m4a')).toEqual({ title: 'voice memo', artist: '' })
    expect(parseFileName('well-known.mp3')).toEqual({ title: 'well-known', artist: '' })
  })
  it('drops a leading track number', () => {
    expect(parseFileName('01 - Intro.mp3')).toEqual({ title: 'Intro', artist: '' })
    expect(parseFileName('1. Intro.mp3')).toEqual({ title: 'Intro', artist: '' })
    expect(parseFileName('07 Intro.flac')).toEqual({ title: 'Intro', artist: '' })
    expect(parseFileName('03 - Daft Punk - One More Time.mp3')).toEqual({ artist: 'Daft Punk', title: 'One More Time' })
  })
  it('keeps numbers that are names', () => {
    expect(parseFileName('311 - Amber.mp3')).toEqual({ artist: '311', title: 'Amber' })
    expect(parseFileName('50 Cent - In Da Club.mp3')).toEqual({ artist: '50 Cent', title: 'In Da Club' })
    expect(parseFileName('7 Rings.mp3')).toEqual({ title: '7 Rings', artist: '' })
    expect(parseFileName('99 Luftballons.mp3')).toEqual({ title: '99 Luftballons', artist: '' })
  })
})

describe('isAudioFile', () => {
  it('accepts by MIME type or extension', () => {
    expect(isAudioFile({ name: 'x', type: 'audio/mpeg' })).toBe(true)
    expect(isAudioFile({ name: 'x.M4A', type: '' })).toBe(true)
    expect(isAudioFile({ name: 'x.png', type: 'image/png' })).toBe(false)
  })
})

describe('videoIdOf', () => {
  it('takes the YouTube id out of a yt-dlp file name', () => {
    expect(videoIdOf('A - T [dQw4w9WgXcQ].m4a')).toEqual({ id: 'dQw4w9WgXcQ', name: 'A - T.m4a' })
    expect(videoIdOf('A - T [short].m4a')).toEqual({ id: null, name: 'A - T [short].m4a' })
    expect(videoIdOf('[dQw4w9WgXcQ] intro.m4a').id).toBe(null)
  })
})
