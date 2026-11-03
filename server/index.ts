// Luma's helper: serves the built app (dist/) and the /api routes. Run: node server/index.ts

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { api, ytdlpVersion } from './api.ts'

if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error(`Luma needs Node.js 22 or newer (this is ${process.version}).`)
  process.exit(1)
}

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

server.listen(Number(process.env.PORT || 4848), '0.0.0.0', async () => {
  const { port } = server.address() as AddressInfo
  const ips = Object.values(networkInterfaces())
    .flat()
    .flatMap((a) => (a?.family === 'IPv4' && !a.internal ? [a.address] : []))
  for (const host of ['localhost', ...ips]) console.log(`Luma → http://${host}:${port}`)
  const version = await ytdlpVersion()
  console.log(version ? `yt-dlp ${version}` : 'yt-dlp not found — install it: winget install yt-dlp (Windows) · brew install yt-dlp (macOS)')
})
