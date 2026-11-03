import { describe, expect, it } from 'vitest'
import { isAudioFile, parseFileName } from '../src/lib/files.ts'

describe('parseFileName', () => {
  it('splits "Artist - Title"', () => {
    expect(parseFileName('Daft Punk - One More Time.mp3')).toEqual({ artist: 'Daft Punk', title: 'One More Time' })
    expect(parseFileName('A – B – C.flac')).toEqual({ artist: 'A', title: 'B – C' })
  })
  it('uses the whole name as the title otherwise', () => {
    expect(parseFileName('voice memo.m4a')).toEqual({ title: 'voice memo', artist: '' })
    expect(parseFileName('well-known.mp3')).toEqual({ title: 'well-known', artist: '' })
  })
})

describe('isAudioFile', () => {
  it('accepts by MIME type or extension', () => {
    expect(isAudioFile({ name: 'x', type: 'audio/mpeg' })).toBe(true)
    expect(isAudioFile({ name: 'x.M4A', type: '' })).toBe(true)
    expect(isAudioFile({ name: 'x.png', type: 'image/png' })).toBe(false)
  })
})
