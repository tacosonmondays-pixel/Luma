// The social screens end to end, against a pretend Supabase: profiles with Follow, Listening To and Posts; Home's two
// friends shelves; Search's Luma row; You with New Post, More, the Posts shelf and the admin rows; the composer; the
// Viewer; the People and Reports sheets; and the signed-out and offline cases. It checks a few behaviors and takes
// every screenshot at 393×852 and 1440×900, in Luma (dark) and Y2K.
//
//   node test/e2e/social.mjs [screenshot dir] [port]      (ONLY=luma-iphone,y2k-desktop runs just those)
//
// Not part of `npm run check` (it needs a browser and a free port, 4931 by default). Supabase is answered by
// `context.route` with an in-memory PostgREST, RPCs and Storage; the sandbox can't reach supabase.co anyway.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import assert from 'node:assert/strict'

const { chromium } = createRequire(import.meta.url)('playwright')
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const shots = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'luma-social-'))
const port = process.argv[3] ?? '4931'
mkdirSync(shots, { recursive: true })
const BASE = `http://localhost:${port}`
const SB = 'https://kbdevcrqrjnqxsfeszbe.supabase.co'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (name) => console.log(`✓ ${name}`)
const clip = readFileSync(join(root, 'test/fixtures/clip.mp4'))
const soundOnly = readFileSync(join(root, 'test/fixtures/Daft Punk - One More Time.m4a')) // an MP4 with no picture

// ── Pictures: soft gradients as PNGs (zlib only), one look per path ──────

function png(width, height, a, b) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  let o = 0
  const cx = width * 0.32
  const cy = height * 0.3
  const reach = Math.max(width, height) * 0.7
  for (let y = 0; y < height; y++) {
    raw[o++] = 0
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2
      const glow = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / reach) ** 2 * 0.45
      for (let c = 0; c < 3; c++) raw[o++] = Math.round((a[c] * (1 - t) + b[c] * t) * (1 - glow) + 255 * glow)
    }
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length)
    head.write(type, 4, 'latin1')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])))
    return Buffer.concat([head, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const PALETTES = [
  [[255, 122, 184], [107, 91, 255]],
  [[56, 189, 248], [30, 58, 138]],
  [[251, 191, 36], [220, 38, 38]],
  [[52, 211, 153], [14, 116, 144]],
  [[244, 114, 182], [251, 146, 60]],
  [[167, 139, 250], [17, 24, 39]],
  [[134, 239, 172], [59, 130, 246]],
  [[253, 224, 71], [236, 72, 153]],
]
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
const pictures = new Map()
function picture(key, width, height) {
  const id = `${key}@${width}x${height}`
  if (!pictures.has(id)) {
    const [a, b] = PALETTES[hash(key) % PALETTES.length]
    pictures.set(id, png(width, height, a, b))
  }
  return pictures.get(id)
}

// ── The people and their things ──────────────────────────────────────────

const id = (n) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n.repeat(12)}`
const ADA = id('1')
const ALICE = id('2')
const BRAM = id('3')
const CLEO = id('4')
const DEV = id('5')
const ROOT = id('6')
const NOW = Date.now()
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString()

function profile(over) {
  const handle = over.handle
  return {
    id: over.id, handle, member: true, admin: false, banned: false, name: '', bio: null, colors: null, auto_colors: null,
    frame: null, effect: null, name_style: null, pinned_songs: [], pinned_playlists: [], badges: [],
    avatar_path: `${over.id}/profile/avatar.jpg`, avatar_still_path: null, avatar_kind: 'image', avatar_version: 1,
    banner_path: null, banner_still_path: null, banner_kind: null, banner_version: null,
    backdrop_path: null, backdrop_still_path: null, backdrop_kind: null, backdrop_version: null,
    crops: {}, share_activity: true, sharing_since: ago(60 * 24 * 30), created_at: ago(60 * 24 * 60), updated_at: ago(60), ...over,
  }
}

const SONGS = {
  one: { youtube_id: 'aaaaaaaaaaa', title: 'One More Time', artist: 'Daft Punk' },
  dreams: { youtube_id: 'bbbbbbbbbbb', title: 'Dreams', artist: 'Fleetwood Mac' },
  lights: { youtube_id: 'ccccccccccc', title: 'Blinding Lights', artist: 'The Weeknd' },
  less: { youtube_id: 'ddddddddddd', title: 'The Less I Know The Better', artist: 'Tame Impala' },
  phoenix: { youtube_id: 'eeeeeeeeeee', title: '1901', artist: 'Phoenix' },
  hill: { youtube_id: 'fffffffffff', title: 'Running Up That Hill', artist: 'Kate Bush' },
  field: { youtube_id: null, title: 'Field Recording', artist: 'Cleo Park' },
}
const song = (s) => (s ? { youtube_id: s.youtube_id, track_title: s.title, track_artist: s.artist } : { youtube_id: null, track_title: null, track_artist: null })

function seedData() {
  const profiles = [
    profile({ id: ADA, handle: 'ada', name: 'Ada Lovelace', name_style: 'neon', colors: ['#ff7ab8', '#6b5bff'], bio: 'Poetical science.' }),
    profile({
      id: ALICE, handle: 'alice', name: 'Alice Moon', name_style: 'chrome', colors: ['#38bdf8', '#1e3a8a'], bio: 'Night drives and moonrise playlists.',
      banner_path: `${ALICE}/profile/banner.jpg`, banner_kind: 'image',
      pinned_songs: [{ id: 'aaaaaaaaaaa', source: 'youtube', title: 'One More Time', artist: 'Daft Punk' }],
      badges: [{ id: 'founder', tier: 4 }, { id: 'hours', tier: 2 }],
    }),
    profile({ id: BRAM, handle: 'moonboy', name: 'Bram Okafor', name_style: 'aurora' }),
    profile({ id: CLEO, handle: 'cleo', name: 'Cleo Park', name_style: 'sparkle', avatar_path: null, avatar_kind: null }),
    profile({ id: DEV, handle: 'dev', name: '', name_style: null }),
    profile({ id: ROOT, handle: 'root', name: 'Rosa Admin', name_style: 'pixel', admin: true }),
  ]
  const follows = [
    [ADA, BRAM, 50], [ADA, CLEO, 40], [ALICE, BRAM, 30], [ALICE, CLEO, 20],
    [BRAM, ALICE, 90], [CLEO, ALICE, 80], [DEV, ALICE, 70], [ROOT, ALICE, 60],
  ].map(([follower_id, followee_id, m]) => ({ follower_id, followee_id, created_at: ago(m * 60) }))
  const plays = [
    [ALICE, SONGS.one, 5], [ALICE, SONGS.dreams, 30], [ALICE, SONGS.lights, 60], [ALICE, SONGS.hill, 200], [ALICE, SONGS.phoenix, 400],
    [BRAM, SONGS.one, 12], [BRAM, SONGS.less, 50], [BRAM, SONGS.lights, 90],
    [CLEO, SONGS.one, 20], [CLEO, SONGS.field, 70], [CLEO, SONGS.dreams, 120], [CLEO, SONGS.phoenix, 600],
  ].map(([user_id, s, m], i) => ({ user_id, track_id: s.youtube_id ?? `f-${i}`, youtube_id: s.youtube_id, title: s.title, artist: s.artist, played_at: ago(m) }))
  const videos = [
    { id: id('a'), user_id: ALICE, base: 'moonrise', caption: 'moonrise timelapse from the roof', song: SONGS.one, m: 90 },
    { id: id('b'), user_id: CLEO, base: 'waves', caption: 'waves at night', song: null, m: 30 },
  ].map((v) => ({
    id: v.id, user_id: v.user_id, path: `${v.user_id}/videos/${v.base}.mp4`, still_path: `${v.user_id}/videos/${v.base}-still.jpg`,
    caption: v.caption, ...song(v.song), duration: 2, created_at: ago(v.m), removed_at: null,
  }))
  const post = (pid, user_id, body, images, s, m) => ({
    id: pid, user_id, body, image_paths: images.map((n) => `${user_id}/posts/${pid.slice(0, 8)}-${n}.jpg`), ...song(s), created_at: ago(m), removed_at: null,
  })
  const posts = [
    post(id('c'), ALICE, 'Moon over the harbor, four ways.', [0, 1, 2, 3], null, 60),
    post(id('d'), ALICE, 'Full moon tonight. Who is driving?\n\nBring snacks.', [], SONGS.dreams, 180),
    post(id('e'), ALICE, '', [0], SONGS.lights, 600),
    post(id('f'), ALICE, 'Playlist for the moon: soft, slow, a bit strange.', [], null, 1440),
    post(id('7'), ALICE, 'Sunday light.', [0], null, 2880),
    post(id('8'), BRAM, 'Found this on the walk home.', [0], SONGS.less, 45),
    post(id('9'), BRAM, 'moon songs only this week, sorry not sorry', [], null, 300),
    post(id('0'), ADA, 'Notes on the Analytical Engine, now with a soundtrack.', [], SONGS.one, 240),
    post('aaaaaaaa-0000-4000-8000-00000000000a', ADA, '', [0, 1], null, 1000),
  ]
  const reports = [
    ['profile', DEV, 'spam', ADA, 10], ['profile', DEV, 'spam', BRAM, 20], ['profile', DEV, 'abuse', CLEO, 30],
    ['post', id('9'), 'abuse', CLEO, 40], ['post', id('9'), 'other', ALICE, 50],
    ['video', id('b'), 'explicit', BRAM, 60],
    ['post', id('c'), 'copyright', DEV, 70],
  ].map(([kind, target_id, reason, reporter_id, m], i) => ({ id: `r${i}`, kind, target_id, reason, reporter_id, created_at: ago(m), resolved_at: null }))
  return { profiles, follows, plays, videos, posts, reports }
}

/** The pretend server's state; each context starts from a fresh copy. `fail` answers the next request matching each
 * entry ({ method, path: a RegExp over path and query, status, code }) with an error, once. */
const server = { data: seedData(), mediaLeft: 150 * 1024 * 1024, hold: null, uploads: 0, offline: false, calls: [], fail: [] }
function reset() {
  Object.assign(server, { data: seedData(), mediaLeft: 150 * 1024 * 1024, hold: null, uploads: 0, offline: false, calls: [], fail: [] })
}
const failed = async () => {
  for (let i = 0; i < 100 && server.fail.length; i++) await sleep(100)
  assert.equal(server.fail.length, 0, 'the failure was never asked for')
  await sleep(400)
}

// ── The pretend PostgREST, RPCs and Storage ──────────────────────────────

function requester(req) {
  const token = (req.headers().authorization ?? '').replace(/^Bearer /, '')
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub
  } catch {
    return undefined
  }
}

const unquote = (s) => s.replace(/^"(.*)"$/, '$1')
function filtersOf(url) {
  const out = []
  for (const [col, value] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(col)) continue
    const m = value.match(/^(eq|neq|gt|gte|lt|lte|is|in)\.(.*)$/s)
    if (m) out.push({ col, op: m[1], value: m[2] })
  }
  return out
}
function matches(row, { col, op, value }) {
  const v = row[col]
  switch (op) {
    case 'eq': return String(v) === value
    case 'neq': return String(v) !== value
    case 'is': return value === 'null' ? v == null : String(v) === value
    case 'in': return value.replace(/^\(|\)$/g, '').split(',').map(unquote).includes(String(v))
    case 'gt': return v != null && String(v) > value
    case 'gte': return v != null && String(v) >= value
    case 'lt': return v != null && String(v) < value
    case 'lte': return v != null && String(v) <= value
  }
  return true
}

const person = (uid) => server.data.profiles.find((p) => p.id === uid)
const isAdmin = (uid) => !!person(uid)?.admin
const follows = (a, b) => server.data.follows.some((f) => f.follower_id === a && f.followee_id === b)

/** What `me` may read of a table (row level security, roughly). */
function visible(table, me) {
  const d = server.data
  const shown = (uid) => uid === me || isAdmin(me) || !person(uid)?.banned
  switch (table) {
    case 'profiles':
      return d.profiles.filter((p) => shown(p.id))
    case 'follows':
      return d.follows
    case 'plays':
      return d.plays.filter((p) => p.user_id === me || (follows(me, p.user_id) && person(p.user_id)?.share_activity))
    case 'videos':
    case 'posts':
      return d[table].filter((r) => r.user_id === me || isAdmin(me) || (!r.removed_at && shown(r.user_id)))
    case 'reports':
      return d.reports.filter((r) => isAdmin(me) || r.reporter_id === me)
  }
  return []
}

const uuid = () => crypto.randomUUID()

async function rest(route, table, url, me) {
  const req = route.request()
  const method = req.method()
  const object = (req.headers().accept ?? '').includes('vnd.pgrst.object')
  const prefer = req.headers().prefer ?? ''
  const send = (rows, status = 200, headers = {}) =>
    route.fulfill({ status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(object ? (rows[0] ?? null) : rows) })
  const fail = (status, code, message) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code, message, details: null, hint: null }) })
  const filters = filtersOf(url)
  const d = server.data

  if (method === 'GET' || method === 'HEAD') {
    let rows = visible(table, me).filter((r) => filters.every((f) => matches(r, f)))
    const order = url.searchParams.get('order')
    if (order) {
      const [col, dir = 'asc'] = order.split('.')
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (dir === 'desc' ? -1 : 1))
    }
    const total = rows.length
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limit = Number(url.searchParams.get('limit') ?? 1000)
    rows = rows.slice(offset, offset + limit)
    // As the real API: the count is in content-range, which a cross-origin page reads only when it is exposed.
    const headers = { 'content-range': `${offset}-${offset + rows.length - 1}/${total}`, 'access-control-expose-headers': 'content-range' }
    if (method === 'HEAD') return route.fulfill({ status: 200, headers })
    return send(rows, 200, headers)
  }
  const body = req.postData() ? JSON.parse(req.postData()) : {}
  if (method === 'POST') {
    const list = Array.isArray(body) ? body : [body]
    if (table === 'follows') {
      for (const f of list) {
        if (f.follower_id !== me) return fail(403, '42501', 'new row violates row-level security policy')
        if (follows(f.follower_id, f.followee_id)) return fail(409, '23505', 'duplicate key value')
        d.follows.push({ ...f, created_at: new Date().toISOString() })
      }
      return route.fulfill({ status: 201, body: '' })
    }
    if (table === 'reports') {
      for (const r of list) d.reports.push({ id: uuid(), reporter_id: me, created_at: new Date().toISOString(), resolved_at: null, ...r })
      return route.fulfill({ status: 201, body: '' })
    }
    if (table === 'posts' || table === 'videos') {
      const made = list.map((r) => ({ id: uuid(), user_id: me, created_at: new Date().toISOString(), removed_at: null, ...r }))
      d[table].push(...made)
      return prefer.includes('return=representation') ? send(made, 201) : route.fulfill({ status: 201, body: '' })
    }
    return send([], 201) // library sync, plays: accepted and forgotten
  }
  if (method === 'PATCH') {
    const rows = (d[table] ?? []).filter((r) => filters.every((f) => matches(r, f)) && (r.id === me || r.user_id === me))
    for (const r of rows) Object.assign(r, body)
    return send(rows)
  }
  if (method === 'DELETE') {
    if (!d[table]) return route.fulfill({ status: 204, body: '' })
    const own = (r) => (table === 'follows' ? r.follower_id === me : r.user_id === me)
    d[table] = d[table].filter((r) => !(filters.every((f) => matches(r, f)) && own(r)))
    return route.fulfill({ status: 204, body: '' })
  }
  return send([])
}

function rpc(route, fn, me) {
  const args = JSON.parse(route.request().postData() || '{}')
  const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
  const d = server.data
  if (fn === 'luma_search') {
    const q = String(args.q ?? '').toLowerCase()
    const has = (s) => !!s && s.toLowerCase().includes(q)
    const rows = []
    for (const p of visible('profiles', me)) if (p.member && (has(p.handle) || has(p.name) || has(p.bio))) rows.push({ kind: 'profile', id: p.id, user_id: p.id, handle: p.handle, title: p.name, rank: 1 })
    for (const v of visible('videos', me)) if (!v.removed_at && (has(v.caption) || has(v.track_title))) rows.push({ kind: 'video', id: v.id, user_id: v.user_id, handle: '', title: v.caption, rank: 1 })
    for (const p of visible('posts', me)) if (!p.removed_at && (has(p.body) || has(p.track_title))) rows.push({ kind: 'post', id: p.id, user_id: p.user_id, handle: '', title: p.body, rank: 1 })
    return json(rows)
  }
  if (fn === 'media_left') return json(isAdmin(me) ? null : server.mediaLeft)
  if (!isAdmin(me)) return json({ code: '42501', message: 'admins only' }, 403)
  if (fn === 'create_invites') return json([{ code: 'K7Q2M9XW', expires_at: new Date(NOW + 30 * 86400_000).toISOString() }])
  const resolve = (pred) => d.reports.forEach((r) => !r.resolved_at && pred(r) && (r.resolved_at = new Date().toISOString()))
  if (fn === 'admin_dismiss') resolve((r) => r.kind === args.kind && r.target_id === args.id)
  if (fn === 'admin_remove') {
    if (args.kind !== 'profile') for (const r of d[args.kind === 'video' ? 'videos' : 'posts']) if (r.id === args.id) r.removed_at = new Date().toISOString()
    resolve((r) => r.kind === args.kind && r.target_id === args.id)
  }
  if (fn === 'admin_ban') for (const p of d.profiles) if (p.id === args.target) p.banned = true
  if (fn === 'admin_purge') {
    const theirs = (id) => [...d.videos, ...d.posts].some((x) => x.id === id && x.user_id === args.target)
    for (const x of [...d.videos, ...d.posts]) if (x.user_id === args.target) x.removed_at ??= new Date().toISOString()
    resolve((r) => r.target_id === args.target || theirs(r.target_id))
  }
  return route.fulfill({ status: 204, body: '' })
}

async function storage(route, url, me) {
  const req = route.request()
  const path = decodeURIComponent(url.pathname)
  if (path.startsWith('/storage/v1/object/public/media/')) {
    const file = path.slice('/storage/v1/object/public/media/'.length)
    if (file.endsWith('/song.mp4')) return route.fulfill({ contentType: 'video/mp4', body: soundOnly })
    if (file.endsWith('.mp4')) return route.fulfill({ contentType: 'video/mp4', body: clip })
    const [w, h] = file.includes('-still') ? [320, 568] : file.includes('banner') ? [900, 300] : file.includes('avatar') ? [160, 160] : file.endsWith('-1.jpg') ? [900, 1200] : [1200, 900]
    return route.fulfill({ contentType: 'image/png', body: picture(file.replace(/-still/, ''), w, h) })
  }
  if (path.startsWith('/storage/v1/object/list/')) return route.fulfill({ json: [] })
  if (req.method() === 'DELETE') {
    const { prefixes = [] } = JSON.parse(req.postData() || '{}')
    return route.fulfill({ json: prefixes.map((name) => ({ name })) })
  }
  if (path.startsWith('/storage/v1/object/media/') && req.method() === 'POST') {
    if (!me) return route.fulfill({ status: 400, json: { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' } })
    // Held from the third file on: the Post button's ring shows halfway.
    if (server.hold && ++server.uploads > 2) await server.hold.promise
    return route.fulfill({ json: { Key: `media/${path.slice('/storage/v1/object/media/'.length)}`, Id: uuid() } })
  }
  return route.fulfill({ json: {} })
}

function b64url(o) {
  return Buffer.from(JSON.stringify(o)).toString('base64url')
}
function sessionOf(uid) {
  const exp = Math.floor(Date.now() / 1000) + 86400
  const email = `${person(uid).handle}@example.com`
  const user = { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: ago(60 * 24 * 60) }
  return {
    access_token: `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: uid, exp, role: 'authenticated', aud: 'authenticated', email })}.sig`,
    token_type: 'bearer', expires_in: 86400, expires_at: exp, refresh_token: 'refresh', user,
  }
}

async function supabaseRoute(route, me) {
  const url = new URL(route.request().url())
  const who = requester(route.request()) ?? undefined
  server.calls.push(`${route.request().method()} ${url.pathname}`)
  if (server.offline) return route.abort('internetdisconnected')
  const f = server.fail.findIndex((f) => f.method === route.request().method() && f.path.test(url.pathname + url.search))
  if (f >= 0) {
    const [{ status = 504, code = '' }] = server.fail.splice(f, 1)
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code, message: 'timeout', details: null, hint: null }) })
  }
  if (url.pathname.startsWith('/auth/')) {
    const session = me && sessionOf(me)
    if (url.pathname === '/auth/v1/user') return session ? route.fulfill({ json: session.user }) : route.fulfill({ status: 401, json: {} })
    return session ? route.fulfill({ json: session }) : route.fulfill({ status: 400, json: {} })
  }
  if (url.pathname.startsWith('/storage/')) return storage(route, url, who)
  const fn = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)/)?.[1]
  if (fn) return rpc(route, fn, who)
  const table = url.pathname.match(/^\/rest\/v1\/(\w+)/)?.[1]
  if (table) return rest(route, table, url, who)
  return route.fulfill({ json: {} })
}

// ── YouTube and the helper ───────────────────────────────────────────────

const RESULTS = [
  ['aaaaaaaaaaa', 'Daft Punk - One More Time (Official Video)', 'Daft Punk', 320],
  ['bbbbbbbbbbb', 'Fleetwood Mac - Dreams (Official Music Video)', 'Fleetwood Mac', 257],
  ['ccccccccccc', 'The Weeknd - Blinding Lights (Official Audio)', 'TheWeekndVEVO', 201],
  ['ddddddddddd', 'Tame Impala - The Less I Know The Better', 'Tame Impala', 218],
  ['eeeeeeeeeee', 'Phoenix - 1901 (Official Video)', 'Phoenix', 193],
  ['fffffffffff', 'Kate Bush - Running Up That Hill', 'Kate Bush', 298],
].map(([vid, title, channel, duration]) => ({ id: vid, title, channel, duration }))

const FAKE_GIS = `window.google = { accounts: { oauth2: {
  initTokenClient(config) { return { requestAccessToken() { setTimeout(() => config.callback({ access_token: 'owner-token', expires_in: 3599 }), 50) } } },
  revoke(token, done) { done && done() },
} } }`

async function googleapis(route) {
  const method = new URL(route.request().url()).pathname.split('/').pop()
  if (method === 'channels') return route.fulfill({ json: { items: [{ contentDetails: { relatedPlaylists: { likes: 'LLowner' } } }] } })
  if (method === 'playlists')
    return route.fulfill({
      json: {
        items: [
          { id: 'PLroad', snippet: { title: 'Road Trip', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg' } } } },
          { id: 'PLchill', snippet: { title: 'Sunday Morning &amp; Coffee', thumbnails: {} } },
        ],
      },
    })
  return route.fulfill({ json: { items: [] } })
}

// ── The dev server ───────────────────────────────────────────────────────

const vite = spawn(join(root, 'node_modules/.bin/vite'), ['--port', port, '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
let viteLog = ''
vite.stdout.on('data', (d) => (viteLog += d))
vite.stderr.on('data', (d) => (viteLog += d))
const stop = () => vite.kill()
process.on('exit', stop)
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/`)).ok) break
  } catch {}
  if (i > 150) throw new Error(`dev server did not start\n${viteLog}`)
  await sleep(200)
}

const browser = await chromium.launch()
const errors = []

async function newContext({ theme, phone, as }) {
  reset()
  const context = await browser.newContext({
    viewport: phone ? { width: 393, height: 852 } : { width: 1440, height: 900 },
    ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  })
  await context.addInitScript(
    ([theme, session]) => {
      localStorage.setItem('luma-appearance', JSON.stringify({ state: { theme, coverColors: false, playerStyle: 'color' }, version: 0 }))
      if (session) localStorage.setItem('luma-auth', session)
    },
    [theme, as ? JSON.stringify(sessionOf(as)) : ''],
  )
  await context.route(`${SB}/**`, (route) => supabaseRoute(route, as))
  await context.route('https://i.ytimg.com/**', (r) => r.fulfill({ contentType: 'image/png', body: picture(r.request().url().split('/vi/')[1] ?? 'yt', 320, 180) }))
  await context.route('https://www.googleapis.com/youtube/v3/**', googleapis)
  await context.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_GIS }))
  await context.route(/\/src\/lib\/google-config\.ts/, (r) => r.fulfill({ contentType: 'text/javascript', body: "export const GOOGLE_CLIENT_ID = 'test.apps.googleusercontent.com'" }))
  await context.route(`${BASE}/api/health`, (r) => r.fulfill({ json: { ok: true, ytdlp: '2026.01.01' } }))
  await context.route(/\/api\/search\?/, (r) => r.fulfill({ json: { results: RESULTS } }))
  await context.route(/\/api\/mix\//, (r) => r.fulfill({ json: { results: RESULTS.slice(1) } }))
  await context.route(/\/api\/cover\//, (r) => {
    const vid = new URL(r.request().url()).pathname.split('/').pop()
    return r.fulfill({ contentType: 'image/png', body: picture(vid, 480, 270) })
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${theme} ${phone ? 'phone' : 'desktop'}: ${e.message}`))
  return { context, page }
}

/** A library to play from (Home isn't empty), and the song that's playing (the composer's song chip). */
async function seedLibrary(page) {
  await page.goto(`${BASE}/`)
  await page.evaluate(async (results) => {
    const { addTrack } = await import('/src/lib/library.ts')
    const { addPlays } = await import('/src/lib/plays.ts')
    const { usePlayer } = await import('/src/lib/player.ts')
    const cover = await (await fetch('/test/fixtures/cover.jpg')).blob()
    // Real audio: a blob the browser can't decode would leave the queue (player.ts skips it).
    const audio = await (await fetch('/test/fixtures/Daft%20Punk%20-%20One%20More%20Time.m4a')).blob()
    const songs = results.slice(0, 5).map((r) => ({ id: r.id, title: r.title.split(' - ')[1]?.replace(/ \(.*\)$/, '') ?? r.title, artist: r.channel, duration: r.duration }))
    for (let i = 0; i < songs.length; i++) await addTrack({ ...songs[i], source: 'youtube', addedAt: Date.now() - i * 1000 }, audio, cover)
    const now = Date.now()
    const plays = []
    for (let d = 0; d < 4; d++) for (let i = 0; i < 5; i++) plays.push([songs[i].id, now - d * 86400000 - i * 60000 - 3600000, 90000])
    await addPlays(plays)
    usePlayer.setState({ queue: { ids: [songs[2].id], index: 0, original: null } })
    const { saveProfile, useLibrary } = await import('/src/lib/library.ts')
    await saveProfile({ ...useLibrary.getState().profile, name: 'Ada Lovelace', nameStyle: 'neon', colors: ['#ff7ab8', '#6b5bff'], bio: 'Poetical science.' })
  }, RESULTS)
  await sleep(200)
}

const go = async (page, path) => {
  await page.evaluate(async (p) => (await import('/src/lib/router.ts')).navigate(p), path)
  await sleep(400)
}

/** Scrolls whatever scrolls the page (the window, or Y2K desktop's own window) to `selector`, or to the end. */
async function scrollEnd(page) {
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight)
    const main = document.querySelector('.main')
    if (main) main.scrollTop = main.scrollHeight
  })
  await sleep(500)
}
async function scrollTo(page, selector) {
  await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await sleep(500)
}

let tag = ''
const shot = async (page, name) => {
  await sleep(450)
  await page.screenshot({ path: join(shots, `${tag}-${name}.png`) })
}

const menuItem = (page, name) => page.locator('.menu .menu-item', { hasText: name })
const onlySocialCalls = () => server.calls.filter((c) => /\/rest\/v1\/(follows|plays|posts|videos|reports|rpc)/.test(c))

const files = (n) =>
  Array.from({ length: n }, (_, i) => ({ name: `photo-${i}.png`, mimeType: 'image/png', buffer: picture(`pick-${i}`, i % 2 ? 900 : 1200, i % 2 ? 1200 : 900) }))
const big = Array.from({ length: 4 }, (_, i) => ({ name: `big-${i}.png`, mimeType: 'image/png', buffer: picture(`big-${i}`, 3000, 2000) }))

for (const theme of ['luma', 'y2k']) {
  for (const phone of [true, false]) {
    tag = `${theme}-${phone ? 'iphone' : 'desktop'}`
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(tag)) continue // ONLY=luma-iphone,y2k-desktop
    console.log(`── ${tag}`)

    // ── Signed out ──────────────────────────────────────────────────────
    {
      const { context, page } = await newContext({ theme, phone })
      await seedLibrary(page)

      // Search: no Luma row, and supabase.co is never asked.
      server.calls = []
      await go(page, '/search')
      await page.getByRole('searchbox', { name: 'Search' }).fill('moon')
      await page.keyboard.press('Enter')
      await page.locator('.tile, .result').first().waitFor()
      await sleep(500)
      assert.equal(await page.locator('.luma-results').count(), 0)
      assert.deepEqual(server.calls, [], 'a signed-out search calls Supabase')
      await shot(page, '06-search-signedout')
      step('signed-out Search: no Luma row, no Supabase calls')

      await go(page, '/')
      await page.getByRole('heading', { name: 'Home' }).waitFor()
      await sleep(600)
      assert.equal(await page.getByText('Friends Are Listening To').count(), 0)
      await shot(page, '05-home-signedout')
      await page.getByRole('button', { name: 'Edit Home' }).click()
      await page.getByRole('dialog', { name: 'Edit Home' }).waitFor()
      assert.equal(await page.getByRole('dialog').getByText('New from Friends').count(), 0)
      await page.keyboard.press('Escape')
      if (!phone) await page.screenshot({ path: join(shots, `${tag}-11-sidebar.png`), clip: { x: 0, y: 0, width: 260, height: 140 } })
      step('signed-out Home: no friends shelves, none in Edit Home')

      await go(page, '/u/alice')
      await page.locator('.post-grid .post-card').first().waitFor()
      assert.equal(await page.locator('.pc-follow').count(), 0)
      assert.equal(await page.getByText('Listening To').count(), 0)
      await shot(page, '01-u-alice')
      await scrollTo(page, '.user-sections')
      await shot(page, '01-u-alice-posts')
      await scrollTo(page, '.pc-wrap')
      await page.locator('.pc-actions').getByRole('button', { name: 'More', exact: true }).click()
      await menuItem(page, 'Followers').waitFor()
      assert.equal(await menuItem(page, 'Report').count(), 0)
      await shot(page, '01-u-alice-more')
      await menuItem(page, 'Followers').click()
      await page.getByRole('dialog', { name: 'Followers' }).locator('.person-row').first().waitFor()
      await shot(page, '10-people-followers')
      await page.keyboard.press('Escape')
      step('signed-out profile: card, More, Posts grid, People sheet')

      // The Viewer, signed out: no More.
      await page.locator('.post-grid .post-card').first().click()
      await page.locator('.viewer').waitFor()
      assert.equal(await page.locator('.viewer').getByRole('button', { name: 'More', exact: true }).count(), 0)
      await page.keyboard.press('Escape')
      await page.locator('.viewer').waitFor({ state: 'detached' })

      // From the keyboard: Enter on a card opens the Viewer, and Escape gives focus back to that card.
      await page.locator('.post-grid .post-card').nth(1).focus()
      await page.keyboard.press('Enter')
      await page.locator('.viewer').waitFor()
      await page.keyboard.press('Escape')
      await page.locator('.viewer').waitFor({ state: 'detached' })
      assert.ok(await page.locator('.post-grid .post-card').nth(1).evaluate((el) => el === document.activeElement))
      step('Viewer: focus goes back to the card it opened from')

      // Offline: the existing glyph, and nothing social is asked for.
      await go(page, '/')
      await context.setOffline(true)
      server.offline = true
      server.calls = []
      await go(page, '/u/alice')
      await page.locator('.user-missing').waitFor()
      assert.deepEqual(onlySocialCalls(), [])
      await shot(page, '04-u-alice-offline')
      await context.setOffline(false)
      server.offline = false
      step('offline profile: the glyph, no social calls')
      await context.close()
    }

    // ── A member (Ada, who follows Bram and Cleo) ───────────────────────
    {
      const { context, page } = await newContext({ theme, phone, as: ADA })
      await seedLibrary(page)
      // The feed fails once (a statement timeout): both friends shelves hide, and the next visit tries again.
      server.fail.push({ method: 'GET', path: /^\/rest\/v1\/videos\?/, status: 500, code: '57014' })
      await page.reload()
      await page.getByRole('heading', { name: 'Home' }).waitFor()
      await sleep(800)
      await scrollEnd(page)
      await failed()
      assert.equal(await page.getByText('New from Friends').count(), 0)
      assert.equal(await page.getByText('Friends Are Listening To').count(), 0)
      await go(page, '/songs')
      await go(page, '/')
      step('member Home: a failed feed hides the friends shelves until the next visit')

      // Home: both friends shelves.
      await page.getByRole('heading', { name: 'Home' }).waitFor()
      await sleep(800)
      await scrollEnd(page)
      await page.getByText('New from Friends').waitFor()
      await scrollTo(page, '.shelf:has(.faces)')
      await shot(page, '05-home-member')
      await scrollTo(page, '.shelf:has(.post-card)')
      await shot(page, '05-home-member-posts')
      step('member Home: both friends shelves')

      // Search: the Luma row above YouTube's results, then all of it.
      await go(page, '/search')
      await page.getByRole('searchbox', { name: 'Search' }).fill('moon')
      await page.keyboard.press('Enter')
      await page.locator('.luma-results .card').first().waitFor()
      await page.locator('.tile, .result').first().waitFor()
      assert.equal(await page.locator('.luma-results .person-card').first().getAttribute('href'), '/u/alice')
      await shot(page, '06-search-member')
      await page.getByRole('button', { name: 'Show All Luma' }).click()
      await sleep(300)
      await shot(page, '06-search-member-all')
      step('member Search: the Luma row, people first')

      // Alice's profile: Follow, Following, then Listening To; the Report submenu.
      await go(page, '/u/alice')
      const pill = page.locator('.pc-follow')
      await pill.waitFor()
      assert.equal(await pill.getAttribute('aria-pressed'), 'false')
      await shot(page, '02-u-alice-follow')
      await pill.click()
      await page.locator('.pc-follow[aria-pressed="true"]').waitFor()
      await sleep(300)
      assert.ok(follows(ADA, ALICE))
      await shot(page, '02-u-alice-following')
      await page.reload()
      await page.getByText('Listening To').waitFor()
      await scrollTo(page, '.user-sections')
      await shot(page, '02-u-alice-listening')
      await scrollTo(page, '.pc-wrap')
      await page.locator('.pc-actions').getByRole('button', { name: 'More', exact: true }).click()
      await menuItem(page, 'Report').click()
      await menuItem(page, 'Copyright').waitFor()
      await shot(page, '02-u-alice-report')
      await page.keyboard.press('Escape')
      step('member profile: Follow, Following, Listening To, Report')

      // The Viewer: a video (muted, then unmuted), four images with dots, and More for a member.
      await page.locator('.post-grid .post-card:has(.post-badge-top)').first().click()
      await page.locator('.viewer video').waitFor()
      await page.waitForFunction(() => !document.querySelector('.viewer video')?.paused)
      await shot(page, '09-viewer-video-muted')
      await page.locator('.viewer').getByRole('button', { name: 'Unmute' }).click()
      assert.equal(await page.locator('.viewer video').evaluate((v) => v.muted), false)
      // The sound button sits on the picture (object-fit: contain draws it inside the element), not on a black bar.
      const onPicture = await page.locator('.viewer').evaluate((viewer) => {
        const video = viewer.querySelector('video')
        const box = video.getBoundingClientRect()
        const ratio = video.videoWidth / video.videoHeight
        const width = Math.min(box.width, box.height * ratio)
        const height = width / ratio
        const left = box.left + (box.width - width) / 2
        const top = box.top + (box.height - height) / 2
        const b = viewer.querySelector('.viewer-sound').getBoundingClientRect()
        return b.left >= left && b.right <= left + width - 8 && b.top >= top && b.bottom <= top + height - 8
      })
      assert.ok(onPicture, 'the sound button is off the picture')
      await shot(page, '09-viewer-video-unmuted')
      await page.locator('.viewer').getByRole('button', { name: 'More', exact: true }).click()
      await menuItem(page, 'Report').waitFor()
      await shot(page, '09-viewer-more-member')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.locator('.viewer').waitFor({ state: 'detached' })
      await page.getByRole('button', { name: 'Moon over the harbor, four ways.' }).click()
      await page.locator('.viewer-dots').waitFor()
      await sleep(400)
      await shot(page, '09-viewer-images')
      if (!phone) {
        await page.locator('.viewer').getByRole('button', { name: 'Next Image' }).click()
        await sleep(600)
        await shot(page, '09-viewer-images-next')
      }
      await page.keyboard.press('Escape')
      step('Viewer: video, sound, images, member More')

      // Reduced motion: the poster and Play, no autoplay.
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.locator('.post-grid .post-card:has(.post-badge-top)').first().click()
      await page.locator('.viewer-play').waitFor()
      await sleep(600)
      assert.equal(await page.locator('.viewer video').evaluate((v) => v.paused), true)
      await shot(page, '12-viewer-reduced')
      await page.keyboard.press('Escape')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      step('reduced motion: poster and Play')

      // A "video" put up around the app that is a song (sound, no picture): Can't Play, and nothing plays.
      server.data.videos.push({
        id: 'bbbbbbbb-0000-4000-8000-00000000000b', user_id: BRAM, path: `${BRAM}/videos/song.mp4`, still_path: `${BRAM}/videos/song-still.jpg`,
        caption: 'listen to this', ...song(SONGS.less), duration: 30, created_at: ago(1), removed_at: null,
      })
      // Bram's card has a video Background: it plays on his page, and rests while the Viewer covers the page.
      Object.assign(person(BRAM), { backdrop_path: `${BRAM}/profile/backdrop.mp4`, backdrop_kind: 'video', backdrop_still_path: `${BRAM}/profile/backdrop-still.jpg` })
      await go(page, '/u/moonboy')
      const backdrop = page.locator('.pc-backdrop video')
      await page.waitForFunction(() => document.querySelector('.pc-backdrop video')?.paused === false)
      await page.locator('.post-grid .post-card:has(.post-badge-top)').first().click()
      await page.locator('.viewer').getByRole('img', { name: "Can't Play" }).waitFor()
      await sleep(300)
      assert.equal(await backdrop.evaluate((v) => v.paused), true, "the card's video plays under the Viewer")
      assert.equal(await page.locator('.viewer video').evaluate((v) => v.paused && !v.hasAttribute('src')), true)
      assert.equal(await page.locator('.viewer').getByRole('button', { name: 'Unmute' }).count(), 0)
      await shot(page, '09-viewer-audio-only')
      await page.keyboard.press('Escape')
      await page.locator('.viewer').waitFor({ state: 'detached' })
      step("Viewer: a song posted as a video can't play; the card's video rests under the Viewer")

      // You: New Post, More, the Posts shelf and the @handle row.
      await go(page, '/you')
      await page.getByRole('button', { name: 'New Post' }).waitFor()
      await page.locator('.you-posts .post-card').first().waitFor()
      await shot(page, '07-you-member')
      await scrollTo(page, '.you-settings .group:last-child')
      await shot(page, '07-you-member-settings')
      assert.equal(await page.locator('a.group-row', { hasText: '@ada' }).getAttribute('href'), '/u/ada')
      await scrollTo(page, '.pc-wrap')
      await page.locator('.pc-actions').getByRole('button', { name: 'More', exact: true }).click()
      await menuItem(page, 'Following').waitFor()
      await menuItem(page, 'Following').click()
      await page.getByRole('dialog', { name: 'Following' }).locator('.person-row').first().waitFor()
      await shot(page, '10-people-following')
      const inSheet = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))
      assert.ok(await inSheet(), 'focus stayed behind the sheet')
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press(i % 3 ? 'Tab' : 'Shift+Tab')
        assert.ok(await inSheet(), 'Tab left the sheet')
      }
      await page.keyboard.press('Escape')
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'More', 'focus went back to More')
      step('People sheet: focus moves in, Tab stays in, and goes back to More')

      // Owner's More in the Viewer.
      await page.locator('.you-posts .post-card').first().click()
      await page.locator('.viewer').getByRole('button', { name: 'More', exact: true }).click()
      await menuItem(page, 'Delete').click()
      await menuItem(page, 'Delete Post').waitFor()
      await shot(page, '09-viewer-more-owner')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      step('member You: New Post, More, Posts, @handle, owner More')

      // The composer: empty; four images and the song; uploading; Storage Full.
      await page.getByRole('button', { name: 'New Post' }).click()
      const sheet = page.getByRole('dialog', { name: 'New Post' })
      await sheet.waitFor()
      await shot(page, '08-composer-empty')
      await page.getByRole('textbox', { name: 'Text' }).fill('Four from the harbor walk.')
      const chooser = page.waitForEvent('filechooser')
      await sheet.getByRole('button', { name: 'Add Photo or Video' }).click()
      await (await chooser).setFiles(files(4))
      await page.waitForFunction(() => document.querySelectorAll('.compose-thumb img').length === 4 && !document.querySelector('.compose-busy'))
      assert.equal(await sheet.getByRole('button', { name: 'Add Photo or Video' }).count(), 0)
      if (phone) {
        // A coarse pointer: Remove answers a touch 22 px from its middle (a 44 px target), past its thumbnail's edge.
        const reach = await sheet.getByRole('button', { name: 'Remove' }).first().evaluate((b) => {
          const r = b.getBoundingClientRect()
          const [x, y] = [r.left + r.width / 2, r.top + r.height / 2]
          return [[-21, 0], [21, 0], [0, -21], [0, 21]].every(([dx, dy]) => document.elementFromPoint(x + dx, y + dy) === b)
        })
        assert.ok(reach, "Remove's touch target is under 44 px")
      }
      await sheet.locator('.compose-song').click()
      await shot(page, '08-composer-images')
      let release
      server.hold = { promise: new Promise((r) => (release = r)) }
      await sheet.getByRole('button', { name: 'Post', exact: true }).click()
      await sheet.getByRole('button', { name: 'Posting' }).waitFor()
      await sleep(400)
      await shot(page, '08-composer-uploading')
      server.hold = null
      release()
      await sheet.waitFor({ state: 'detached' })
      assert.equal(await page.locator('.you-posts .post-card').first().getAttribute('aria-label'), 'Four from the harbor walk.')
      const made = server.data.posts.at(-1)
      assert.equal(made.image_paths.length, 4)
      assert.equal(made.youtube_id, 'ccccccccccc')
      await shot(page, '07-you-member-new-post')
      step('composer: four images and the song, posted, first in Posts')

      await page.getByRole('button', { name: 'New Post' }).click()
      await sheet.waitFor()
      const chooser2 = page.waitForEvent('filechooser')
      await sheet.getByRole('button', { name: 'Add Photo or Video' }).click()
      await (await chooser2).setFiles([{ name: 'clip.mp4', mimeType: 'video/mp4', buffer: clip }])
      await page.waitForFunction(() => !!document.querySelector('.compose-thumb img') && !document.querySelector('.compose-busy'))
      await page.getByRole('textbox', { name: 'Text' }).fill('waves, again')
      await shot(page, '08-composer-video')
      server.mediaLeft = 5 * 1024 * 1024
      await sheet.getByRole('button', { name: 'Post', exact: true }).click()
      await sheet.getByRole('button', { name: 'Storage Full' }).waitFor()
      await shot(page, '08-composer-storage-full')
      await sheet.getByRole('button', { name: 'Close' }).click()
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'New Post', 'focus went back to New Post')
      step('composer: a video, Storage Full')

      // An undecodable pick: its word fits its tile.
      await page.getByRole('button', { name: 'New Post' }).click()
      await sheet.waitFor()
      const chooser3 = page.waitForEvent('filechooser')
      await sheet.getByRole('button', { name: 'Add Photo or Video' }).click()
      await (await chooser3).setFiles([{ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') }])
      const word = sheet.locator('.compose-error')
      await word.waitFor()
      assert.equal(await word.textContent(), 'Unsupported')
      assert.ok(await word.evaluate((el) => el.scrollWidth <= el.parentElement.clientWidth), 'the word is cut off')
      await shot(page, '08-composer-unsupported')
      await sheet.getByRole('button', { name: 'Close' }).click()

      // Closed while big photos are still being processed: what finishes later makes no object URL (none leaks).
      await page.evaluate(() => {
        const live = (window.__urls = new Set())
        const make = URL.createObjectURL.bind(URL)
        const drop = URL.revokeObjectURL.bind(URL)
        URL.createObjectURL = (blob) => (live.add(make(blob)), [...live].at(-1))
        URL.revokeObjectURL = (url) => (live.delete(url), drop(url))
      })
      await page.getByRole('button', { name: 'New Post' }).click()
      await sheet.waitFor()
      const chooser4 = page.waitForEvent('filechooser')
      await sheet.getByRole('button', { name: 'Add Photo or Video' }).click()
      await (await chooser4).setFiles(big)
      await page.locator('.compose-busy').first().waitFor()
      await sheet.getByRole('button', { name: 'Close' }).click()
      await sleep(3000)
      assert.equal(await page.evaluate(() => window.__urls.size), 0, 'a closed composer left object URLs behind')
      step('composer: closed while processing, nothing left behind')

      // The YouTube sheet, after its classes moved to account.css.
      await scrollTo(page, '.you-settings .group:last-child')
      await page.waitForFunction(() => !!window.google)
      await page.getByRole('button', { name: 'YouTube', exact: true }).click()
      await page.getByRole('dialog', { name: 'YouTube' }).getByText('Road Trip').waitFor()
      await shot(page, '10-youtube-sheet')
      await page.keyboard.press('Escape')

      // A start whose own row fails to load (a server error): a profile asks for it again, then shows its sections.
      server.fail.push({ method: 'GET', path: new RegExp(`^/rest/v1/profiles\\?.*id=eq\\.${ADA}`), status: 504 })
      await page.goto(`${BASE}/u/moonboy`)
      await failed()
      await page.getByText('Listening To').waitFor()
      await page.locator('.post-grid .post-card').first().waitFor()
      assert.equal(await page.locator('.post-ghosts').count(), 0)
      step('profile: a row that failed at start is asked for again')
      await context.close()
    }

    // ── An admin (Rosa) ─────────────────────────────────────────────────
    {
      const { context, page } = await newContext({ theme, phone, as: ROOT })
      await seedLibrary(page)
      await page.reload()
      await go(page, '/you')
      await page.getByRole('button', { name: 'Reports' }).waitFor()
      await scrollTo(page, '.you-settings .group:last-child')
      await page.getByRole('button', { name: 'Invite' }).click()
      await page.getByText('K7Q2M9XW').waitFor()
      await shot(page, '07-you-admin')
      step('admin You: Invite with its code, Reports')

      await page.getByRole('button', { name: 'Reports' }).click()
      const reports = page.getByRole('dialog', { name: 'Reports' })
      await reports.locator('.report').first().waitFor()
      assert.equal(await reports.locator('.report').count(), 4)
      await shot(page, '10-reports')
      await reports.getByRole('button', { name: 'Actions' }).first().click()
      await menuItem(page, 'Dismiss').waitFor()
      await shot(page, '10-reports-actions')
      await menuItem(page, 'Dismiss').click()
      await page.waitForFunction(() => document.querySelectorAll('.reports-sheet .report').length === 3)
      await sleep(200)
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest('.reports-sheet')), 'focus left the sheet after Dismiss')
      // A reported post opens the Viewer over the sheet, with Remove and Ban.
      await reports.locator('.report-main').nth(1).click()
      await page.locator('.viewer').getByRole('button', { name: 'More', exact: true }).click()
      await menuItem(page, 'Remove').waitFor()
      assert.equal(await menuItem(page, 'Ban').count(), 1)
      await shot(page, '09-viewer-more-admin')
      await page.keyboard.press('Escape')
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press(i % 4 ? 'Tab' : 'Shift+Tab')
        assert.ok(await page.evaluate(() => !!document.activeElement?.closest('.viewer')), 'Tab left the Viewer for the sheet under it')
      }
      await page.keyboard.press('Escape')
      await page.locator('.viewer').waitFor({ state: 'detached' })
      assert.equal(await reports.count(), 1, 'Escape in the Viewer closed the sheet under it')
      await page.keyboard.press('Escape')
      step('Reports: grouped rows, Dismiss, the Viewer over it')

      await go(page, '/u/alice')
      await page.locator('.pc-actions').getByRole('button', { name: 'More', exact: true }).click()
      await menuItem(page, 'Ban').waitFor()
      assert.equal(await menuItem(page, 'Report').count(), 0)
      assert.equal(await page.locator('.pc-follow').count(), 1)
      await shot(page, '03-u-alice-admin-more')
      await page.keyboard.press('Escape')
      step('admin profile: Remove Profile and Ban')

      // A ban that stops part-way (admin_purge fails): Ban stays on offer after a reload, and Reports keeps the
      // banned author's open report, so it can finish.
      server.fail.push({ method: 'POST', path: /^\/rest\/v1\/rpc\/admin_purge/, status: 504 })
      // The account and the posts have loaded (a page that moves under it would close the menu).
      const settled = async () => {
        await page.locator('.pc-follow').waitFor()
        await page.locator('.post-grid .post-card').first().waitFor()
        await sleep(400)
      }
      await go(page, '/u/moonboy')
      await settled()
      await page.locator('.pc-actions').getByRole('button', { name: 'More', exact: true }).click()
      await menuItem(page, 'Ban').click()
      await menuItem(page, 'Ban @moonboy').click()
      await failed()
      assert.equal(person(BRAM).banned, true)
      const open = () => server.data.reports.filter((r) => r.target_id === id('9') && !r.resolved_at).length
      assert.equal(open(), 2)
      await page.reload()
      await settled()
      await page.locator('.pc-actions').getByRole('button', { name: 'More', exact: true }).click()
      await menuItem(page, 'Ban').waitFor()
      await shot(page, '03-u-banned-admin-more')
      await page.keyboard.press('Escape')
      await go(page, '/you')
      await page.getByRole('button', { name: 'Reports' }).click()
      const pending = page.getByRole('dialog', { name: 'Reports' }).locator('.report', { hasText: 'Abuse · Other' })
      await pending.waitFor()
      await shot(page, '10-reports-banned-author')
      await pending.getByRole('button', { name: 'Actions' }).click()
      await menuItem(page, 'Ban Author').click()
      await menuItem(page, 'Ban @moonboy').click()
      await pending.waitFor({ state: 'detached' })
      assert.equal(open(), 0)
      assert.ok(server.data.posts.filter((p) => p.user_id === BRAM).every((p) => p.removed_at))
      step('admin: a ban that stopped part-way runs again, from the profile and from Reports')
      await context.close()
    }
  }
}

await browser.close()
stop()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`shots in ${shots}`)
