// The helper API: search YouTube and fetch audio and covers, by shelling out to yt-dlp.
// Connect-style middleware, used by server/index.ts and by Vite's dev server.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { ApiError, Health, SearchResponse, SearchResult } from '../src/types.ts'

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']
const AUDIO_TYPES: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

/** Thrown to answer with an ApiError body. */
class Fail extends Error {
  status: number
  code: ApiError['error']
  constructor(status: number, code: ApiError['error']) {
    super(code)
    this.status = status
    this.code = code
  }
}

export function api(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const url = URL.parse(req.url ?? '/', 'http://localhost')
  if (!url?.pathname.startsWith('/api/')) return next()
  route(req, res, url).catch((e: unknown) => {
    if (res.destroyed) return // the client went away
    if (!(e instanceof Fail)) console.error(e)
    if (res.headersSent) return void res.destroy()
    const { status, code } = e instanceof Fail ? e : new Fail(502, 'failed')
    json(res, status, { error: code } satisfies ApiError)
  })
}

async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    throw new Fail(405, 'bad-request')
  }
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, ytdlp: await ytdlpVersion() } satisfies Health)
  if (url.pathname === '/api/search') return json(res, 200, await search(res, url.searchParams))
  const [, kind, id = ''] = /^\/api\/(audio|cover)\/([^/]*)$/.exec(url.pathname) ?? []
  if (!kind) throw new Fail(404, 'not-found')
  if (!VIDEO_ID.test(id)) throw new Fail(400, 'bad-request')
  return kind === 'audio' ? audio(res, id) : cover(res, id)
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

// ── Routes ──────────────────────────────────────────────────────────────

let version: string | null = null

/** The installed yt-dlp version, or null when it is missing. A found version is cached. */
export async function ytdlpVersion(): Promise<string | null> {
  version ??= await ytdlp(['--version'], 15_000).then(
    (r) => r.stdout.trim() || null,
    () => null,
  )
  return version
}

/** The parts of yt-dlp's JSON that we read. */
interface Info {
  _type?: string
  id?: unknown
  ie_key?: unknown
  title?: unknown
  channel?: unknown
  uploader?: unknown
  duration?: unknown
  entries?: (Info | null)[]
}

async function search(res: ServerResponse, params: URLSearchParams): Promise<SearchResponse> {
  const q = params.get('q')?.trim() ?? ''
  const sort = params.get('sort') ?? 'relevance'
  const isUrl = /^https?:\/\//i.test(q)
  const link = isUrl ? URL.parse(q) : null
  if (!q || q.length > 500 || (sort !== 'relevance' && sort !== 'recent')) throw new Fail(400, 'bad-request')
  if (isUrl && !YOUTUBE_HOSTS.includes(link?.hostname ?? '')) throw new Fail(400, 'bad-request')

  // Pass on the parsed link, not the raw text: yt-dlp parses links differently (e.g. `\`) and could see another host.
  const target = link ? link.href : `${sort === 'recent' ? 'ytsearchdate30' : 'ytsearch30'}:${q}`
  const args = ['--flat-playlist', '--dump-single-json', '--no-warnings', '--playlist-end', '200', '--', target]
  const { stdout, stderr } = await ytdlp(args, 30_000, res)
  let info: Info
  try {
    info = JSON.parse(stdout)
  } catch {
    console.error(`yt-dlp printed invalid JSON: ${stderr.trim()}`)
    throw new Fail(502, 'failed')
  }

  const entries = Array.isArray(info.entries) ? info.entries : [info]
  const results = entries.flatMap((e): SearchResult[] =>
    typeof e?.id === 'string' && VIDEO_ID.test(e.id) && e.ie_key !== 'YoutubeTab'
      ? [{
          id: e.id,
          title: String(e.title ?? ''),
          channel: String(e.channel ?? e.uploader ?? ''),
          duration: Math.round(Number(e.duration) || 0),
        }]
      : [],
  )
  return isUrl && info._type === 'playlist' ? { results, playlist: String(info.title ?? '') } : { results }
}

async function audio(res: ServerResponse, id: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'luma-'))
  try {
    await ytdlp(
      [
        '-f', 'bestaudio[ext=m4a]/bestaudio',
        '--no-playlist', '--no-progress', '--no-warnings',
        '--js-runtimes', `node:${process.execPath}`,
        '-o', join(dir, '%(id)s.%(ext)s'),
        '--', `https://www.youtube.com/watch?v=${id}`,
      ],
      10 * 60_000,
      res,
    )

    const [name] = await readdir(dir)
    if (!name) throw new Fail(502, 'failed')
    const file = join(dir, name)
    res.writeHead(200, {
      'Content-Type': AUDIO_TYPES[extname(name)] ?? 'application/octet-stream',
      'Content-Length': (await stat(file)).size,
      'Cache-Control': 'no-store',
    })
    await pipeline(createReadStream(file), res)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 })
  }
}

async function cover(res: ServerResponse, id: string): Promise<void> {
  for (const size of ['maxresdefault', 'hqdefault']) {
    const r = await fetch(`https://i.ytimg.com/vi/${id}/${size}.jpg`, { signal: AbortSignal.timeout(15_000) })
    if (!r.ok) continue
    const body = Buffer.from(await r.arrayBuffer())
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' })
    return void res.end(body)
  }
  throw new Fail(404, 'not-found')
}

// ── yt-dlp ──────────────────────────────────────────────────────────────

/**
 * Run yt-dlp, without a shell and without the user's yt-dlp config (it could add files or skip downloads).
 * Rejects with a Fail. It is killed after `ms`, or when `res` closes (the client left, or we are done).
 */
function ytdlp(args: string[], ms: number, res?: ServerResponse) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const command = process.env.LUMA_YTDLP || 'yt-dlp'
    const child = spawn(command, ['--ignore-config', ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const timer = setTimeout(() => {
      console.error(`yt-dlp timed out after ${ms / 1000} s`)
      child.kill()
    }, ms)
    res?.on('close', () => child.kill()) // killing an exited process does nothing
    if (res?.destroyed) child.kill()
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (s: string) => (stdout += s))
    child.stderr.setEncoding('utf8').on('data', (s: string) => (stderr += s))
    child.on('error', (e: NodeJS.ErrnoException) => {
      reject(e.code === 'ENOENT' ? new Fail(503, 'ytdlp-missing') : e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) return resolve({ stdout, stderr })
      // A null code means we killed it; a negative one means it never started ('error' rejected already).
      if ((code ?? 0) > 0) console.error(`yt-dlp exited with code ${code}: ${stderr.trim()}`)
      reject(new Fail(502, 'failed'))
    })
  })
}
