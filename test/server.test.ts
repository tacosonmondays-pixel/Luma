import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { api } from '../server/api.ts'

// A fake yt-dlp: logs its argv as one JSON line, then answers with canned data.
// Magic targets: "fail" exits 1, "garbage" prints invalid JSON, "slowslowslo" never finishes.
const FAKE_YTDLP = `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_YTDLP_LOG, JSON.stringify(args) + '\\n')
const target = args[args.length - 1]
const print = (value) => process.stdout.write(JSON.stringify(value))

if (args[0] === '--version') {
  console.log('2026.10.20')
} else if (target.includes('fail')) {
  console.error('  ERROR: boom  ')
  process.exit(1)
} else if (target.includes('garbage')) {
  process.stdout.write('this is not json')
} else if (target.includes('slowslowslo')) {
  setTimeout(() => {}, 60000)
} else if (args.includes('--dump-single-json')) {
  if (target.startsWith('ytsearch')) {
    print({ _type: 'playlist', id: target, title: target, entries: [
      { ie_key: 'Youtube', id: 'aaaaaaaaaaa', title: 'Song A', channel: 'Artist A', uploader: 'Up A', duration: 201.6 },
      { ie_key: 'YoutubeTab', id: 'UCaaaaaaaaaaaaaaaaaaaaaa', title: 'A channel' },
      { ie_key: 'YoutubeTab', id: 'ccccccccccc', title: 'Tab with a video-like id' },
      { ie_key: 'Youtube', id: 'short', title: 'Bad id' },
      null,
      { ie_key: 'Youtube', id: 'b-b_bbbbbbb', title: 'Song B', uploader: 'Uploader B' },
      { ie_key: 'Youtube', id: 'ddddddddddd', duration: null },
    ] })
  } else if (target.includes('list=')) {
    print({ _type: 'playlist', id: 'PL1', title: 'Road Trip', entries: [
      { ie_key: 'Youtube', id: 'eeeeeeeeeee', title: 'Track 1', channel: 'X', duration: 60 },
      { ie_key: 'Youtube', id: 'fffffffffff', title: 'Track 2', channel: 'Y', duration: 61 },
    ] })
  } else {
    print({ _type: 'video', id: 'dQw4w9WgXcQ', title: 'Never Gonna', channel: 'Rick', duration: 212.4 })
  }
} else {
  const out = args[args.indexOf('-o') + 1]
  const id = target.split('v=')[1]
  fs.writeFileSync(out.replace('%(id)s', id).replace('%(ext)s', 'm4a'), Buffer.from([1, 2, 3, 4, 5]))
}
`

const get = globalThis.fetch.bind(globalThis) // tests stub fetch; keep the real one for our own requests
let base = ''
let tmp = ''
let fake = ''
let log = ''
let server: Server

/** Every argv yt-dlp was called with since the last reset. */
const calls = (): string[][] =>
  readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))

const search = (query: Record<string, string>) => get(`${base}/api/search?${new URLSearchParams(query)}`)

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'luma-test-'))
  fake = join(tmp, 'yt-dlp.cjs')
  log = join(tmp, 'calls.log')
  writeFileSync(fake, FAKE_YTDLP, { mode: 0o755 })
  process.env.FAKE_YTDLP_LOG = log
  server = createServer((req, res) =>
    api(req, res, () => {
      res.statusCode = 299
      res.end('next')
    }),
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.close()
  rmSync(tmp, { recursive: true, force: true })
})

beforeEach(() => {
  process.env.LUMA_YTDLP = fake
  writeFileSync(log, '')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('health', () => {
  it('is null while yt-dlp is missing, then finds it, then caches it', async () => {
    process.env.LUMA_YTDLP = join(tmp, 'missing')
    let r = await get(`${base}/api/health`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, ytdlp: null })

    process.env.LUMA_YTDLP = fake
    r = await get(`${base}/api/health`)
    expect(await r.json()).toEqual({ ok: true, ytdlp: '2026.10.20' })
    expect(calls()).toEqual([['--version']])

    process.env.LUMA_YTDLP = join(tmp, 'missing')
    r = await get(`${base}/api/health`)
    expect(await r.json()).toEqual({ ok: true, ytdlp: '2026.10.20' })
    expect(calls()).toHaveLength(1)
  })
})

describe('search', () => {
  const flags = ['--flat-playlist', '--dump-single-json', '--no-warnings', '--playlist-end', '200', '--']

  it('searches by relevance by default and maps and filters the results', async () => {
    const r = await search({ q: '  daft punk  ' })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toMatch(/^application\/json/)
    expect(calls()).toEqual([[...flags, 'ytsearch30:daft punk']])
    expect(await r.json()).toEqual({
      results: [
        { id: 'aaaaaaaaaaa', title: 'Song A', channel: 'Artist A', duration: 202 },
        { id: 'b-b_bbbbbbb', title: 'Song B', channel: 'Uploader B', duration: 0 },
        { id: 'ddddddddddd', title: '', channel: '', duration: 0 },
      ],
    })
  })

  it('searches by date with sort=recent', async () => {
    expect((await search({ q: 'daft punk', sort: 'recent' })).status).toBe(200)
    expect(calls()).toEqual([[...flags, 'ytsearchdate30:daft punk']])
  })

  it('never lets a query be read as an option', async () => {
    expect((await search({ q: '--exec rm' })).status).toBe(200)
    expect(calls()).toEqual([[...flags, 'ytsearch30:--exec rm']])
  })

  it('passes a YouTube video link through as-is, ignoring sort', async () => {
    const r = await search({ q: 'https://youtu.be/dQw4w9WgXcQ?si=x', sort: 'recent' })
    expect(calls()).toEqual([[...flags, 'https://youtu.be/dQw4w9WgXcQ?si=x']])
    expect(await r.json()).toEqual({ results: [{ id: 'dQw4w9WgXcQ', title: 'Never Gonna', channel: 'Rick', duration: 212 }] })
  })

  it('returns the playlist title for a playlist link', async () => {
    const r = await search({ q: 'https://music.youtube.com/playlist?list=PL1' })
    expect(await r.json()).toEqual({
      playlist: 'Road Trip',
      results: [
        { id: 'eeeeeeeeeee', title: 'Track 1', channel: 'X', duration: 60 },
        { id: 'fffffffffff', title: 'Track 2', channel: 'Y', duration: 61 },
      ],
    })
  })

  it.each([
    ['no q', {}],
    ['an empty q', { q: '   ' }],
    ['a too-long q', { q: 'a'.repeat(501) }],
    ['a bad sort', { q: 'x', sort: 'popular' }],
    ['a non-YouTube link', { q: 'https://example.com/watch?v=dQw4w9WgXcQ' }],
    ['a look-alike host', { q: 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ' }],
    ['a broken link', { q: 'https://' }],
  ])('rejects %s with 400', async (_, query: Record<string, string>) => {
    const r = await search(query)
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'bad-request' })
    expect(calls()).toEqual([])
  })

  it('accepts a 500-character q', async () => {
    expect((await search({ q: 'a'.repeat(500) })).status).toBe(200)
  })

  it('answers 502 and logs stderr when yt-dlp fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await search({ q: 'fail please' })
    expect(r.status).toBe(502)
    expect(await r.json()).toEqual({ error: 'failed' })
    expect(error).toHaveBeenCalledWith(expect.stringContaining(': ERROR: boom'))
  })

  it('answers 502 when yt-dlp prints invalid JSON', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await search({ q: 'garbage' })
    expect(r.status).toBe(502)
    expect(await r.json()).toEqual({ error: 'failed' })
  })

  it('answers 503 ytdlp-missing when yt-dlp is not installed', async () => {
    process.env.LUMA_YTDLP = join(tmp, 'missing')
    const r = await search({ q: 'x' })
    expect(r.status).toBe(503)
    expect(await r.json()).toEqual({ error: 'ytdlp-missing' })
  })
})

describe('audio', () => {
  /** The temp dir yt-dlp was told to write into. */
  const outDir = () => dirname(calls()[0][calls()[0].indexOf('-o') + 1])

  it('downloads into a temp dir, streams the file and removes the dir', async () => {
    const r = await get(`${base}/api/audio/dQw4w9WgXcQ`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('audio/mp4')
    expect(r.headers.get('content-length')).toBe('5')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([1, 2, 3, 4, 5])

    const dir = outDir()
    expect(dirname(dir)).toBe(tmpdir())
    expect(calls()).toEqual([[
      '-f', 'bestaudio[ext=m4a]/bestaudio',
      '--no-playlist', '--no-progress', '--no-warnings',
      '--js-runtimes', `node:${process.execPath}`,
      '-o', join(dir, '%(id)s.%(ext)s'),
      '--', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ]])
    await vi.waitFor(() => expect(existsSync(dir)).toBe(false))
  })

  it('answers 502 and removes the temp dir when yt-dlp fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await get(`${base}/api/audio/failfailfai`)
    expect(r.status).toBe(502)
    expect(await r.json()).toEqual({ error: 'failed' })
    await vi.waitFor(() => expect(existsSync(outDir())).toBe(false))
  })

  it('kills yt-dlp and removes the temp dir when the client leaves early', async () => {
    const abort = new AbortController()
    const request = get(`${base}/api/audio/slowslowslo`, { signal: abort.signal }).catch(() => 'aborted')
    await vi.waitFor(() => expect(calls()).toHaveLength(1))
    const dir = outDir()
    expect(existsSync(dir)).toBe(true)
    abort.abort()
    expect(await request).toBe('aborted')
    // The dir is removed only after yt-dlp exits, and the fake would otherwise run for a minute.
    await vi.waitFor(() => expect(existsSync(dir)).toBe(false), { timeout: 3000 })
  })

  it.each(['short', 'dQw4w9WgXcQx', 'dQw4w9WgXc%3B'])('rejects the id %s with 400', async (id) => {
    const r = await get(`${base}/api/audio/${id}`)
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'bad-request' })
    expect(calls()).toEqual([])
  })
})

describe('cover', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

  it('falls back from maxresdefault to hqdefault', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/hqdefault.jpg') ? new Response(jpeg) : new Response('nope', { status: 404 }),
    )
    vi.stubGlobal('fetch', fetch)
    const r = await get(`${base}/api/cover/dQw4w9WgXcQ`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/jpeg')
    expect(r.headers.get('cache-control')).toBe('public, max-age=86400')
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(jpeg)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    ])
  })

  it('answers 404 when neither image exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    const r = await get(`${base}/api/cover/dQw4w9WgXcQ`)
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: 'not-found' })
  })

  it('rejects a bad id with 400', async () => {
    expect((await get(`${base}/api/cover/nope`)).status).toBe(400)
  })
})

describe('routing', () => {
  it.each(['/api/nope', '/api/health/x', '/api/audio', '/api/audio/dQw4w9WgXcQ/x'])('answers 404 for %s', async (path) => {
    const r = await get(base + path)
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: 'not-found' })
  })

  it.each(['/', '/index.html', '/api', '/apiary'])('calls next() for %s', async (path) => {
    const r = await get(base + path)
    expect(r.status).toBe(299)
    expect(await r.text()).toBe('next')
  })

  it('answers 405 for other methods', async () => {
    const r = await get(`${base}/api/health`, { method: 'POST' })
    expect(r.status).toBe(405)
    expect(r.headers.get('allow')).toBe('GET')
    expect(await r.json()).toEqual({ error: 'bad-request' })
  })
})
