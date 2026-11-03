// End-to-end check of the extension (extension/) in Chromium, against test/e2e/youtube.html served at
// www.youtube.com and music.youtube.com (the sandbox can't reach YouTube). Luma itself is stubbed at
// localhost:4848: this records which /save URLs the extension opens.
//
//   node test/e2e/extension.mjs [screenshot dir]
//
// Not part of `npm run check` (it needs a browser that can load extensions).
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

// Playwright isn't a dependency: use the one installed on the machine (require() finds it, import doesn't).
const { chromium } = createRequire(import.meta.url)('playwright')
const here = dirname(fileURLToPath(import.meta.url))
const extension = resolve(here, '../../extension')
const fixture = readFileSync(join(here, 'youtube.html'), 'utf8')
const shots = process.argv[2]
const profile = mkdtempSync(join(tmpdir(), 'luma-ext-'))

const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', // the full browser in new headless mode: headless shell can't load extensions
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
})

const saves = []
await context.route(/^https:\/\/(www|music)\.youtube\.com\//, (route) =>
  route.request().resourceType() === 'document' ? route.fulfill({ contentType: 'text/html', body: fixture }) : route.abort(),
)
await context.route('http://localhost:4848/**', (route) => {
  const url = new URL(route.request().url())
  if (url.pathname === '/api/health') return route.fulfill({ json: { ok: true, ytdlp: '2026.10.20' } })
  if (route.request().resourceType() === 'document') {
    if (url.pathname === '/save') saves.push(url.searchParams.get('u'))
    return route.fulfill({ contentType: 'text/html', body: `<title>Luma</title><body style="background:#0a0a0c">Luma ${url.pathname}` })
  }
  return route.abort()
})

let [worker] = context.serviceWorkers()
worker ??= await context.waitForEvent('serviceworker')
const id = new URL(worker.url()).host
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const lumaTabs = () => context.pages().filter((p) => p.url().startsWith('http://localhost:4848/'))
const step = (name) => console.log(`✓ ${name}`)

async function shoot(page, name) {
  if (!shots) return
  for (const [w, h, tag] of [[393, 852, 'iphone'], [1440, 900, 'desktop']]) {
    await page.setViewportSize({ width: w, height: h })
    await sleep(150)
    await page.screenshot({ path: join(shots, `${name}-${tag}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 800 })
}

try {
  // ── Options ────────────────────────────────────────────────────────────
  const options = await context.newPage()
  await options.goto(`chrome-extension://${id}/options.html`)
  await options.getByRole('button', { name: 'This computer' }).click()
  await options.waitForFunction(() => document.getElementById('url').value === 'http://localhost:4848/')
  await options.waitForSelector('#helper.on') // health answered through the host permission
  await options.locator('#likes').check()
  assert.deepEqual(await worker.evaluate(() => chrome.storage.sync.get(null)), { lumaUrl: 'http://localhost:4848/', autoSaveLikes: true })
  await options.fill('#url', 'not a url')
  await options.press('#url', 'Enter')
  assert.equal(await options.locator('#url.wrong').count(), 1)
  await options.getByRole('button', { name: 'This computer' }).click()
  await shoot(options, 'options')
  await options.close()
  step('options: presets, helper detection, auto-save toggle')

  // ── Watch page ─────────────────────────────────────────────────────────
  const yt = await context.newPage()
  await yt.setViewportSize({ width: 1280, height: 800 })
  await yt.goto('https://www.youtube.com/watch?v=aaaaaaaaaaa')
  const watchButton = yt.locator('ytd-watch-metadata #top-level-buttons-computed > .luma-save-watch')
  await watchButton.waitFor()
  assert.equal(await watchButton.getAttribute('aria-label'), 'Save to Luma')
  await shoot(yt, 'watch')
  step('watch: button injected next to Like/Share')

  await yt.evaluate(() => window.ytGo('/watch?v=ccccccccccc'))
  await yt.waitForFunction(() => document.getElementById('video-title').textContent === 'Song ccccccccccc')
  await watchButton.waitFor()
  assert.equal(await yt.locator('.luma-save').count(), 1)
  step('watch: survives navigation (the row was re-rendered)')

  const opened = context.waitForEvent('page')
  await watchButton.click()
  const luma = await opened
  await luma.waitForURL(/localhost:4848\/save/)
  assert.equal(luma.url(), `http://localhost:4848/save?u=${encodeURIComponent('https://www.youtube.com/watch?v=ccccccccccc')}`)
  assert.deepEqual(saves, ['https://www.youtube.com/watch?v=ccccccccccc'])
  step('watch: opens <lumaUrl>save?u=<watch url> in a new Luma tab')

  // ── Playlist page ──────────────────────────────────────────────────────
  await yt.bringToFront()
  await yt.evaluate(() => window.ytGo('/playlist?list=PLroadtrip'))
  const playlistButton = yt.locator('yt-flexible-actions-view-model > .luma-save-playlist')
  await playlistButton.waitFor()
  assert.equal(await playlistButton.getAttribute('aria-label'), 'Save playlist to Luma')
  assert.equal(await yt.locator('.luma-save-watch').count(), 0)
  await shoot(yt, 'playlist')
  await playlistButton.click()
  await luma.waitForURL(/PLroadtrip/)
  assert.equal(lumaTabs().length, 1)
  assert.equal(saves.at(-1), 'https://www.youtube.com/playlist?list=PLroadtrip')
  assert.equal(await luma.evaluate(() => document.visibilityState), 'visible')
  step('playlist: "Save playlist to Luma" navigates the existing Luma tab and focuses it')

  // ── Auto-save liked videos ─────────────────────────────────────────────
  await yt.bringToFront()
  const before = saves.length
  await yt.goto('https://www.youtube.com/watch?v=bbbbbbbbbbb') // already liked: never saved on load
  await watchButton.waitFor()
  await yt.evaluate(() => window.ytGo('/watch?v=bbbbbbbbbbb&t=3'))
  await sleep(2000)
  assert.equal(saves.length, before)
  step('auto-save: an already-liked video is not saved on load or navigation')

  await yt.evaluate(() => window.ytGo('/watch?v=ddddddddddd'))
  await yt.waitForFunction(() => document.getElementById('video-title').textContent === 'Song ddddddddddd')
  const like = yt.locator('like-button-view-model button')
  await like.click()
  await sleep(2000)
  assert.deepEqual(saves.slice(before), ['https://www.youtube.com/watch?v=ddddddddddd'])
  assert.equal(await yt.evaluate(() => document.visibilityState), 'visible') // stayed on YouTube
  await like.click() // unlike
  await sleep(400)
  await like.click() // like again
  await sleep(2000)
  assert.equal(saves.length, before + 1)
  step('auto-save: one save per liked video, in the background')

  await yt.evaluate(() => window.ytGo('/watch?v=eeeeeeeeeee'))
  await yt.waitForFunction(() => document.getElementById('video-title').textContent === 'Song eeeeeeeeeee')
  await like.click()
  await sleep(300)
  await like.click() // changed their mind within the pause
  await sleep(2000)
  assert.equal(saves.length, before + 1)
  step('auto-save: a like undone within the pause is not saved')

  await worker.evaluate(() => chrome.storage.sync.set({ autoSaveLikes: false }))
  await yt.evaluate(() => window.ytGo('/watch?v=ggggggggggg'))
  await yt.waitForFunction(() => document.getElementById('video-title').textContent === 'Song ggggggggggg')
  await like.click()
  await sleep(2000)
  assert.equal(saves.length, before + 1)
  step('auto-save: off means off')

  // ── YouTube Music ──────────────────────────────────────────────────────
  await worker.evaluate(() => chrome.storage.sync.set({ autoSaveLikes: true }))
  const music = await context.newPage()
  await music.goto('https://music.youtube.com/watch?v=hhhhhhhhhhh')
  const musicButton = music.locator('ytmusic-player-bar .middle-controls-buttons > .luma-save-watch')
  await musicButton.waitFor()
  await shoot(music, 'music')
  await music.locator('#button-shape-like button').click()
  await sleep(2000)
  assert.equal(saves.at(-1), 'https://www.youtube.com/watch?v=hhhhhhhhhhh')
  step('music: player-bar button and liked auto-save')

  console.log(`\nAll extension checks passed. Saves: ${saves.length}`)
} finally {
  await context.close()
  rmSync(profile, { recursive: true, force: true })
}
