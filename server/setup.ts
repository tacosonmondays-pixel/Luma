// First run of Luma.exe on Windows: download yt-dlp, and Deno, the JavaScript runtime yt-dlp needs for YouTube.

import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

export const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
export const DENO_URL = 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip'

/** Where the tools live in `dir`. */
export const tools = (dir: string) => ({ ytdlp: join(dir, 'yt-dlp.exe'), deno: join(dir, 'deno.exe') })

interface Options {
  fetch?: typeof fetch
  /** Extracts a zip into a folder. */
  unzip?: (zip: string, dir: string) => Promise<unknown>
  log?: (line: string) => void
}

/** Downloads whichever tool is missing from `dir`. Throws when a download fails. */
export async function setup(dir: string, { fetch = globalThis.fetch, unzip = tar, log = console.log }: Options = {}) {
  const { ytdlp, deno } = tools(dir)
  await mkdir(dir, { recursive: true })
  if (!(await exists(ytdlp))) await download(fetch, YTDLP_URL, ytdlp, 'yt-dlp', log)
  if (!(await exists(deno))) {
    const zip = join(dir, 'deno.zip')
    await download(fetch, DENO_URL, zip, 'Deno', log)
    try {
      await unzip(zip, dir)
    } finally {
      await rm(zip, { force: true })
    }
    if (!(await exists(deno))) throw new Error('deno.exe was not in the Deno download')
  }
}

/** Downloads `url` to `file`, logging every quarter. Writes to a .part file first, so a cut-off download is never used. */
async function download(fetch: typeof globalThis.fetch, url: string, file: string, name: string, log: (line: string) => void) {
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error(`could not download ${name} (HTTP ${r.status})`)
  const total = Number(r.headers.get('content-length')) || 0
  log(total ? `Downloading ${name} (${Math.round(total / 1e6)} MB)` : `Downloading ${name}`)
  const part = `${file}.part`
  let done = 0
  let shown = 0
  try {
    await pipeline(
      Readable.fromWeb(r.body as ReadableStream<Uint8Array>),
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          done += chunk.length
          const quarter = total ? Math.floor((done / total) * 4) : 0
          if (quarter > shown) log(`  ${(shown = quarter) * 25}%`)
          yield chunk
        }
      },
      createWriteStream(part),
    )
    await rename(part, file)
  } finally {
    await rm(part, { force: true })
  }
}

// Windows 10 and later ship bsdtar, which reads zips. Call it by path: a tar on PATH (Git's) may not.
const tar = (zip: string, dir: string) =>
  promisify(execFile)(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dir], {
    windowsHide: true,
  })

const exists = (file: string) => access(file).then(() => true, () => false)
