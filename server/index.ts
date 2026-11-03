// Luma's helper: serves the built app (dist/) and the /api routes. Run: node server/index.ts

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { api, ytdlpVersion } from './api.ts'

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const INDEX = join(DIST, 'index.html')
const ASSETS = join(DIST, 'assets/')
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
  if (!(await isFile(INDEX))) return send(res, 503, 'Run npm run build first')

  let path: string
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  } catch {
    return send(res, 400, 'Bad request')
  }
  let file = join(DIST, path)
  if (!file.startsWith(DIST)) return send(res, 404, 'Not found')
  if (!(await isFile(file))) {
    if (extname(path)) return send(res, 404, 'Not found')
    file = INDEX // an app route, e.g. /library
  }

  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': (await stat(file)).size,
    'Cache-Control': file.startsWith(ASSETS) ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (req.method === 'HEAD') return void res.end()
  await pipeline(createReadStream(file), res)
}

const isFile = (file: string) => stat(file).then((s) => s.isFile(), () => false)

function send(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
}

const server = createServer((req, res) =>
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
