import { describe, expect, it } from 'vitest'
import { cleanTitle } from '../src/lib/titles.ts'

describe('cleanTitle', () => {
  it('splits "Artist - Title"', () => {
    expect(cleanTitle('Daft Punk - One More Time', 'Daft Punk')).toEqual({ title: 'One More Time', artist: 'Daft Punk' })
  })

  it('splits on en and em dashes', () => {
    expect(cleanTitle('Björk – Hyperballad', 'x')).toEqual({ title: 'Hyperballad', artist: 'Björk' })
    expect(cleanTitle('Björk — Hyperballad', 'x')).toEqual({ title: 'Hyperballad', artist: 'Björk' })
  })

  it('splits on the first dash only', () => {
    expect(cleanTitle('A - B - C', 'x')).toEqual({ title: 'B - C', artist: 'A' })
  })

  it('does not split hyphenated words', () => {
    expect(cleanTitle('Jay-Z Empire', 'Jay-Z')).toEqual({ title: 'Jay-Z Empire', artist: 'Jay-Z' })
  })

  it.each([
    'Song (Official Video)',
    'Song [Official Music Video]',
    'Song (Official Audio)',
    'Song (Lyrics)',
    'Song (Lyric Video)',
    'Song (Visualizer)',
    'Song (HD)',
    'Song [4K]',
    'Song [MV]',
    'Song (official music video) [HD]',
    'Song | Official Video',
    'Song | Official Music Video',
    'Song   (Official Video)  ',
  ])('strips noise from %j', (raw) => {
    expect(cleanTitle(raw, 'Chan').title).toBe('Song')
  })

  it('strips noise and splits together', () => {
    expect(cleanTitle('Adele - Hello (Official Music Video)', 'AdeleVEVO')).toEqual({ title: 'Hello', artist: 'Adele' })
  })

  it('keeps meaningful brackets', () => {
    expect(cleanTitle('Song (feat. Someone)', 'Chan').title).toBe('Song (feat. Someone)')
    expect(cleanTitle('Song (Live at Wembley)', 'Chan').title).toBe('Song (Live at Wembley)')
  })

  it('uses the channel without " - Topic" or "VEVO"', () => {
    expect(cleanTitle('Hello', 'Adele - Topic')).toEqual({ title: 'Hello', artist: 'Adele' })
    expect(cleanTitle('Hello', 'AdeleVEVO')).toEqual({ title: 'Hello', artist: 'Adele' })
    expect(cleanTitle('Hello', 'Adele VEVO')).toEqual({ title: 'Hello', artist: 'Adele' })
    expect(cleanTitle('Hello', 'Adele')).toEqual({ title: 'Hello', artist: 'Adele' })
  })

  it('trims', () => {
    expect(cleanTitle('  Hello  ', '  Adele  ')).toEqual({ title: 'Hello', artist: 'Adele' })
  })

  it('never returns an empty title', () => {
    expect(cleanTitle('', 'Chan').title).not.toBe('')
    expect(cleanTitle('   ', '').title).not.toBe('')
    expect(cleanTitle('(Official Video)', 'Chan').title).not.toBe('')
    expect(cleanTitle(' - ', 'Chan').title).not.toBe('')
  })
})
