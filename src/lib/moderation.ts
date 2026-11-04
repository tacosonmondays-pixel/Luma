// Moderation, for admins: open reports, Remove, Ban, Dismiss and invites. Files go before rows, so a public URL dies
// first, and every step can simply run again: removing files that are gone succeeds, and the RPCs are idempotent.
// Unban, the banned list and report history stay in the SQL Editor.

import { banLocally, currentMe, forgetPerson, hide, keyOf, loadPeople, POST, postOf, VIDEO, type Person, type Post } from './social.ts'
import { BUCKET, supabase } from './supabase.ts'
import { REPORT_REASONS, type ReportKind, type ReportReason } from '../types.ts'

/** Every open report on one target. */
export interface ReportGroup {
  key: string // kind:target_id
  kind: ReportKind
  targetId: string
  /** The distinct reasons, most frequent first. */
  reasons: ReportReason[]
  /** The newest report's time. */
  at: string
  /** The profile reported, or the post's author (when they still load). */
  person?: Person
  /** The post or video reported (when it still loads). */
  post?: Post
}

const isAdmin = () => !!currentMe()?.admin
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

/** Whether any report is open (a head count). False for everyone but admins, and on errors. */
export async function hasOpenReports(): Promise<boolean> {
  if (!isAdmin()) return false
  try {
    const sb = await supabase()
    const { count, error } = await sb.from('reports').select('id', { count: 'exact', head: true }).is('resolved_at', null)
    return !error && (count ?? 0) > 0
  } catch {
    return false
  }
}

/** Up to 200 open reports, one group per target, newest first. Null on an error. */
export async function loadReports(): Promise<ReportGroup[] | null> {
  if (!isAdmin()) return null
  try {
    const sb = await supabase()
    const { data, error } = await sb.from('reports').select('id,kind,target_id,reason,created_at').is('resolved_at', null)
      .order('created_at', { ascending: false }).limit(200)
    if (error || !Array.isArray(data)) return null
    const groups = new Map<string, ReportGroup & { counts: Map<ReportReason, number> }>()
    for (const r of data.filter(isObject)) {
      const { kind, target_id: targetId, created_at: at } = r
      if ((kind !== 'profile' && kind !== 'video' && kind !== 'post') || typeof targetId !== 'string' || typeof at !== 'string') continue
      const key = `${kind}:${targetId}`
      let group = groups.get(key)
      if (!group) groups.set(key, (group = { key, kind, targetId, reasons: [], at, counts: new Map() }))
      const reason: ReportReason = (REPORT_REASONS as readonly unknown[]).includes(r.reason) ? (r.reason as ReportReason) : 'other'
      group.counts.set(reason, (group.counts.get(reason) ?? 0) + 1)
    }
    const ids = (kind: ReportKind) => [...groups.values()].filter((g) => g.kind === kind).map((g) => g.targetId)
    const fill = (table: 'videos' | 'posts', columns: string, list: string[]) =>
      list.length ? sb.from(table).select(columns).in('id', list) : Promise.resolve({ data: [] as unknown, error: null })
    const [v, p] = await Promise.all([fill('videos', VIDEO, ids('video')), fill('posts', POST, ids('post'))])
    if (v.error || p.error) return null
    const posts = new Map(
      [
        ...(Array.isArray(v.data) ? v.data : []).map((row) => postOf('video', row)),
        ...(Array.isArray(p.data) ? p.data : []).map((row) => postOf('post', row)),
      ].filter((x): x is Post => !!x).map((x) => [keyOf(x), x]),
    )
    const people = (await loadPeople([...ids('profile'), ...[...posts.values()].map((x) => x.userId)])) ?? {}
    return [...groups.values()].map(({ counts, ...g }) => {
      const post = posts.get(g.key)
      return {
        ...g,
        reasons: [...counts].sort((a, b) => b[1] - a[1]).map(([reason]) => reason), // a stable sort: ties keep first-seen order
        post,
        person: people[post ? post.userId : g.targetId],
      }
    })
  } catch {
    return null
  }
}

/** Remove a post or video: its files first (on an error, nothing else happens), then the row, which resolves its
 * reports. Hidden here once done. */
export async function removeContent(target: { kind: 'video' | 'post'; id: string; paths: readonly string[] }): Promise<boolean> {
  if (!isAdmin()) return false
  try {
    const sb = await supabase()
    if (target.paths.length) {
      const { error } = await sb.storage.from(BUCKET).remove([...target.paths])
      if (error) return false
    }
    const { error } = await sb.rpc('admin_remove', { kind: target.kind, id: target.id })
    if (error) return false
    hide(target.kind, target.id)
    return true
  } catch {
    return false
  }
}

/** Clear a profile: its files, then its name, bio, pins and media (their devices pull the cleared row). */
export async function removeProfile(id: string): Promise<boolean> {
  const me = currentMe()
  if (!me?.admin || id === me.id) return false
  try {
    if (!(await removeFolder(id, 'profile'))) return false
    const sb = await supabase()
    const { error } = await sb.rpc('admin_remove', { kind: 'profile', id })
    if (error) return false
    forgetPerson(id)
    return true
  } catch {
    return false
  }
}

/** Ban for good: writes stop and everything hides (admin_ban), their posts and profile go (admin_purge), then every
 * file they have. Each step is idempotent, so a failed ban runs again from the same menu. */
export async function ban(target: string): Promise<boolean> {
  const me = currentMe()
  if (!me?.admin || target === me.id) return false
  try {
    const sb = await supabase()
    if ((await sb.rpc('admin_ban', { target })).error) return false
    if ((await sb.rpc('admin_purge', { target })).error) return false
    for (const sub of ['profile', 'videos', 'posts'] as const) if (!(await removeFolder(target, sub))) return false
    banLocally(target)
    return true
  } catch {
    return false
  }
}

/** Close a target's open reports and leave it be. */
export async function dismiss(kind: ReportKind, id: string): Promise<boolean> {
  if (!isAdmin()) return false
  try {
    const sb = await supabase()
    const { error } = await sb.rpc('admin_dismiss', { kind, id })
    return !error
  } catch {
    return false
  }
}

/** One single-use invite code, good for 30 days. */
export async function createInvite(): Promise<string | null> {
  if (!isAdmin()) return null
  try {
    const sb = await supabase()
    const { data, error } = await sb.rpc('create_invites', { n: 1, days: 30 })
    const code = !error && Array.isArray(data) && isObject(data[0]) ? data[0].code : undefined
    return typeof code === 'string' && /^[A-Z0-9]{6,32}$/.test(code) ? code : null
  } catch {
    return null
  }
}

/** Delete every file in someone's folder: a page of 1000 at a time, removed 100 at a time, until it is empty. */
export async function removeFolder(owner: string, sub: 'profile' | 'videos' | 'posts'): Promise<boolean> {
  if (!isAdmin() || !owner || owner.includes('/') || owner.includes('..')) return false
  try {
    const sb = await supabase()
    const bucket = sb.storage.from(BUCKET)
    const folder = `${owner}/${sub}`
    for (let round = 0; round < 50; round++) {
      const { data, error } = await bucket.list(folder, { limit: 1000 })
      if (error) return false
      const paths = (data ?? []).filter((o) => o.id && o.name).map((o) => `${folder}/${o.name}`) // files (folders have no id)
      if (!paths.length) return true
      let gone = 0
      for (let i = 0; i < paths.length; i += 100) {
        const removed = await bucket.remove(paths.slice(i, i + 100))
        if (removed.error) return false
        gone += removed.data?.length ?? 0
      }
      if (!gone) return false // nothing went: stop instead of listing the same files forever
    }
    return false
  } catch {
    return false
  }
}
