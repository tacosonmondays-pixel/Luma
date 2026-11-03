// The app shell ('/' and the /assets/ files it loads) comes from Cache Storage, so Luma opens at once, also
// away from home. /api/ is never cached: downloaded songs live in IndexedDB.
const CACHE = 'luma-v1'
const FILES = ['/manifest.webmanifest', '/icon.svg', '/icon-180.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(cacheShell).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(request))
  else if (request.mode === 'navigate') event.respondWith(openShell(event))
  else event.respondWith(staleWhileRevalidate(event))
})

async function store(key, response) {
  if (response.status === 200 && response.type === 'basic') {
    await (await caches.open(CACHE)).put(key, response.clone())
  }
  return response
}

async function cacheFirst(request) {
  return (await caches.match(request)) ?? store(request, await fetch(request))
}

// Every page opens the cached shell without waiting for the network. A new build is fetched for the next launch.
async function openShell(event) {
  event.waitUntil(cacheShell().catch(() => {}))
  return (await caches.match('/')) ?? fetch(event.request)
}

// When '/' is a new build, cache it with the /assets/ files it loads, and drop the files of older builds
// (the previous build's stay, for a page that is still running it).
async function cacheShell() {
  const response = await fetch('/')
  if (!response.ok) throw new Error(`GET / answered ${response.status}`)
  const html = await response.clone().text()
  const cache = await caches.open(CACHE)
  const previous = (await (await cache.match('/'))?.text()) ?? ''
  if (html === previous) return
  const assets = assetsOf(html)
  await cache.addAll(assets)
  await cache.put('/', response)
  const keep = [...assets, ...assetsOf(previous)]
  for (const request of await cache.keys()) {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/assets/') && !keep.includes(pathname)) await cache.delete(request)
  }
}

const assetsOf = (html) => [...new Set(html.match(/\/assets\/[^"']+/g))]

function staleWhileRevalidate(event) {
  const fresh = fetch(event.request).then((response) => store(event.request, response))
  event.waitUntil(fresh.catch(() => {}))
  return caches.match(event.request).then((cached) => cached ?? fresh)
}
