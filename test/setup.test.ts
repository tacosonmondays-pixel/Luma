import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DENO_URL, YTDLP_URL, setup } from '../server/setup.ts'

let dir = ''
let lines: string[] = []
const log = (line: string) => void lines.push(line)

/** A fake fetch serving these bodies by URL; anything else is a 404. */
const serve = (files: Record<string, string>) =>
  vi.fn(async (url: string | URL | Request) => {
    const body = files[String(url)]
    return body === undefined ? new Response('nope', { status: 404 }) : new Response(body)
  })

/** A fake unzip: the "zip" holds the text of deno.exe. */
const unzip = vi.fn(async (zip: string, to: string) => writeFileSync(join(to, 'deno.exe'), readFileSync(zip)))

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'luma-setup-')), 'Luma', 'bin')
  lines = []
  unzip.mockClear()
})

afterEach(() => rmSync(join(dir, '..', '..'), { recursive: true, force: true }))

describe('setup', () => {
  it('makes the folder, downloads yt-dlp and Deno, and unzips Deno', async () => {
    const fetch = serve({ [YTDLP_URL]: 'yt-dlp binary', [DENO_URL]: 'deno binary' })
    await setup(dir, { fetch, unzip, log })
    expect(readFileSync(join(dir, 'yt-dlp.exe'), 'utf8')).toBe('yt-dlp binary')
    expect(readFileSync(join(dir, 'deno.exe'), 'utf8')).toBe('deno binary')
    expect(unzip).toHaveBeenCalledWith(join(dir, 'deno.zip'), dir)
    expect(readdirSync(dir).sort()).toEqual(['deno.exe', 'yt-dlp.exe']) // no zip or .part left
    expect(lines).toEqual(['Downloading yt-dlp', 'Downloading Deno'])
  })

  it('downloads nothing when both are there', async () => {
    await setup(dir, { fetch: serve({ [YTDLP_URL]: 'a', [DENO_URL]: 'b' }), unzip, log })
    lines = []
    const fetch = serve({})
    await setup(dir, { fetch, unzip, log })
    expect(fetch).not.toHaveBeenCalled()
    expect(lines).toEqual([])
  })

  it('downloads only what is missing', async () => {
    await setup(dir, { fetch: serve({ [YTDLP_URL]: 'a', [DENO_URL]: 'b' }), unzip, log })
    rmSync(join(dir, 'deno.exe'))
    const fetch = serve({ [DENO_URL]: 'new deno' })
    await setup(dir, { fetch, unzip, log })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([DENO_URL])
    expect(readFileSync(join(dir, 'deno.exe'), 'utf8')).toBe('new deno')
  })

  it('logs progress by quarter when the size is known', async () => {
    const chunk = new Uint8Array(250_000)
    const body = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(chunk)
        controller.close()
      },
    })
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url) === YTDLP_URL
        ? new Response(body, { headers: { 'content-length': '1000000' } })
        : new Response('deno'),
    )
    await setup(dir, { fetch, unzip, log })
    expect(lines.slice(0, 5)).toEqual(['Downloading yt-dlp (1 MB)', '  25%', '  50%', '  75%', '  100%'])
    expect(readFileSync(join(dir, 'yt-dlp.exe')).length).toBe(1_000_000)
  })

  it('throws on a failed download and leaves no file behind', async () => {
    await expect(setup(dir, { fetch: serve({}), unzip, log })).rejects.toThrow('could not download yt-dlp (HTTP 404)')
    expect(readdirSync(dir)).toEqual([])
  })

  it('leaves no partial file when the connection drops', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(10))
        controller.error(new Error('connection reset'))
      },
    })
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-length': '100' } }))
    await expect(setup(dir, { fetch, unzip, log })).rejects.toThrow('connection reset')
    expect(readdirSync(dir)).toEqual([])
  })

  it('throws when the Deno zip has no deno.exe, and removes the zip', async () => {
    const fetch = serve({ [YTDLP_URL]: 'a', [DENO_URL]: 'b' })
    await expect(setup(dir, { fetch, unzip: async () => {}, log })).rejects.toThrow('deno.exe was not in the Deno download')
    expect(existsSync(join(dir, 'deno.zip'))).toBe(false)
  })
})
