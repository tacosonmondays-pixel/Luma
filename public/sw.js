// The app shell (the scope root and the assets/ files it loads) comes from Cache Storage, so Luma opens at once, also
// away from home. api/ is never cached: downloaded songs live in IndexedDB.
// Every path is relative to the scope: '/' from the helper, '/Luma/' on GitHub Pages.
const CACHE = 'luma-v1'
const ROOT = new URL(self.registration.scope).pathname
const ASSETS = ROOT + 'assets/'
const FILES = ['manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'].map((f) => ROOT + f)

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
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith(ROOT + 'api/')) return
  if (url.pathname.startsWith(ASSETS)) event.respondWith(cacheFirst(request))
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
  return (await caches.match(ROOT)) ?? fetch(event.request)
}

// When the root is a new build, cache it with the assets/ files it loads (and the fonts its stylesheets load), and
// drop the files of older builds (the previous build's stay, for a page that is still running it).
async function cacheShell() {
  const response = await fetch(ROOT)
  if (!response.ok) throw new Error(`GET ${ROOT} answered ${response.status}`)
  const html = await response.clone().text()
  const cache = await caches.open(CACHE)
  const previous = (await (await cache.match(ROOT))?.text()) ?? ''
  if (html === previous) return
  const assets = await withCssAssets(cache, assetsOf(html))
  await cache.put(ROOT, response)
  const old = assetsOf(previous)
  const keep = [...assets, ...old, ...(await cssAssets(cache, old))]
  for (const request of await cache.keys()) {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith(ASSETS) && !keep.includes(pathname)) await cache.delete(request)
  }
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const assetsOf = (html) => [...new Set(html.match(new RegExp(escape(ASSETS) + '[^"\']+', 'g')))]

// Caches the files and, for the stylesheets among them, the assets/ files they load (fonts), which index.html
// doesn't name.
async function withCssAssets(cache, assets) {
  await cache.addAll(assets)
  const extra = (await cssAssets(cache, assets)).filter((a) => !assets.includes(a))
  await cache.addAll(extra)
  return [...assets, ...extra]
}

// The assets/ files that the cached stylesheets among `assets` load. Vite writes them as paths relative to the
// stylesheet, or as absolute ones.
async function cssAssets(cache, assets) {
  const found = new Set()
  for (const path of assets.filter((a) => a.endsWith('.css'))) {
    const css = (await (await cache.match(path))?.text()) ?? ''
    for (const [, ref] of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      if (ref.startsWith('data:')) continue
      const { pathname } = new URL(ref, self.location.origin + path)
      if (pathname.startsWith(ASSETS)) found.add(pathname)
    }
  }
  return [...found]
}

function staleWhileRevalidate(event) {
  const fresh = fetch(event.request).then((response) => store(event.request, response))
  event.waitUntil(fresh.catch(() => {}))
  return caches.match(event.request).then((cached) => cached ?? fresh)
}
