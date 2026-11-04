// An in-memory stand-in for supabase-js, enough for account.ts, sync.ts and the social modules: tables with the
// server's last-write-wins rule and its row level security, the media bucket, the RPCs and email-code sign-in.
// Shared by "devices" in a test. `errors` fails a call on purpose: by its full name ('insert follows',
// 'rpc admin_purge', 'remove') or by its first word ('select'). `lost` runs a call but loses its answer, as a
// dropped connection does (supabase-js answers with no code).

type Row = Record<string, unknown>
type Err = { code?: string; message: string }
type Result = { data: unknown; error: Err | null; count?: number | null }

export interface FakeServer {
  tables: Record<string, Row[]>
  files: Map<string, Blob>
  /** When each file went up (ms). */
  fileTimes: Map<string, number>
  calls: string[]
  codes: Map<string, string> // email → the code "sent"
  invites: Set<string>
  users: Map<string, string> // email → id
  clock: number
  errors: Map<string, Err>
  /** Calls (by full name) that go through but whose answer never arrives. */
  lost: Set<string>
  /** Bytes each member may keep (media_left). */
  quota: number
  /** What luma_search answers, when set (else a plain word match over what the server would show). */
  search?: Row[]
}

export function createServer(): FakeServer {
  return {
    tables: { profiles: [], library_tracks: [], library_playlists: [], plays: [], follows: [], videos: [], posts: [], reports: [] },
    files: new Map(),
    fileTimes: new Map(),
    calls: [],
    codes: new Map(),
    invites: new Set(),
    users: new Map(),
    clock: Date.parse('2026-11-01T00:00:00Z'),
    errors: new Map(),
    lost: new Set(),
    quota: 200 * 1024 * 1024,
  }
}

const KEYS: Record<string, string[]> = {
  profiles: ['id'],
  library_tracks: ['user_id', 'id'],
  library_playlists: ['user_id', 'id'],
  plays: ['user_id', 'track_id', 'played_at'],
  follows: ['follower_id', 'followee_id'],
  videos: ['id'],
  posts: ['id'],
  reports: ['reporter_id', 'kind', 'target_id'],
}

const RLS: Err = { code: '42501', message: 'new row violates row-level security policy' }
const ABORTED: Err = { code: '20', message: 'AbortError: The operation was aborted.' }
const LOST: Err = { code: '', message: 'TypeError: Failed to fetch' }
const clone = <T,>(v: T): T => structuredClone(v)
let ids = 0
const newId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`

// The server's helpers (luma.is_member and friends).
const profile = (s: FakeServer, id: unknown) => s.tables.profiles.find((r) => r.id === id)
const isMember = (s: FakeServer, id: unknown) => !!id && !!profile(s, id)?.member && !profile(s, id)?.banned
const isAdmin = (s: FakeServer, id: unknown) => isMember(s, id) && !!profile(s, id)?.admin
const isVisible = isMember
const sees = (s: FakeServer, me: unknown, target: unknown) =>
  target === me ||
  (isMember(s, me) && isVisible(s, target) && !!profile(s, target)?.share_activity &&
    s.tables.follows.some((f) => f.follower_id === me && f.followee_id === target))

/** What `me` may read of a table (the select policies). */
function readable(s: FakeServer, table: string, me: string | undefined, r: Row): boolean {
  switch (table) {
    case 'profiles':
      return (!!r.handle && !!r.member && !r.banned) || r.id === me || isAdmin(s, me)
    case 'library_tracks':
    case 'library_playlists':
      return r.user_id === me
    case 'plays':
      return !!me && sees(s, me, r.user_id)
    case 'follows':
      return (isVisible(s, r.follower_id) && isVisible(s, r.followee_id)) || (!!me && r.follower_id === me)
    case 'videos':
    case 'posts':
      return (r.removed_at == null && isVisible(s, r.user_id)) || (!!me && r.user_id === me) || isAdmin(s, me)
    case 'reports':
      return !!me && (r.reporter_id === me || isAdmin(s, me))
  }
  return true
}

function failure(s: FakeServer, call: string): Err | undefined {
  return s.errors.get(call) ?? s.errors.get(call.split(' ')[0])
}

class Query implements PromiseLike<Result> {
  private filters: [string, 'eq' | 'gt' | 'lt' | 'in' | 'is', unknown][] = []
  private op: 'select' | 'upsert' | 'update' | 'insert' | 'delete' = 'select'
  private payload: unknown
  private pick: false | 'maybe' | 'one' = false
  private returning = false
  private head = false
  private counted = false
  private window?: [number, number]
  private cap?: number
  private sort?: [string, boolean]
  private signal?: AbortSignal
  private server: FakeServer
  private table: string
  private uid: () => string | undefined
  constructor(server: FakeServer, table: string, uid: () => string | undefined) {
    this.server = server
    this.table = table
    this.uid = uid
  }
  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (this.op !== 'select') this.returning = true
    this.head = !!options?.head
    this.counted = !!options?.count
    return this
  }
  eq(col: string, v: unknown) {
    this.filters.push([col, 'eq', v])
    return this
  }
  gt(col: string, v: unknown) {
    this.filters.push([col, 'gt', v])
    return this
  }
  lt(col: string, v: unknown) {
    this.filters.push([col, 'lt', v])
    return this
  }
  in(col: string, v: unknown[]) {
    this.filters.push([col, 'in', v])
    return this
  }
  is(col: string, v: null) {
    this.filters.push([col, 'is', v])
    return this
  }
  order(col: string, options?: { ascending?: boolean }) {
    this.sort = [col, options?.ascending !== false]
    return this
  }
  range(a: number, b: number) {
    this.window = [a, b]
    return this
  }
  limit(n: number) {
    this.cap = n
    return this
  }
  maybeSingle() {
    this.pick = 'maybe'
    return this
  }
  single() {
    this.pick = 'one'
    return this
  }
  abortSignal(signal: AbortSignal) {
    this.signal = signal
    return this
  }
  upsert(rows: Row[]) {
    this.op = 'upsert'
    this.payload = rows
    return this
  }
  update(patch: Row) {
    this.op = 'update'
    this.payload = patch
    return this
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert'
    this.payload = Array.isArray(rows) ? rows : [rows]
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  private match = (r: Row) =>
    this.filters.every(([c, op, v]) =>
      op === 'eq' ? r[c] === v
      : op === 'gt' ? String(r[c]) > String(v)
      : op === 'lt' ? String(r[c]) < String(v)
      : op === 'in' ? (v as unknown[]).includes(r[c])
      : r[c] == null,
    )
  private now() {
    return new Date(++this.server.clock).toISOString()
  }
  then<A, B>(ok?: ((v: Result) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve()
      .then(() => {
        const result = this.run()
        return this.server.lost.has(`${this.op} ${this.table}`) ? { data: null, error: LOST } : result
      })
      .then(ok, no)
  }
  private out(rows: Row[]): Result {
    if (this.pick === 'one') {
      if (rows.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
      return { data: clone(rows[0]), error: null }
    }
    if (this.pick === 'maybe') return { data: clone(rows[0]) ?? null, error: null }
    return { data: clone(rows), error: null }
  }
  private run(): Result {
    const s = this.server
    const rows = s.tables[this.table]
    const call = `${this.op} ${this.table}`
    s.calls.push(call)
    const injected = failure(s, call)
    if (injected) return { data: null, error: injected }
    if (this.signal?.aborted) return { data: null, error: ABORTED }
    const me = this.uid()
    if (this.op === 'upsert') {
      if (!me) return { data: null, error: { message: 'denied' } }
      for (const input of this.payload as Row[]) {
        if (input.user_id !== me) return { data: null, error: { message: 'row-level security' } }
        if (this.table === 'plays') {
          // The server's rule: plays land only while sharing, and only those since it last turned on.
          const p = s.tables.profiles.find((r) => r.id === me)
          if (!p?.share_activity || String(input.played_at) < String(p.sharing_since ?? '')) continue
        }
        const key = KEYS[this.table]
        const at = rows.findIndex((r) => key.every((k) => r[k] === input[k]))
        const lib = this.table.startsWith('library_')
        if (at < 0) rows.push({ deleted: false, ...input, ...(lib ? { synced_at: this.now() } : {}) })
        else if (!lib || String(input.updated_at) >= String(rows[at].updated_at)) rows[at] = { ...rows[at], ...input, ...(lib ? { synced_at: this.now() } : {}) }
      }
      return { data: null, error: null }
    }
    if (this.op === 'update') {
      const patch = this.payload as Row
      const hit = rows.filter(this.match)
      if (patch.handle && rows.some((r) => r.handle === patch.handle && r.id !== me)) return { data: null, error: { code: '23505', message: 'duplicate' } }
      const out: Row[] = []
      for (const r of hit) {
        if (r.id !== me) continue
        // Last write wins: an older edit is skipped, and PostgREST returns no row for it (no error either).
        if (patch.updated_at && String(patch.updated_at) < String(r.updated_at)) continue
        if (patch.share_activity === true && !r.share_activity) r.sharing_since = new Date(Date.now()).toISOString()
        Object.assign(r, patch)
        out.push(r)
      }
      return this.out(out)
    }
    if (this.op === 'insert') {
      if (!me) return { data: null, error: { code: '42501', message: 'permission denied' } }
      const added: Row[] = []
      for (const input of this.payload as Row[]) {
        const key = KEYS[this.table]
        let row: Row
        if (this.table === 'follows') {
          if (input.follower_id !== me || !isMember(s, me) || !isVisible(s, input.followee_id)) return { data: null, error: RLS }
          row = { ...input, created_at: this.now() }
        } else if (this.table === 'videos' || this.table === 'posts') {
          if ((input.user_id ?? me) !== me || !isMember(s, me)) return { data: null, error: RLS }
          const base = this.table === 'posts' ? { body: '', image_paths: [] } : { caption: '', still_path: null, duration: 0 }
          row = { id: newId(), user_id: me, youtube_id: null, track_title: null, track_artist: null, ...base, ...input, created_at: this.now(), removed_at: null }
          if (this.table === 'posts' && !String(row.body) && !(row.image_paths as unknown[]).length) return { data: null, error: { code: '23514', message: 'posts_check' } }
        } else if (this.table === 'reports') {
          if ((input.reporter_id ?? me) !== me || !isMember(s, me)) return { data: null, error: RLS }
          row = { id: newId(), reporter_id: me, reason: '', ...input, created_at: this.now(), resolved_at: null }
        } else return { data: null, error: { code: '42501', message: 'permission denied' } }
        if (rows.some((r) => key.every((k) => r[k] === row[k]))) return { data: null, error: { code: '23505', message: 'duplicate key' } }
        added.push(row)
      }
      rows.push(...added)
      return this.returning ? this.out(added) : { data: null, error: null }
    }
    if (this.op === 'delete') {
      const mine = (r: Row) =>
        this.table === 'follows' ? r.follower_id === me && isMember(s, me) : r.user_id === me && isMember(s, me)
      const gone = rows.filter((r) => this.match(r) && mine(r))
      s.tables[this.table] = rows.filter((r) => !gone.includes(r))
      return { data: null, error: null }
    }
    let out = rows.filter((r) => this.match(r) && readable(s, this.table, me, r))
    const count = out.length
    if (this.sort) {
      const [col, up] = this.sort
      out = [...out].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (up ? 1 : -1))
    }
    if (this.window) out = out.slice(this.window[0], this.window[1] + 1)
    if (this.cap !== undefined) out = out.slice(0, this.cap)
    if (this.head) return { data: null, error: null, count: this.counted ? count : null }
    return { ...this.out(out), ...(this.counted ? { count } : {}) }
  }
}

/** A thenable like supabase-js's, so `.abortSignal()` works on rpc() too. */
class Rpc implements PromiseLike<Result> {
  private signal?: AbortSignal
  private server: FakeServer
  private run: () => Result
  private name: string
  constructor(server: FakeServer, name: string, run: () => Result) {
    this.server = server
    this.name = name
    this.run = run
  }
  abortSignal(signal: AbortSignal) {
    this.signal = signal
    return this
  }
  then<A, B>(ok?: ((v: Result) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve()
      .then((): Result => {
        this.server.calls.push(`rpc ${this.name}`)
        const injected = failure(this.server, `rpc ${this.name}`)
        if (injected) return { data: null, error: injected }
        if (this.signal?.aborted) return { data: null, error: ABORTED }
        return this.run()
      })
      .then(ok, no)
  }
}

export const blankRow = (id: string, extra: Row = {}): Row => ({
  id, handle: null, member: true, admin: false, banned: false, name: '', bio: null, colors: null, auto_colors: null,
  frame: null, effect: null, name_style: null, pinned_songs: [], pinned_playlists: [], badges: [],
  avatar_path: null, avatar_still_path: null, avatar_kind: null, avatar_version: null,
  banner_path: null, banner_still_path: null, banner_kind: null, banner_version: null,
  backdrop_path: null, backdrop_still_path: null, backdrop_kind: null, backdrop_version: null,
  crops: {}, share_activity: false, sharing_since: null, created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z', ...extra,
})

/** Someone else on the server: a member with a handle. */
export function addMember(server: FakeServer, id: string, handle: string, extra: Row = {}): Row {
  const row = blankRow(id, { handle, name: handle[0].toUpperCase() + handle.slice(1), ...extra })
  server.tables.profiles.push(row)
  return row
}

/** One device's client. */
export function createClient(server: FakeServer) {
  let session: { user: { id: string; email: string }; access_token: string } | null = null
  const listeners: ((event: string, s: typeof session) => void)[] = []
  const uid = () => session?.user.id
  const ok = (data: unknown = null): Result => ({ data, error: null })
  const notAdmin: Result = { data: null, error: { code: '42501', message: 'admins only' } }
  const now = () => new Date(++server.clock).toISOString()
  const resolve = (match: (r: Row) => boolean) => {
    for (const r of server.tables.reports) if (r.resolved_at == null && match(r)) r.resolved_at = now()
  }
  const clearProfile = (id: unknown) => {
    const p = profile(server, id)
    if (p) Object.assign(p, { name: '', bio: null, pinned_songs: [], avatar_path: null, avatar_still_path: null, avatar_kind: null, banner_path: null, banner_still_path: null, backdrop_path: null, backdrop_still_path: null, crops: {}, updated_at: now() })
  }
  const rpcs: Record<string, (args: Record<string, unknown>) => Result> = {
    redeem_invite: (args) => {
      if (!uid()) return { data: null, error: { message: 'denied' } }
      if (!server.invites.delete(String(args.code))) return ok('invalid')
      const existing = server.tables.profiles.find((r) => r.id === uid())
      if (existing) existing.member = true
      else server.tables.profiles.push(blankRow(uid()!))
      return ok('ok')
    },
    media_left: () => {
      const me = uid()
      if (!me) return { data: null, error: { code: '42501', message: 'permission denied' } }
      if (isAdmin(server, me)) return ok(null)
      if (!isMember(server, me)) return ok(0)
      const mine = [...server.files].filter(([p]) => p.startsWith(`${me}/`))
      if (mine.length >= 2000) return ok(0)
      return ok(Math.max(0, server.quota - mine.reduce((n, [, b]) => n + b.size, 0)))
    },
    luma_search: (args) => {
      if (server.search) return ok(clone(server.search))
      const words = String(args.q ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
      if (!words.length) return ok([])
      const hit = (text: string) => words.every((w) => text.toLowerCase().split(/[^a-z0-9]+/).some((t) => t.startsWith(w)))
      const shown = (id: unknown) => isVisible(server, id) && !!profile(server, id)?.handle
      return ok([
        ...server.tables.profiles.filter((p) => shown(p.id) && hit(`${p.handle} ${p.name}`)).map((p) => ({ kind: 'profile', id: p.id, user_id: p.id, handle: p.handle, title: p.name, rank: 1 })),
        ...server.tables.videos.filter((v) => v.removed_at == null && shown(v.user_id) && hit(`${v.caption} ${v.track_title ?? ''}`)).map((v) => ({ kind: 'video', id: v.id, user_id: v.user_id, handle: profile(server, v.user_id)!.handle, title: v.caption, rank: 1 })),
        ...server.tables.posts.filter((t) => t.removed_at == null && shown(t.user_id) && hit(`${t.body} ${t.track_title ?? ''}`)).map((t) => ({ kind: 'post', id: t.id, user_id: t.user_id, handle: profile(server, t.user_id)!.handle, title: t.body, rank: 1 })),
      ])
    },
    admin_remove: ({ kind, id }) => {
      if (!isAdmin(server, uid())) return notAdmin
      if (kind === 'video' || kind === 'post') {
        for (const r of server.tables[`${kind}s`]) if (r.id === id) r.removed_at = now()
      } else if (kind === 'profile') clearProfile(id)
      else return { data: null, error: { code: '22023', message: 'bad kind' } }
      resolve((r) => r.kind === kind && r.target_id === id)
      return ok()
    },
    admin_ban: ({ target }) => {
      if (!isAdmin(server, uid())) return notAdmin
      const p = profile(server, target)
      if (p?.admin) return notAdmin
      if (p) p.banned = true
      else server.tables.profiles.push(blankRow(String(target), { member: false, banned: true }))
      resolve((r) => r.kind === 'profile' && r.target_id === target)
      return ok()
    },
    admin_purge: ({ target }) => {
      if (!isAdmin(server, uid())) return notAdmin
      if (!profile(server, target)?.banned) return { data: null, error: { code: '22023', message: 'ban the account first' } }
      const theirs = new Set<unknown>()
      for (const table of ['videos', 'posts']) {
        for (const r of server.tables[table]) {
          if (r.user_id !== target) continue
          r.removed_at ??= now()
          theirs.add(`${table.slice(0, -1)}:${r.id}`)
        }
      }
      clearProfile(target)
      resolve((r) => (r.kind === 'profile' && r.target_id === target) || theirs.has(`${r.kind}:${r.target_id}`))
      return ok()
    },
    admin_dismiss: ({ kind, id }) => {
      if (!isAdmin(server, uid())) return notAdmin
      if (kind !== 'profile' && kind !== 'video' && kind !== 'post') return { data: null, error: { code: '22023', message: 'bad kind' } }
      resolve((r) => r.kind === kind && r.target_id === id)
      return ok()
    },
    create_invites: ({ n = 1 }) => {
      if (!isAdmin(server, uid())) return notAdmin
      const codes = Array.from({ length: Number(n) }, () => `CODE${server.invites.size + 1}X${Math.random().toString(36).slice(2, 6).toUpperCase()}`)
      for (const code of codes) server.invites.add(code)
      return ok(codes.map((code) => ({ code, expires_at: new Date(server.clock + 30 * 86400_000).toISOString() })))
    },
  }
  const mayWrite = (path: string) => (path.startsWith(`${uid()}/`) && isMember(server, uid())) || isAdmin(server, uid())
  return {
    get session() {
      return session
    },
    from: (table: string) => new Query(server, table, uid),
    rpc: (name: string, args: Record<string, unknown> = {}) =>
      new Rpc(server, name, () => (rpcs[name] ? rpcs[name](args) : { data: null, error: { code: 'PGRST202', message: `no function ${name}` } })),
    storage: {
      from: () => ({
        upload: async (path: string, blob: Blob) => {
          server.calls.push(`upload ${path}`)
          const injected = failure(server, `upload ${path}`)
          if (injected) return { data: null, error: injected }
          if (!path.startsWith(`${uid()}/`)) return { data: null, error: { message: 'row-level security' } }
          server.files.set(path, blob)
          server.fileTimes.set(path, Date.now())
          return { data: { path }, error: null }
        },
        remove: async (paths: string[]) => {
          server.calls.push(`remove ${paths.join(' ')}`)
          const injected = failure(server, 'remove')
          if (injected) return { data: null, error: injected }
          const gone = paths.filter((p) => server.files.has(p) && mayWrite(p))
          for (const p of gone) {
            server.files.delete(p)
            server.fileTimes.delete(p)
          }
          return { data: gone.map((name) => ({ name })), error: null }
        },
        list: async (folder: string, options?: { limit?: number }) => {
          server.calls.push(`list ${folder}`)
          const injected = failure(server, `list ${folder}`)
          if (injected) return { data: null, error: injected }
          const mine = folder.startsWith(`${uid()}/`) || isAdmin(server, uid())
          const entries = mine
            ? [...server.files].filter(([p]) => p.startsWith(`${folder}/`) && !p.slice(folder.length + 1).includes('/')).map(([p, b]) => ({
                name: p.slice(folder.length + 1), id: `file:${p}`, created_at: new Date(server.fileTimes.get(p) ?? Date.now()).toISOString(), metadata: { size: b.size },
              }))
            : []
          return { data: entries.slice(0, options?.limit ?? 100), error: null }
        },
      }),
    },
    auth: {
      onAuthStateChange: (cb: (event: string, s: typeof session) => void) => {
        listeners.push(cb)
        return { data: { subscription: { unsubscribe() {} } } }
      },
      getSession: async () => ({ data: { session } }),
      signInWithOtp: async ({ email }: { email: string }) => {
        server.calls.push(`otp ${email}`)
        server.codes.set(email, '123456')
        return { error: null }
      },
      verifyOtp: async ({ email, token }: { email: string; token: string }) => {
        if (server.codes.get(email) !== token) return { data: { user: null }, error: { message: 'invalid' } }
        if (!server.users.has(email)) server.users.set(email, `user-${server.users.size + 1}`)
        const id = server.users.get(email)!
        session = { user: { id, email }, access_token: `token-${id}` }
        listeners.forEach((l) => l('SIGNED_IN', session))
        return { data: { user: session.user, session }, error: null }
      },
      signOut: async () => {
        session = null
        listeners.forEach((l) => l('SIGNED_OUT', null))
        return { error: null }
      },
    },
  }
}

/** A fetch for public media URLs, served from the fake bucket. */
export function mediaFetch(server: FakeServer) {
  return async (url: string) => {
    const path = decodeURIComponent(String(url).split('/object/public/media/')[1] ?? '')
    const blob = server.files.get(path)
    return blob ? new Response(blob) : new Response(null, { status: 404 })
  }
}
