// Luma's helper: serves the built app (dist/) and the /api routes. Run: node server/index.ts

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
// A namespace import: getAssetKeys only exists in newer Node 22 releases, and a named import of it would crash npm start there.
import * as sea from 'node:sea'
import { fileURLToPath } from 'node:url'
import { api, ytdlpVersion } from './api.ts'

// Luma.exe embeds the built app (see scripts/build-exe.mjs); otherwise it is read from dist/.
const SEA = sea.isSea()
const DIST = SEA ? '' : fileURLToPath(new URL('../dist/', import.meta.url))
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed')
  const index = await appFile('index.html')
  if (!index) return send(res, 503, 'Run npm run build first')

  let name: string
  try {
    name = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname).slice(1)
  } catch {
    return send(res, 400, 'Bad request')
  }
  let file = await appFile(name)
  if (!file) {
    if (extname(name)) return send(res, 404, 'Not found')
    name = 'index.html' // an app route, e.g. /library
    file = index
  }

  res.writeHead(200, {
    'Content-Type': TYPES[extname(name)] ?? 'application/octet-stream',
    'Content-Length': file.size,
    'Cache-Control': name.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (req.method === 'HEAD') return void res.end()
  await pipeline(file.open(), res)
}

/** A file of the built app by its path in dist/, such as "assets/index.js", or null. */
async function appFile(name: string): Promise<{ size: number; open: () => Readable } | null> {
  if (SEA) {
    if (!sea.getAssetKeys().includes(name)) return null
    const data = Buffer.from(sea.getRawAsset(name))
    return { size: data.length, open: () => Readable.from([data]) }
  }
  const file = join(DIST, name)
  if (!file.startsWith(DIST)) return null
  const info = await stat(file).catch(() => null)
  return info?.isFile() ? { size: info.size, open: () => createReadStream(file) } : null
}

function send(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
}

export const server = createServer((req, res) =>
  api(req, res, () => void serveStatic(req, res).catch(() => res.destroy())),
)

server.on('error', (e) => {
  console.error(`Luma could not start: ${e.message}`)
  process.exit(1)
})

// On Ctrl+C or a stop request, close every connection: that stops running downloads and removes their temp files.
// Luma then exits on its own. A second signal stops it at once.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(signal, () => {
    server.close()
    server.closeAllConnections()
  })
}

server.listen(Number(process.env.PORT || 4848), '0.0.0.0', async () => {
  const { port } = server.address() as AddressInfo
  console.log(`Luma → http://localhost:${port}`)
  // The phone needs https for the offline app; plain http on the LAN can't install it. See README.
  console.log(`iPhone → tailscale serve --bg ${port}`)
  const version = await ytdlpVersion()
  console.log(version ? `yt-dlp ${version}` : 'yt-dlp not found. Install it (winget install yt-dlp on Windows, brew install yt-dlp on macOS), then start Luma again from a new terminal.')
})
