const CACHE = 'luma-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-180.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
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
  else if (request.mode === 'navigate') event.respondWith(networkFirst(request))
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

async function networkFirst(request) {
  try {
    return await store('/', await fetch(request))
  } catch {
    return (await caches.match('/')) ?? Response.error()
  }
}

function staleWhileRevalidate(event) {
  const fresh = fetch(event.request).then((response) => store(event.request, response))
  event.waitUntil(fresh.catch(() => {}))
  return caches.match(event.request).then((cached) => cached ?? fresh)
}
