// Save to Luma (src/lib/save.ts): link parsing, saving songs without audio, linked playlists and their refresh,
// and how saved songs behave (queue, downloads). The real library runs on an in-memory IndexedDB stand-in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryStorage } from './client/mocks.ts'

const kv = vi.hoisted(() => new Map<string, unknown>())
vi.mock('idb-keyval', () => ({
  createStore: () => ({}),
  get: async (k: string) => kv.get(k),
  set: async (k: string, v: unknown) => void kv.set(k, v),
  del: async (k: string) => void kv.delete(k),
}))

const shortcuts: string[] = []
Object.assign(globalThis, {
  localStorage: new MemoryStorage(),
  sessionStorage: new MemoryStorage(),
  document: { addEventListener() {}, visibilityState: 'visible' },
  location: {
    set href(url: string) {
      shortcuts.push(url)
    },
  },
})

const { useLibrary } = await import('../src/lib/library.ts')
const { newIds, refreshPlaylist, saveLink, saveParam, savedTracks, targetOf } = await import('../src/lib/save.ts')
const { downloadMissing, downloadSaved, useSource } = await import('../src/lib/source.ts')
const { setYouTubeKey } = await import('../src/lib/youtube.ts')
const { useGoogle } = await import('../src/lib/google.ts')
const { playable } = await import('../src/lib/queue.ts')
const { useDownloads } = await import('../src/lib/helper.ts')

const VIDEO = 'dQw4w9WgXcQ'

describe('targetOf', () => {
  it('saves the video of a watch link, the playlist of a playlist link', () => {
    expect(targetOf(`https://www.youtube.com/watch?v=${VIDEO}`)).toEqual({ video: VIDEO })
    expect(targetOf(`https://youtu.be/${VIDEO}`)).toEqual({ video: VIDEO })
    expect(targetOf(`https://music.youtube.com/watch?v=${VIDEO}&list=PL1`)).toEqual({ video: VIDEO })
    expect(targetOf('https://www.youtube.com/playlist?list=PL1')).toEqual({ list: 'PL1' })
    expect(targetOf('https://music.youtube.com/playlist?list=OLAK5uy_x')).toEqual({ list: 'OLAK5uy_x' })
    expect(targetOf(`https://www.youtube.com/playlist?v=${VIDEO}&list=PL1`)).toEqual({ list: 'PL1' })
  })

  it('keeps only the video of a mix, and refuses what is not YouTube', () => {
    expect(targetOf(`https://www.youtube.com/watch?v=${VIDEO}&list=RD${VIDEO}`)).toEqual({ video: VIDEO })
    expect(targetOf('https://www.youtube.com/playlist?list=RDabc')).toBe(null)
    expect(targetOf(`https://example.com/watch?v=${VIDEO}`)).toBe(null)
    expect(targetOf('https://www.youtube.com/feed/library')).toBe(null)
    expect(targetOf('hello')).toBe(null)
  })
})

describe('saveParam', () => {
  it('reads an encoded link', () => {
    const u = `https://www.youtube.com/watch?v=${VIDEO}&list=PL1`
    expect(saveParam(`?u=${encodeURIComponent(u)}`)).toBe(u)
  })

  it('reads a link that was not encoded, with its own & and ?', () => {
    expect(saveParam('?u=https://www.youtube.com/playlist?list=PL1&si=xyz')).toBe('https://www.youtube.com/playlist?list=PL1&si=xyz')
    expect(targetOf(saveParam(`?u=https://www.youtube.com/watch?v=${VIDEO}&t=5`)!)).toEqual({ video: VIDEO })
  })

  it('is null without a link', () => {
    expect(saveParam('')).toBe(null)
    expect(saveParam('?x=1')).toBe(null)
  })
})

describe('savedTracks and newIds', () => {
  it('cleans titles and keeps the listing order newest first', () => {
    const tracks = savedTracks(
      [
        { id: 'aaaaaaaaaaa', title: 'Artist - Song (Official Video)', channel: 'ArtistVEVO', duration: 61 },
        { id: 'bbbbbbbbbbb', title: 'Other', channel: 'Chan', duration: 0 },
      ],
      1000,
    )
    expect(tracks).toEqual([
      { id: 'aaaaaaaaaaa', title: 'Song', artist: 'Artist', duration: 61, source: 'youtube', addedAt: 1000 },
      { id: 'bbbbbbbbbbb', title: 'Other', artist: 'Chan', duration: 0, source: 'youtube', addedAt: 999 },
    ])
  })

  it('adds only what the playlist lacks', () => {
    const r = (id: string) => ({ id, title: id, channel: '', duration: 0 })
    expect(newIds({ trackIds: ['a', 'b'] }, [r('b'), r('c'), r('c'), r('a'), r('d')])).toEqual(['c', 'd'])
  })
})

// ── The flows, against stubbed googleapis and helper responses ───────────

type Answer = unknown | ((url: URL) => unknown)
const answers: Record<string, Answer> = {}
const calls: URL[] = []
let helperUp = false

const video = (id: string, title = `Song ${id}`) => ({ id, snippet: { title, channelTitle: 'Chan' }, contentDetails: { duration: 'PT2M' } })

function stubFetch() {
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost:4848')
    calls.push(url)
    if (url.pathname.startsWith('/api/')) {
      if (!helperUp) throw new TypeError('offline')
      if (url.pathname === '/api/health') return Response.json({ ok: true, ytdlp: '2026.10.20' })
      if (url.pathname === '/api/search') return Response.json(answers.helperSearch)
      if (url.pathname.startsWith('/api/audio/')) return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' }))
      if (url.pathname.startsWith('/api/cover/')) return new Response(new Blob([new Uint8Array([9])], { type: 'image/jpeg' }))
    }
    const method = url.pathname.split('/').pop()!
    if ((init?.headers as Record<string, string> | undefined)?.Authorization === 'Bearer expired') return new Response('{}', { status: 401 })
    const answer = answers[method]
    return Response.json(typeof answer === 'function' ? (answer as (u: URL) => unknown)(url) : (answer ?? { items: [] }))
  })
}

function reset() {
  useLibrary.setState({ tracks: {}, order: [], playlists: [] })
  useSource.setState({ mode: null, importing: false })
  useDownloads.setState({}, true)
  useGoogle.setState({ token: null, expires: 0, connected: false })
  for (const k of Object.keys(answers)) delete answers[k]
  calls.length = 0
  shortcuts.length = 0
  kv.clear()
  helperUp = false
}

describe('saving without a downloader (phone mode, YouTube key)', () => {
  beforeEach(() => {
    reset()
    setYouTubeKey('KEY')
    stubFetch()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('saves a video as a song that is not downloaded', async () => {
    useLibrary.setState({ tracks: { old: { id: 'old', title: 'Old', artist: '', duration: 1, source: 'file', addedAt: 1 } }, order: ['old'] })
    answers.videos = { items: [video(VIDEO, 'Rick Astley - Never Gonna Give You Up (Official Video)')] }
    const saved = await saveLink(`https://www.youtube.com/watch?v=${VIDEO}&list=PL1`)
    expect(saved).toEqual({ playlistId: undefined, ids: [VIDEO] })
    const { tracks, order, playlists } = useLibrary.getState()
    expect(tracks[VIDEO]).toMatchObject({ title: 'Never Gonna Give You Up', artist: 'Rick Astley', duration: 120, missing: true })
    expect(order).toEqual([VIDEO, 'old'])
    expect(playlists).toEqual([])
    expect(kv.has(`audio:${VIDEO}`)).toBe(false)
    expect(calls.some((c) => c.pathname.endsWith('/playlistItems'))).toBe(false) // the video, not its playlist
  })

  it('makes a playlist link a linked Luma playlist, once', async () => {
    answers.playlistItems = { items: ['aaaaaaaaaaa', 'bbbbbbbbbbb'].map((videoId) => ({ contentDetails: { videoId } })) }
    answers.playlists = { items: [{ snippet: { title: 'Road Trip' } }] }
    answers.videos = (url: URL) => ({ items: url.searchParams.get('id')!.split(',').map((id) => video(id)) })
    const first = await saveLink('https://www.youtube.com/playlist?list=PL1')
    const again = await saveLink('https://music.youtube.com/playlist?list=PL1')
    expect(again.playlistId).toBe(first.playlistId)
    const { playlists, tracks, order } = useLibrary.getState()
    expect(playlists).toHaveLength(1)
    expect(playlists[0]).toMatchObject({ id: first.playlistId, name: 'Road Trip', youtubeId: 'PL1', trackIds: ['aaaaaaaaaaa', 'bbbbbbbbbbb'] })
    expect(order).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb'])
    expect(Object.values(tracks).every((t) => t.missing)).toBe(true)
  })

  it('refresh adds new songs as saved and never deletes local ones', async () => {
    answers.playlistItems = { items: [{ contentDetails: { videoId: 'aaaaaaaaaaa' } }] }
    answers.playlists = { items: [{ snippet: { title: 'Mine' } }] }
    answers.videos = (url: URL) => ({ items: url.searchParams.get('id')!.split(',').map((id) => video(id)) })
    const { playlistId } = await saveLink('https://www.youtube.com/playlist?list=PL2')
    // Locally: one song added by hand, and the YouTube one is downloaded meanwhile.
    useLibrary.setState((s) => ({
      tracks: {
        ...s.tracks,
        local: { id: 'local', title: 'Local', artist: '', duration: 1, source: 'file', addedAt: 1 },
        aaaaaaaaaaa: { ...s.tracks.aaaaaaaaaaa, missing: undefined },
      },
      playlists: s.playlists.map((p) => ({ ...p, trackIds: [...p.trackIds, 'local'] })),
    }))
    // YouTube now has a new song, and dropped the first.
    answers.playlistItems = { items: ['ccccccccccc', 'bbbbbbbbbbb'].map((videoId) => ({ contentDetails: { videoId } })) }
    expect(await refreshPlaylist(playlistId!)).toBe(2)
    const { playlists, tracks } = useLibrary.getState()
    expect(playlists[0].trackIds).toEqual(['aaaaaaaaaaa', 'local', 'ccccccccccc', 'bbbbbbbbbbb'])
    expect(tracks.aaaaaaaaaaa.missing).toBeUndefined()
    expect(tracks.ccccccccccc.missing).toBe(true)
    expect(await refreshPlaylist(playlistId!)).toBe(0)
  })

  it('reads with the sign-in token when there is one, and falls back when it expired', async () => {
    useGoogle.setState({ token: 'tok', expires: Date.now() + 3_600_000 })
    answers.playlistItems = { items: [{ contentDetails: { videoId: 'aaaaaaaaaaa' } }] }
    answers.videos = { items: [video('aaaaaaaaaaa')] }
    const { playlistId } = await saveLink('https://www.youtube.com/playlist?list=LLxyz')
    expect(calls.every((c) => !c.searchParams.has('key'))).toBe(true)
    expect(useLibrary.getState().playlists.find((p) => p.id === playlistId)?.name).toBe('YouTube Playlist')

    calls.length = 0
    useGoogle.setState({ token: 'expired', expires: Date.now() + 3_600_000 })
    await refreshPlaylist(playlistId!)
    expect(useGoogle.getState().token).toBe(null)
    expect(calls.at(-1)?.searchParams.get('key')).toBe('KEY')
  })

  it('rejects when the songs cannot be listed', async () => {
    setYouTubeKey('')
    await expect(saveLink(`https://www.youtube.com/watch?v=${VIDEO}`)).rejects.toMatchObject({ code: 'key' })
    await expect(saveLink('https://example.com/')).rejects.toMatchObject({ code: 'not-found' })
    expect(useLibrary.getState().order).toEqual([])
  })

  it('downloads saved songs through the Shortcut: one song, or a linked playlist whole', async () => {
    answers.videos = { items: [video(VIDEO)] }
    await saveLink(`https://www.youtube.com/watch?v=${VIDEO}`)
    expect(await downloadSaved(VIDEO)).toBe(false)
    expect(decodeURIComponent(shortcuts[0])).toContain(`text=https://www.youtube.com/watch?v=${VIDEO}`)
    downloadMissing([VIDEO], 'PL9')
    expect(decodeURIComponent(shortcuts[1])).toContain('text=https://www.youtube.com/playlist?list=PL9')
    downloadMissing([VIDEO], 'LL') // Liked videos are private: one song instead
    expect(decodeURIComponent(shortcuts[2])).toContain(`watch?v=${VIDEO}`)
  })
})

describe('saving with the helper', () => {
  beforeEach(() => {
    reset()
    helperUp = true
    stubFetch()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('downloads straight away, filling in the saved songs where they are', async () => {
    answers.helperSearch = {
      playlist: 'Road Trip',
      results: [
        { id: 'eeeeeeeeeee', title: 'Track 1', channel: 'X', duration: 60 },
        { id: 'fffffffffff', title: 'Track 2', channel: 'Y', duration: 61 },
      ],
    }
    const { playlistId } = await saveLink('https://www.youtube.com/playlist?list=PL1')
    const search = calls.find((c) => c.pathname === '/api/search')!
    expect(search.searchParams.get('q')).toBe('https://www.youtube.com/playlist?list=PL1')
    await vi.waitFor(() => expect(Object.values(useLibrary.getState().tracks).every((t) => !t.missing)).toBe(true))
    expect(kv.has('audio:eeeeeeeeeee') || calls.some((c) => c.pathname === '/api/audio/eeeeeeeeeee')).toBe(true)
    const { order, playlists, tracks } = useLibrary.getState()
    expect(order).toEqual(['eeeeeeeeeee', 'fffffffffff'])
    expect(playlists[0]).toMatchObject({ id: playlistId, name: 'Road Trip', youtubeId: 'PL1' })
    expect(tracks.eeeeeeeeeee).toMatchObject({ title: 'Track 1', artist: 'X', cover: expect.any(Number) })
  })
})

describe('saved songs', () => {
  it('are skipped by the queue', () => {
    const t = (id: string, missing?: true) => ({ id, title: id, artist: '', duration: 1, source: 'youtube' as const, addedAt: 1, missing })
    const tracks = { a: t('a'), b: t('b', true), c: t('c') }
    expect(playable(['a', 'b', 'c', 'gone'], tracks)).toEqual(['a', 'c'])
  })

  it('keep their place and name when downloaded', async () => {
    reset()
    const { addSyncedTracks, addTrack } = await import('../src/lib/library.ts')
    addSyncedTracks([{ id: 'x', title: 'Saved Name', artist: 'A', duration: 1, source: 'youtube', addedAt: 5 }])
    addSyncedTracks([{ id: 'y', title: 'Newer', artist: 'B', duration: 1, source: 'youtube', addedAt: 9 }])
    expect(useLibrary.getState().order).toEqual(['y', 'x'])
    await addTrack({ id: 'x', title: 'Download Name', artist: 'Z', duration: 2, source: 'youtube', addedAt: 99 }, new Blob(['a']))
    expect(useLibrary.getState().order).toEqual(['y', 'x'])
    expect(useLibrary.getState().tracks.x).toMatchObject({ title: 'Saved Name', duration: 2 })
    expect(useLibrary.getState().tracks.x.missing).toBeUndefined()
  })
})
