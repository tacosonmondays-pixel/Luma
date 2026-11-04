// End-to-end check of Save to Luma in the app: /save links, saved songs, Download Missing, linked playlists with
// Refresh from YouTube, the iOS shell's luma://save routing, and Connect YouTube. Runs the dev server with the
// fake yt-dlp (test/e2e/fake-yt-dlp.cjs); googleapis, Google's sign-in script and thumbnails are stubbed.
//
//   node test/e2e/app.mjs [screenshot dir]
//
// Not part of `npm run check` (it needs a browser and a free port 4848).
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const { chromium } = createRequire(import.meta.url)('playwright')
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const shots = process.argv[2]
const work = mkdtempSync(join(tmpdir(), 'luma-e2e-'))
const listingFile = join(work, 'listing.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (name) => console.log(`✓ ${name}`)
const BASE = 'http://localhost:4848'

// "YouTube": one playlist, as yt-dlp and the Data API would list it.
const SONGS = [
  { id: 'aaaaaaaaaaa', title: 'Daft Punk - One More Time (Official Video)', channel: 'Daft Punk', duration: 320 },
  { id: 'bbbbbbbbbbb', title: 'Fleetwood Mac - Dreams (Official Music Video)', channel: 'Fleetwood Mac', duration: 257 },
  { id: 'ccccccccccc', title: 'The Weeknd - Blinding Lights (Official Audio)', channel: 'TheWeekndVEVO', duration: 201 },
  { id: 'ddddddddddd', title: 'Tame Impala - The Less I Know The Better', channel: 'Tame Impala', duration: 218 },
]
const NEW_SONG = { id: 'eeeeeeeeeee', title: 'Phoenix - 1901 (Official Video)', channel: 'Phoenix', duration: 193 }
const SINGLE = { id: 'fffffffffff', title: 'Kate Bush - Running Up That Hill', channel: 'Kate Bush', duration: 298 }
let youtube = { title: 'Road Trip', entries: SONGS, extra: [SINGLE] }
const publish = () => writeFileSync(listingFile, JSON.stringify(youtube))
publish()

// ── The dev server, with the fake yt-dlp ─────────────────────────────────
const server = spawn(join(root, 'node_modules/.bin/vite'), ['--port', '4848', '--strictPort'], {
  cwd: root,
  env: { ...process.env, LUMA_YTDLP: join(here, 'fake-yt-dlp.cjs'), FAKE_YTDLP_LISTING: listingFile },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += d))
server.stderr.on('data', (d) => (serverLog += d))
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break
  } catch {}
  if (i > 100) throw new Error(`dev server did not start\n${serverLog}`)
  await sleep(200)
}

const browser = await chromium.launch()

// ── Stubs ────────────────────────────────────────────────────────────────
const apiCalls = []
const thumb = readFileSync(join(root, 'test/fixtures/cover.jpg'))

/** googleapis as the Data API answers for the same "YouTube", by key or by the owner's token. */
async function googleapis(route) {
  const req = route.request()
  const url = new URL(req.url())
  const method = url.pathname.split('/').pop()
  apiCalls.push({ method, params: Object.fromEntries(url.searchParams), auth: req.headers().authorization })
  const all = [...youtube.entries, ...youtube.extra]
  const video = (s) => ({ id: s.id, snippet: { title: s.title, channelTitle: s.channel }, contentDetails: { duration: `PT${Math.floor(s.duration / 60)}M${s.duration % 60}S` } })
  const LIKES = ['bbbbbbbbbbb', 'fffffffffff']
  const json = (body) => route.fulfill({ json: body })
  if (method === 'channels') return json({ items: [{ contentDetails: { relatedPlaylists: { likes: 'LLowner' } } }] })
  if (method === 'playlists' && url.searchParams.get('mine')) {
    return json({ items: [
      { id: 'PLroad', snippet: { title: 'Road Trip', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg' } } } },
      { id: 'PLchill', snippet: { title: 'Sunday Morning &amp; Coffee', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/ddddddddddd/mqdefault.jpg' } } } },
      { id: 'PLgym', snippet: { title: 'Gym', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/ccccccccccc/mqdefault.jpg' } } } },
    ] })
  }
  if (method === 'playlists') return json({ items: url.searchParams.get('id') === 'LLowner' ? [] : [{ snippet: { title: youtube.title } }] })
  if (method === 'playlistItems') {
    const ids = url.searchParams.get('playlistId') === 'LLowner' ? LIKES : youtube.entries.map((e) => e.id)
    return json({ items: ids.map((videoId) => ({ contentDetails: { videoId } })) })
  }
  if (method === 'videos') return json({ items: url.searchParams.get('id').split(',').map((id) => all.find((s) => s.id === id)).filter(Boolean).map(video) })
  return route.fulfill({ status: 404, json: { error: { errors: [{ reason: 'notFound' }] } } })
}

// Google Identity Services, reduced to the token client: "signing in" answers with a token.
const FAKE_GIS = `window.google = { accounts: { oauth2: {
  initTokenClient(config) { window.__gis = config; return { requestAccessToken(o) { window.__gisPrompt = o && o.prompt; setTimeout(() => config.callback({ access_token: 'owner-token', expires_in: 3599 }), 80) } } },
  revoke(token, done) { window.__revoked = token; done && done() },
} } }`

async function newContext({ helper, google = false, key = true }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript((k) => k && localStorage.setItem('luma-youtube-key', k), key ? 'KEY' : '')
  await context.route('https://www.googleapis.com/youtube/v3/**', googleapis)
  await context.route('https://i.ytimg.com/**', (r) => r.fulfill({ contentType: 'image/jpeg', body: thumb }))
  await context.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_GIS }))
  if (!helper) await context.route(`${BASE}/api/**`, (r) => r.abort()) // phone mode: no helper
  if (google)
    await context.route(/\/src\/lib\/google-config\.ts/, (r) =>
      r.fulfill({ contentType: 'text/javascript', body: "export const GOOGLE_CLIENT_ID = 'test.apps.googleusercontent.com'" }),
    )
  return context
}

async function shoot(page, name) {
  if (!shots) return
  for (const [w, h, tag] of [[393, 852, 'iphone'], [1440, 900, 'desktop']]) {
    await page.setViewportSize({ width: w, height: h })
    await sleep(350)
    await page.screenshot({ path: join(shots, `${name}-${tag}.png`) })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

const saveUrl = (u) => `${BASE}/save?u=${encodeURIComponent(u)}`
const library = (page) => page.evaluate(async () => {
  const { useLibrary } = await import('/src/lib/library.ts')
  const { tracks, order, playlists } = useLibrary.getState()
  return { tracks, order, playlists }
})

try {
  // ── Phone mode: songs are saved, not downloaded ───────────────────────
  {
    const context = await newContext({ helper: false })
    const page = await context.newPage()
    // One song already downloaded, so saved songs sit next to a normal one.
    await page.goto(BASE)
    await page.evaluate(async () => {
      const { addTrack } = await import('/src/lib/library.ts')
      const audio = await (await fetch('/test/fixtures/Rick Astley - Never Gonna Give You Up [dQw4w9WgXcQ].m4a')).blob()
      const cover = await (await fetch('/test/fixtures/cover.jpg')).blob()
      await addTrack({ id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', artist: 'Rick Astley', duration: 213, source: 'youtube', addedAt: 1 }, audio, cover)
    })

    await page.goto(saveUrl('https://www.youtube.com/playlist?list=PLroad'))
    await page.waitForURL(/\/playlist\//)
    await page.locator('.playlist-name').waitFor()
    assert.equal(await page.locator('.playlist-name').inputValue(), 'Road Trip')
    assert.equal(await page.locator('.track.missing').count(), 4)
    assert.equal(await page.getByRole('button', { name: 'Download Missing' }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Play', exact: true }).isDisabled(), true)
    let lib = await library(page)
    assert.equal(lib.playlists[0].youtubeId, 'PLroad')
    const { id, title, artist, duration, source, missing } = lib.tracks.aaaaaaaaaaa
    assert.deepEqual({ id, title, artist, duration, source, missing }, { id: 'aaaaaaaaaaa', title: 'One More Time', artist: 'Daft Punk', duration: 320, source: 'youtube', missing: true })
    assert.ok(apiCalls.some((c) => c.method === 'playlistItems' && c.params.key === 'KEY'))
    await shoot(page, 'saved-playlist')
    step('phone: a playlist link becomes a linked playlist of saved songs, with Download Missing')

    // A watch link, not encoded, from a playlist: the video alone is saved, on top of Songs.
    await page.goto(`${BASE}/save?u=https://www.youtube.com/watch?v=fffffffffff&list=PLroad`)
    await page.waitForURL(`${BASE}/songs`)
    await page.locator('.track').first().waitFor()
    assert.equal(await page.locator('.track .track-title').first().textContent(), 'Running Up That Hill')
    assert.equal(await page.locator('.track').first().getAttribute('class'), 'track missing')
    await shoot(page, 'saved-songs')
    step('phone: a watch link saves its song on top of Songs')

    // The menu of a saved song offers Download instead of Play Next.
    await page.locator('.track').first().getByRole('button', { name: 'More' }).click()
    await page.locator('.menu.shown').waitFor()
    const labels = await page.locator('.menu-item').allTextContents()
    assert.equal(labels[0], 'Download')
    assert.ok(!labels.includes('Play Next'))
    await page.screenshot({ path: shots ? join(shots, 'saved-menu-desktop.png') : join(work, 'x.png') })
    await page.keyboard.press('Escape')
    step('phone: a saved song\'s menu offers Download')

    // Play skips saved songs: only the downloaded one is queued.
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    const queue = await page.evaluate(async () => (await import('/src/lib/player.ts')).usePlayer.getState().queue.ids)
    assert.deepEqual(queue, ['dQw4w9WgXcQ'])
    step('phone: the queue skips saved songs')

    // Without a key (and no helper), a link can't be listed: Search opens with it and says why.
    await page.evaluate(() => localStorage.removeItem('luma-youtube-key'))
    await context.clearCookies()
    const keyless = await (await newContext({ helper: false, key: false })).newPage()
    await keyless.goto(saveUrl('https://www.youtube.com/watch?v=ccccccccccc'))
    await keyless.waitForURL(`${BASE}/search`)
    await keyless.getByRole('link', { name: 'Add YouTube Key' }).waitFor()
    await keyless.context().close()
    step('phone: with no key, Search opens with the link and asks for one')
    await context.close()
  }

  // ── Helper mode: download straight away; refresh; Download Missing ─────
  {
    const context = await newContext({ helper: true })
    const page = await context.newPage()
    await page.goto(saveUrl('https://www.youtube.com/playlist?list=PLroad'))
    await page.waitForURL(/\/playlist\//)
    await page.waitForFunction(() => document.querySelectorAll('.track').length === 4 && !document.querySelector('.track.missing'), null, { timeout: 20_000 })
    let lib = await library(page)
    assert.ok(Object.values(lib.tracks).every((t) => !t.missing))
    assert.equal(lib.playlists[0].youtubeId, 'PLroad')
    assert.equal(apiCalls.filter((c) => c.auth).length, 0)
    step('helper: a playlist link downloads straight away into a linked playlist')

    // YouTube gains a song; Refresh from YouTube adds it as saved, keeping a song added here.
    await page.evaluate(async () => {
      const { addTrack, addToPlaylist, useLibrary } = await import('/src/lib/library.ts')
      const audio = await (await fetch('/test/fixtures/Rick Astley - Never Gonna Give You Up [dQw4w9WgXcQ].m4a')).blob()
      await addTrack({ id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', artist: 'Rick Astley', duration: 213, source: 'youtube', addedAt: 1 }, audio)
      addToPlaylist(useLibrary.getState().playlists[0].id, ['dQw4w9WgXcQ'])
    })
    youtube = { ...youtube, entries: [SONGS[1], NEW_SONG, SONGS[2], SONGS[3]] } // and dropped the first
    publish()
    await page.getByRole('button', { name: 'More', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Refresh from YouTube' }).click()
    await page.locator('.track.missing').waitFor()
    lib = await library(page)
    assert.deepEqual(lib.playlists[0].trackIds, ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'dQw4w9WgXcQ', 'eeeeeeeeeee'])
    assert.equal(lib.tracks.eeeeeeeeeee.missing, true)
    await page.getByRole('button', { name: 'Download Missing' }).waitFor()
    await shoot(page, 'refreshed-playlist')
    step('helper: Refresh from YouTube adds new songs as saved and keeps local ones')

    // Tapping the saved song downloads it (progress on the glyph), then it plays.
    await page.locator('.track.missing .track-main').click()
    await page.locator('.track.missing [aria-label="Downloading"]').waitFor()
    await shoot(page, 'downloading')
    await page.waitForFunction(() => !document.querySelector('.track.missing'), null, { timeout: 20_000 })
    await page.waitForFunction(async () => (await import('/src/lib/player.ts')).usePlayer.getState().queue.ids.includes('eeeeeeeeeee'))
    assert.equal(await page.getByRole('button', { name: 'Download Missing' }).count(), 0)
    step('helper: tapping a saved song downloads it, then plays it')

    // Download Missing fetches every saved song of a playlist.
    youtube = { ...youtube, entries: [...youtube.entries, SINGLE] }
    publish()
    await page.getByRole('button', { name: 'More', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Refresh from YouTube' }).click()
    await page.getByRole('button', { name: 'Download Missing' }).click()
    await page.waitForFunction(() => !document.querySelector('.track.missing'), null, { timeout: 20_000 })
    step('helper: Download Missing downloads the rest')

    // The iOS shell: luma://save?u=… routes in place (WebModel.open's script), without a reload.
    const before = await page.evaluate(() => (window.__marker = Math.random()))
    const path = `/save?u=${encodeURIComponent('https://www.youtube.com/watch?v=ccccccccccc')}`
    await page.evaluate((p) => {
      if (location.pathname + location.search !== p) {
        history.pushState(null, '', p)
        dispatchEvent(new PopStateEvent('popstate'))
      }
    }, path)
    await page.waitForURL(`${BASE}/songs`)
    assert.equal(await page.evaluate(() => window.__marker), before)
    step('iOS: the luma://save route saves in place')
    await context.close()
  }

  // ── Connect YouTube ───────────────────────────────────────────────────
  {
    const hidden = await (await newContext({ helper: false })).newPage()
    await hidden.goto(`${BASE}/you`)
    await hidden.getByRole('button', { name: 'Wallpaper' }).waitFor()
    assert.equal(await hidden.getByRole('button', { name: 'YouTube', exact: true }).count(), 0)
    await hidden.context().close()
    step('connect: hidden while there is no client ID')

    const context = await newContext({ helper: false, google: true })
    const page = await context.newPage()
    await page.goto(`${BASE}/you`)
    const row = page.getByRole('button', { name: 'YouTube', exact: true })
    await row.waitFor()
    await page.waitForFunction(() => !!window.google)
    await shoot(page, 'connect-row')
    apiCalls.length = 0
    await row.click()
    await page.getByRole('dialog', { name: 'YouTube' }).waitFor()
    await page.locator('.sheet-row').first().waitFor()
    assert.deepEqual(await page.locator('.yt-title').allTextContents(), ['Liked Videos', 'Road Trip', 'Sunday Morning & Coffee', 'Gym'])
    assert.equal(await page.evaluate(() => window.__gisPrompt), 'consent')
    assert.ok(apiCalls.every((c) => c.auth === 'Bearer owner-token' && !c.params.key))
    await page.getByRole('button', { name: 'Import Road Trip' }).click()
    await page.getByRole('button', { name: 'Open Road Trip' }).waitFor()
    await shoot(page, 'connect-picker')
    await page.getByRole('button', { name: 'Import Liked Videos' }).click()
    await page.getByRole('button', { name: 'Open Liked Videos' }).click()
    await page.waitForURL(/\/playlist\//)
    assert.equal(await page.locator('.playlist-name').inputValue(), 'Liked Videos')
    const lib = await library(page)
    const liked = lib.playlists.find((p) => p.youtubeId === 'LLowner')
    assert.deepEqual(liked.trackIds, ['bbbbbbbbbbb', 'fffffffffff'])
    assert.ok(apiCalls.some((c) => c.method === 'playlistItems' && c.params.playlistId === 'LLowner' && c.auth === 'Bearer owner-token'))
    await shoot(page, 'liked-playlist')
    step('connect: signs in, lists playlists with Liked Videos first, imports them as linked playlists')

    // Later sign-ins (the token lasts an hour, this session only) skip the consent screen.
    await page.evaluate(() => sessionStorage.clear())
    await page.goto(`${BASE}/you`)
    await page.waitForFunction(() => !!window.google)
    await row.click()
    await page.getByRole('dialog', { name: 'YouTube' }).waitFor()
    assert.equal(await page.evaluate(() => window.__gisPrompt), '')
    // Disconnect revokes the token.
    await page.getByRole('button', { name: 'Disconnect' }).click()
    assert.equal(await page.evaluate(() => window.__revoked), 'owner-token')
    await page.evaluate(() => sessionStorage.clear())
    await page.reload()
    await page.waitForFunction(() => !!window.google)
    await page.getByRole('button', { name: 'YouTube', exact: true }).click()
    await page.getByRole('dialog', { name: 'YouTube' }).waitFor()
    assert.equal(await page.evaluate(() => window.__gisPrompt), 'consent')
    step('connect: later sign-ins skip consent; Disconnect revokes, and the next sign-in asks again')
    await context.close()
  }

  console.log('\nAll app checks passed.')
} finally {
  await browser.close()
  server.kill()
  rmSync(work, { recursive: true, force: true })
}
