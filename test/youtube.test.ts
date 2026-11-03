import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// youtube.ts keeps the key in localStorage; Node has none.
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
})
const { decodeEntities, parseDuration, parseLink, search, setYouTubeKey, YouTubeError } = await import('../src/lib/youtube.ts')

describe('parseDuration', () => {
  it('reads ISO 8601 durations', () => {
    expect(parseDuration('PT3M33S')).toBe(213)
    expect(parseDuration('PT1H0M2S')).toBe(3602)
    expect(parseDuration('P1DT1S')).toBe(86401)
    expect(parseDuration('P0D')).toBe(0)
    expect(parseDuration(undefined)).toBe(0)
  })
})

describe('decodeEntities', () => {
  it('decodes what search.list escapes', () => {
    expect(decodeEntities('Rock &amp; Roll &quot;Live&quot; &#39;99 &#x263A; &bogus;')).toBe('Rock & Roll "Live" \'99 ☺ &bogus;')
  })
})

describe('parseLink', () => {
  it('finds videos and playlists in YouTube links', () => {
    expect(parseLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ video: 'dQw4w9WgXcQ', list: undefined })
    expect(parseLink('https://youtu.be/dQw4w9WgXcQ?t=1')).toEqual({ video: 'dQw4w9WgXcQ', list: undefined })
    expect(parseLink('https://music.youtube.com/playlist?list=PL123')).toEqual({ video: undefined, list: 'PL123' })
    expect(parseLink('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.video).toBe('dQw4w9WgXcQ')
    expect(parseLink('https://example.com/watch?v=dQw4w9WgXcQ')).toBe(null)
    expect(parseLink('never gonna give you up')).toBe(null)
  })
})

describe('search', () => {
  const calls: URL[] = []
  const answers: Record<string, unknown> = {}
  beforeEach(() => {
    setYouTubeKey('KEY')
    calls.length = 0
    vi.stubGlobal('fetch', async (input: string) => {
      const url = new URL(input)
      calls.push(url)
      const method = url.pathname.split('/').pop()!
      const answer = answers[method]
      if (answer instanceof Response) return answer
      return Response.json(typeof answer === 'function' ? answer(url) : answer)
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('searches, then reads durations', async () => {
    answers.search = { items: [
      { id: { videoId: 'aaaaaaaaaaa' }, snippet: { title: 'A &amp; B', channelTitle: 'Chan' } },
      { id: { videoId: 'bbbbbbbbbbb' }, snippet: { title: 'Live', channelTitle: 'C2' } },
    ] }
    answers.videos = { items: [{ id: 'aaaaaaaaaaa', contentDetails: { duration: 'PT1M1S' } }, { id: 'bbbbbbbbbbb', contentDetails: { duration: 'P0D' } }] }
    expect(await search('a b', 'popular')).toEqual({ results: [
      { id: 'aaaaaaaaaaa', title: 'A & B', channel: 'Chan', duration: 61 },
      { id: 'bbbbbbbbbbb', title: 'Live', channel: 'C2', duration: 0 },
    ] })
    expect(Object.fromEntries(calls[0].searchParams)).toEqual({ part: 'snippet', type: 'video', maxResults: '30', order: 'viewCount', q: 'a b', key: 'KEY' })
    expect(calls[1].searchParams.get('part')).toBe('contentDetails')
    expect(calls[1].searchParams.get('id')).toBe('aaaaaaaaaaa,bbbbbbbbbbb')
  })

  it('reads a playlist page by page, with its title', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `v${String(i).padStart(10, '0')}`)
    answers.playlistItems = (url: URL) => {
      const page = Number(url.searchParams.get('pageToken') || 0)
      return { items: ids.slice(page * 50, page * 50 + 50).map((videoId) => ({ contentDetails: { videoId } })), nextPageToken: page < 2 ? String(page + 1) : undefined }
    }
    answers.playlists = { items: [{ snippet: { title: 'Road Trip' } }] }
    answers.videos = (url: URL) => ({ items: url.searchParams.get('id')!.split(',').map((id) => ({ id, snippet: { title: id, channelTitle: 'X' }, contentDetails: { duration: 'PT1S' } })) })
    const r = await search('https://www.youtube.com/playlist?list=PL1', 'relevance')
    expect(r.playlist).toBe('Road Trip')
    expect(r.results.map((x) => x.id)).toEqual(ids)
    expect(calls.filter((c) => c.pathname.endsWith('/videos')).length).toBe(3)
  })

  it('reads a single video link', async () => {
    answers.videos = { items: [{ id: 'dQw4w9WgXcQ', snippet: { title: 'Never Gonna', channelTitle: 'Rick' }, contentDetails: { duration: 'PT3M32S' } }] }
    expect(await search('https://youtu.be/dQw4w9WgXcQ', 'recent')).toEqual({ results: [{ id: 'dQw4w9WgXcQ', title: 'Never Gonna', channel: 'Rick', duration: 212 }] })
  })

  it('tells a bad key from a used-up quota', async () => {
    const error = (status: number, reason: string) => Response.json({ error: { code: status, errors: [{ reason }] } }, { status })
    answers.search = error(400, 'keyInvalid')
    await expect(search('x', 'relevance')).rejects.toMatchObject({ code: 'key' })
    answers.search = error(403, 'quotaExceeded')
    await expect(search('x', 'relevance')).rejects.toMatchObject({ code: 'quota' })
    answers.search = error(403, 'forbidden')
    await expect(search('x', 'relevance')).rejects.toMatchObject({ code: 'key' })
    setYouTubeKey('')
    await expect(search('x', 'relevance')).rejects.toBeInstanceOf(YouTubeError)
  })
})
