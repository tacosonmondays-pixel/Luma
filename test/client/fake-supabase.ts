// An in-memory stand-in for supabase-js, enough for account.ts and sync.ts: tables with the server's
// last-write-wins rule, the media bucket, the RPCs and email-code sign-in. Shared by "devices" in a test.

type Row = Record<string, unknown>

export interface FakeServer {
  tables: Record<string, Row[]>
  files: Map<string, Blob>
  calls: string[]
  codes: Map<string, string> // email → the code "sent"
  invites: Set<string>
  users: Map<string, string> // email → id
  clock: number
}

export function createServer(): FakeServer {
  return {
    tables: { profiles: [], library_tracks: [], library_playlists: [], plays: [] },
    files: new Map(),
    calls: [],
    codes: new Map(),
    invites: new Set(),
    users: new Map(),
    clock: Date.parse('2026-11-01T00:00:00Z'),
  }
}

const KEYS: Record<string, string[]> = {
  profiles: ['id'],
  library_tracks: ['user_id', 'id'],
  library_playlists: ['user_id', 'id'],
  plays: ['user_id', 'track_id', 'played_at'],
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: [string, string, unknown][] = []
  private op: 'select' | 'upsert' | 'update' = 'select'
  private payload: unknown
  private single = false
  private window?: [number, number]
  private sort?: string
  private server: FakeServer
  private table: string
  private uid: () => string | undefined
  constructor(server: FakeServer, table: string, uid: () => string | undefined) {
    this.server = server
    this.table = table
    this.uid = uid
  }
  select() {
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
  order(col: string) {
    this.sort = col
    return this
  }
  range(a: number, b: number) {
    this.window = [a, b]
    return this
  }
  maybeSingle() {
    this.single = true
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
  private match = (r: Row) =>
    this.filters.every(([c, op, v]) => (op === 'eq' ? r[c] === v : String(r[c]) > String(v)))
  private now() {
    return new Date(++this.server.clock).toISOString()
  }
  then<A, B>(ok?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, no)
  }
  private run(): { data: unknown; error: unknown } {
    const s = this.server
    const rows = s.tables[this.table]
    s.calls.push(`${this.op} ${this.table}`)
    const me = this.uid()
    if (this.op === 'upsert') {
      if (!me) return { data: null, error: { message: 'denied' } }
      for (const input of this.payload as Row[]) {
        if (input.user_id !== me) return { data: null, error: { message: 'row-level security' } }
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
      for (const r of hit) {
        if (r.id !== me) continue
        if (patch.updated_at && String(patch.updated_at) < String(r.updated_at)) continue
        Object.assign(r, patch)
      }
      const out = hit.filter((r) => r.id === me)
      return { data: this.single ? (out[0] ?? null) : out, error: null }
    }
    let out = rows.filter(this.match)
    if (this.table.startsWith('library_') || this.table === 'plays') out = out.filter((r) => r.user_id === me)
    if (this.sort) out = [...out].sort((a, b) => String(a[this.sort!]).localeCompare(String(b[this.sort!])))
    if (this.window) out = out.slice(this.window[0], this.window[1] + 1)
    return { data: this.single ? (structuredClone(out[0]) ?? null) : structuredClone(out), error: null }
  }
}

export const blankRow = (id: string, extra: Row = {}): Row => ({
  id, handle: null, member: true, admin: false, banned: false, name: '', bio: null, colors: null, auto_colors: null,
  frame: null, effect: null, name_style: null, pinned_songs: [], pinned_playlists: [], badges: [],
  avatar_path: null, avatar_still_path: null, avatar_kind: null, avatar_version: null,
  banner_path: null, banner_still_path: null, banner_kind: null, banner_version: null,
  backdrop_path: null, backdrop_still_path: null, backdrop_kind: null, backdrop_version: null,
  crops: {}, share_activity: false, created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z', ...extra,
})

/** One device's client. */
export function createClient(server: FakeServer) {
  let session: { user: { id: string; email: string } } | null = null
  const listeners: ((event: string, s: typeof session) => void)[] = []
  const uid = () => session?.user.id
  return {
    get session() {
      return session
    },
    from: (table: string) => new Query(server, table, uid),
    rpc: async (name: string, args: { code: string }) => {
      server.calls.push(`rpc ${name}`)
      if (name !== 'redeem_invite' || !uid()) return { data: null, error: { message: 'denied' } }
      if (!server.invites.delete(args.code)) return { data: 'invalid', error: null }
      const existing = server.tables.profiles.find((r) => r.id === uid())
      if (existing) existing.member = true
      else server.tables.profiles.push(blankRow(uid()!))
      return { data: 'ok', error: null }
    },
    storage: {
      from: () => ({
        upload: async (path: string, blob: Blob) => {
          server.calls.push(`upload ${path}`)
          if (!path.startsWith(`${uid()}/`)) return { data: null, error: { message: 'row-level security' } }
          server.files.set(path, blob)
          return { data: { path }, error: null }
        },
        remove: async (paths: string[]) => {
          for (const p of paths) server.files.delete(p)
          return { data: null, error: null }
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
        session = { user: { id: server.users.get(email)!, email } }
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
