// Social: friends' plays and posts, people, follows, reports and Luma search. The feed, follows, reports and search
// are for signed-in members; a public profile's posts and follow lists load for anyone (they're public reads).
//
// Nothing here is persisted. Every loader resolves null on any error, and a surface with null renders nothing: offline,
// or with the server down, the app is exactly the app without it. Each call that needs a session checks for one before
// it touches supabase(), so a signed-out start never loads supabase-js from here.
//
// Rows are anyone's JSON: personOf and postOf keep only what is well-formed (paths in the owner's own folder, known ids).

import { useMemo, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { HANDLE, colorsOf, cropOf, ownPath, profilePath, useAccount } from './account.ts'
import { mediaUrl, supabase } from './supabase.ts'
import {
  NAME_STYLE_IDS, REPORT_REASONS,
  type Crop, type LumaSearchRow, type NameStyleId, type PlayRow, type ProfileRow, type ReportKind, type ReportReason,
} from '../types.ts'

// ── Shapes ───────────────────────────────────────────────────────────────

export interface Person {
  id: string
  handle: string
  name: string
  avatar?: string // the still's public URL: lists never animate
  crop?: Crop
  nameStyle?: NameStyleId
  colors?: [string, string]
  autoColors?: [string, string]
  admin: boolean
  banned: boolean
}

/** A song in a play, post or video: metadata only, never audio. */
export interface Song {
  youtubeId?: string
  title: string
  artist: string
}

/** A post or a video (one noun in the app; two tables on the server). */
export interface Post {
  kind: 'post' | 'video'
  id: string
  userId: string
  text: string
  createdAt: string
  images: string[] // public URLs
  video?: { url: string; still?: string; duration: number }
  song?: Song
  paths: string[] // storage paths (delete, remove)
}

/** A song friends played lately, with up to 3 of them, newest first. */
export interface FriendPlay {
  key: string
  song: Song
  userIds: string[]
}

export type LumaHit = { kind: 'person'; person: Person } | { kind: 'post'; post: Post }

export interface Feed {
  plays: FriendPlay[]
  posts: Post[]
  at: number // when it loaded; 0 marks it stale
}

/** Someone's posts, newest first, a page at a time. */
export interface PostList {
  items: Post[]
  cursor?: string // the last taken createdAt
  done: boolean
  at: number
}

/** The signed-in member, online. */
export interface Me {
  id: string
  handle: string
  admin: boolean
}

// ── Columns ──────────────────────────────────────────────────────────────

export const PERSON = 'id,handle,name,name_style,colors,auto_colors,admin,banned,avatar_path,avatar_still_path,avatar_kind,crops'
export const VIDEO = 'id,user_id,path,still_path,caption,youtube_id,track_title,track_artist,duration,created_at'
export const POST = 'id,user_id,body,image_paths,youtube_id,track_title,track_artist,created_at' // song columns: 0002
export const PLAY = 'user_id,track_id,youtube_id,title,artist,played_at'

const PAGE = 24
const MINUTE = 60_000
const FRESH_MINE = 5 * MINUTE
const DAY = 24 * 60 * MINUTE
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

// ── Reading rows (pure, tested) ──────────────────────────────────────────

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'

/** A profile row as a person in a list, or undefined when it has no valid handle. */
export function personOf(row: unknown): Person | undefined {
  if (!isObject(row)) return
  const r = row as Partial<ProfileRow>
  if (typeof r.id !== 'string' || !r.id || typeof r.handle !== 'string' || !HANDLE.test(r.handle)) return
  const still = profilePath(r as ProfileRow, r.avatar_kind === 'image' ? r.avatar_path : r.avatar_still_path)
  return {
    id: r.id,
    handle: r.handle,
    name: str(r.name, 40),
    avatar: still ? mediaUrl(still) : undefined,
    crop: cropOf(isObject(r.crops) ? r.crops.avatar : undefined),
    nameStyle: (NAME_STYLE_IDS as readonly unknown[]).includes(r.name_style) ? r.name_style! : undefined,
    colors: colorsOf(r.colors),
    autoColors: colorsOf(r.auto_colors),
    admin: r.admin === true,
    banned: r.banned === true,
  }
}

/** The song a row is set to: present only with a title. */
export function songOf(youtubeId: unknown, title: unknown, artist: unknown): Song | undefined {
  if (typeof title !== 'string' || !title.trim()) return
  return {
    youtubeId: typeof youtubeId === 'string' && YOUTUBE_ID.test(youtubeId) ? youtubeId : undefined,
    title: title.slice(0, 300),
    artist: str(artist, 300),
  }
}

/** A `videos` or `posts` row as a post, or undefined when there is nothing well-formed to show. */
export function postOf(kind: Post['kind'], row: unknown): Post | undefined {
  if (!isObject(row)) return
  const { id, user_id: userId, created_at: createdAt } = row
  if (typeof id !== 'string' || !id || typeof userId !== 'string' || !userId || typeof createdAt !== 'string') return
  const song = songOf(row.youtube_id, row.track_title, row.track_artist)
  if (kind === 'video') {
    const own = (p: unknown) => ownPath(userId, 'videos', p)
    const path = own(row.path)
    if (!path) return
    const still = own(row.still_path)
    const duration = typeof row.duration === 'number' && Number.isFinite(row.duration) && row.duration > 0 ? row.duration : 0
    return {
      kind, id, userId, createdAt, song, images: [],
      text: str(row.caption, 300),
      video: { url: mediaUrl(path), still: still ? mediaUrl(still) : undefined, duration },
      paths: still ? [path, still] : [path],
    }
  }
  const paths = (Array.isArray(row.image_paths) ? row.image_paths : [])
    .map((p) => ownPath(userId, 'posts', p))
    .filter((p): p is string => !!p)
    .slice(0, 4)
  const text = str(row.body, 1000)
  if (!text.trim() && !paths.length) return
  return { kind, id, userId, createdAt, song, text, images: paths.map(mediaUrl), paths }
}

/** `kind:id`, the key `hidden` and reports use. */
export const keyOf = (p: { kind: string; id: string }): string => `${p.kind}:${p.id}`

const time = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}
/** Newest first. The text breaks ties below a millisecond (the server keeps microseconds). */
const newestFirst = (a: string, b: string) => time(b) - time(a) || (a < b ? 1 : a > b ? -1 : 0)
const byNewest = (a: { createdAt: string }, b: { createdAt: string }) => newestFirst(a.createdAt, b.createdAt)

/** Friends' plays as songs: the newest play of each (by YouTube id, else title and artist), newest first, with up
 * to 3 of the friends who played it. */
export function friendsListening(rows: readonly PlayRow[], n = 20): FriendPlay[] {
  const plays = rows
    .filter((r) => isObject(r) && typeof r.user_id === 'string' && typeof r.played_at === 'string')
    .sort((a, b) => newestFirst(a.played_at, b.played_at))
  const songs = new Map<string, FriendPlay>()
  for (const r of plays) {
    const song = songOf(r.youtube_id, r.title, r.artist)
    if (!song) continue
    const key = song.youtubeId ?? `${song.title.toLowerCase()}|${song.artist.toLowerCase()}`
    let item = songs.get(key)
    if (!item) {
      if (songs.size >= n) continue
      songs.set(key, (item = { key, song, userIds: [] }))
    }
    if (item.userIds.length < 3 && !item.userIds.includes(r.user_id)) item.userIds.push(r.user_id)
  }
  return [...songs.values()]
}

/** Videos and posts together, newest first: none hidden here, none by someone unknown or banned. */
export function mergePosts(
  a: readonly Post[],
  b: readonly Post[],
  n: number,
  { hidden, people }: { hidden: ReadonlySet<string>; people: Readonly<Record<string, Person>> },
): Post[] {
  const seen = new Set<string>()
  return [...a, ...b]
    .filter((p) => {
      const key = keyOf(p)
      const author = people[p.userId]
      if (seen.has(key) || hidden.has(key) || !author || author.banned) return false
      seen.add(key)
      return true
    })
    .sort(byNewest)
    .slice(0, n)
}

/** One page over two tables, each fetched newest first with `created_at < cursor` and `limit(n)`: the newest `n` of
 * both. The next page starts below the last one taken; done when neither table had more and all were taken. */
export function takePage<T extends { createdAt: string }>(videos: readonly T[], posts: readonly T[], n: number): { items: T[]; cursor?: string; done: boolean } {
  const all = [...videos, ...posts].sort(byNewest)
  const items = all.slice(0, n)
  return { items, cursor: items.at(-1)?.createdAt, done: videos.length < n && posts.length < n && all.length <= n }
}

// ── Gates ────────────────────────────────────────────────────────────────

/** `navigator.onLine`, where there is one. */
export const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false

function meOf(userId: string | undefined, row: ProfileRow | null | undefined, online: boolean): Me | undefined {
  if (!online || !userId || !row || row.id !== userId || !row.member || row.banned || !row.handle) return
  return { id: row.id, handle: row.handle, admin: row.admin === true }
}

/** The member signed in here, while online: undefined for signed-out visitors, non-members and banned accounts. */
export const currentMe = (): Me | undefined => {
  const { user, row } = useAccount.getState()
  return meOf(user?.id, row, isOnline())
}

const signedIn = () => !!useAccount.getState().user && isOnline()

const onOnline = (cb: () => void) => {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(onOnline, isOnline, () => true)
}

/** Signed in (member or not) and online. */
export function useSignedIn(): boolean {
  const online = useOnline()
  const user = useAccount((s) => !!s.user)
  return online && user
}

/** The signed-in member while online, else undefined. "Member" in the social screens means this is set. */
export function useMe(): Me | undefined {
  const online = useOnline()
  const userId = useAccount((s) => s.user?.id)
  const row = useAccount((s) => s.row)
  return useMemo(() => meOf(userId, row, online), [userId, row, online])
}

// ── Store ────────────────────────────────────────────────────────────────

export interface SocialState {
  /** Who I follow: undefined until loaded. */
  following?: string[]
  /** `kind:id` of what I reported or deleted (this session, and my reports from the server): hidden for me. */
  hidden: ReadonlySet<string>
  /** Everyone loaded this session, by id. */
  people: Record<string, Person>
  /** Home's feed: undefined until loaded, null when it failed. */
  feed?: Feed | null
  /** Each profile's posts, by user id. */
  lists: Record<string, PostList>
}

const initial = (): SocialState => ({ following: undefined, hidden: new Set(), people: {}, feed: undefined, lists: {} })

export const useSocial = create<SocialState>()(initial)

const { getState, setState } = useSocial

/** Bumped on every reset: an answer that arrives after one belongs to the previous account and is dropped. */
let epoch = 0
let mineAt = 0
const running = new Map<string, Promise<unknown>>()

/** Forget everything social (a sign-out or another account). No network. */
export function resetSocial(): void {
  epoch++
  mineAt = 0
  running.clear()
  justPosted.length = 0
  setState(initial(), true)
}

/** One call at a time per key: a second caller gets the first one's answer. */
function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const current = running.get(key) as Promise<T> | undefined
  if (current) return current
  const p: Promise<T> = run().finally(() => {
    if (running.get(key) === p) running.delete(key)
  })
  running.set(key, p)
  return p
}

const rowsOf = (data: unknown): Record<string, unknown>[] => (Array.isArray(data) ? data.filter(isObject) : [])
const chunks = <T,>(list: readonly T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

/** Puts a post back in date order, unless it is already there. */
const withPost = (items: readonly Post[], post: Post) => (items.some((p) => keyOf(p) === keyOf(post)) ? [...items] : [...items, post].sort(byNewest))

/** Hide `kind:id` here at once: into `hidden`, and out of the feed and every list. Returns the undo. */
export function hide(kind: ReportKind, id: string): () => void {
  const key = `${kind}:${id}`
  const s = getState()
  if (s.hidden.has(key)) return () => {}
  const at = epoch
  const fromLists = Object.entries(s.lists).flatMap(([user, l]) => l.items.filter((p) => keyOf(p) === key).map((post) => ({ user, post })))
  const fromFeed = s.feed?.posts.filter((p) => keyOf(p) === key) ?? []
  setState((s) => ({
    hidden: new Set(s.hidden).add(key),
    lists: fromLists.length
      ? Object.fromEntries(Object.entries(s.lists).map(([user, l]) => [user, { ...l, items: l.items.filter((p) => keyOf(p) !== key) }]))
      : s.lists,
    feed: s.feed && fromFeed.length ? { ...s.feed, posts: s.feed.posts.filter((p) => keyOf(p) !== key) } : s.feed,
  }))
  return () => {
    if (at !== epoch) return
    setState((s) => {
      const hidden = new Set(s.hidden)
      hidden.delete(key)
      const lists = { ...s.lists }
      for (const { user, post } of fromLists) if (lists[user]) lists[user] = { ...lists[user], items: withPost(lists[user].items, post) }
      let feed = s.feed
      for (const post of fromFeed) if (feed) feed = { ...feed, posts: withPost(feed.posts, post) }
      return { hidden, lists, feed }
    })
  }
}

/** Posts this device published this session: a list that loaded meanwhile still shows them. */
const justPosted: Post[] = []

/** A post I just published: first in my list. */
export function addMine(post: Post): void {
  justPosted.push(post)
  setState((s) => {
    const list = s.lists[post.userId]
    return { lists: { ...s.lists, [post.userId]: list ? { ...list, items: withPost(list.items, post) } : { items: [post], done: false, at: 0 } } }
  })
}

/** After a ban: they and their posts are gone from everything loaded here. */
export function banLocally(userId: string): void {
  setState((s) => {
    const person = s.people[userId]
    return {
      people: person ? { ...s.people, [userId]: { ...person, banned: true } } : s.people,
      feed: s.feed && { ...s.feed, posts: s.feed.posts.filter((p) => p.userId !== userId), at: 0 },
      lists: Object.fromEntries(Object.entries(s.lists).map(([user, l]) => [user, { ...l, items: l.items.filter((p) => p.userId !== userId) }])),
    }
  })
}

/** Someone read from their own row (their profile page): lists and the Viewer needn't ask for them again. */
export function rememberPerson(person: Person): void {
  setState((s) => ({ people: { ...s.people, [person.id]: person } }))
}

/** Load this person again next time (their profile changed on the server). */
export function forgetPerson(id: string): void {
  setState((s) => {
    const people = { ...s.people }
    delete people[id]
    return { people }
  })
}

// ── Follows and reports ──────────────────────────────────────────────────

/** Who I follow and what I reported, once a session (again when the app shows after 5 minutes). */
export function loadMine(force = false): Promise<boolean> {
  const me = currentMe()
  if (!me) return Promise.resolve(false)
  if (!force && getState().following && Date.now() - mineAt < FRESH_MINE) return Promise.resolve(true)
  return once('mine', async () => {
    const at = epoch
    try {
      const sb = await supabase()
      const [f, r] = await Promise.all([
        sb.from('follows').select('followee_id').eq('follower_id', me.id).limit(1000),
        sb.from('reports').select('kind,target_id').eq('reporter_id', me.id).limit(1000),
      ])
      if (f.error || r.error || at !== epoch) return false
      const following = rowsOf(f.data).flatMap((row) => (typeof row.followee_id === 'string' ? [row.followee_id] : []))
      const reported = rowsOf(r.data).flatMap((row) => (typeof row.kind === 'string' && typeof row.target_id === 'string' ? [`${row.kind}:${row.target_id}`] : []))
      setState((s) => {
        const before = s.following
        const changed = !before || before.length !== following.length || following.some((id) => !before.includes(id))
        return {
          following,
          hidden: new Set([...s.hidden, ...reported]),
          feed: changed && s.feed ? { ...s.feed, at: 0 } : s.feed,
        }
      })
      mineAt = Date.now()
      return true
    } catch {
      return false
    }
  })
}

/** Follow at once; the server agrees or it's undone. Already following (on another device) counts as done. One
 * follow or unfollow per person at a time: a press while one is on its way gets that one's answer and changes
 * nothing (two in flight could land, or be undone, in the wrong order). */
export function follow(id: string): Promise<boolean> {
  return once(`follow:${id}`, async () => {
    const me = currentMe()
    if (!me || id === me.id) return false
    if (getState().following?.includes(id)) return true
    const at = epoch
    setState((s) => ({ following: [...(s.following ?? []), id], feed: s.feed && { ...s.feed, at: 0 } }))
    try {
      const sb = await supabase()
      const { error } = await sb.from('follows').insert({ follower_id: me.id, followee_id: id })
      if (!error || error.code === '23505') return true
    } catch {}
    if (at === epoch) setState((s) => ({ following: s.following?.filter((f) => f !== id) }))
    return false
  })
}

/** Unfollow at once; undone if the server refuses. One at a time per person, with follow. */
export function unfollow(id: string): Promise<boolean> {
  return once(`follow:${id}`, async () => {
    const me = currentMe()
    if (!me || !getState().following?.includes(id)) return false
    const at = epoch
    setState((s) => ({ following: s.following?.filter((f) => f !== id), feed: s.feed && { ...s.feed, at: 0 } }))
    try {
      const sb = await supabase()
      const { error } = await sb.from('follows').delete().eq('follower_id', me.id).eq('followee_id', id)
      if (!error) return true
    } catch {}
    if (at === epoch) setState((s) => ({ following: s.following?.includes(id) ? s.following : [...(s.following ?? []), id] }))
    return false
  })
}

/** Report a profile, post or video. It hides here at once; already reported counts as done; anything else (50 open
 * reports included) quietly undoes it. */
export async function report(kind: ReportKind, id: string, reason: ReportReason): Promise<boolean> {
  const me = currentMe()
  if (!me || !(REPORT_REASONS as readonly string[]).includes(reason) || (kind === 'profile' && id === me.id)) return false
  const undo = hide(kind, id)
  try {
    const sb = await supabase()
    const { error } = await sb.from('reports').insert({ kind, target_id: id, reason })
    if (!error || error.code === '23505') return true
  } catch {}
  undo()
  return false
}

// ── Loading ──────────────────────────────────────────────────────────────

/** Fills `people` with whoever isn't loaded yet. Resolves everyone loaded, or null on an error. */
export async function loadPeople(ids: readonly string[]): Promise<Record<string, Person> | null> {
  const known = getState().people
  const missing = [...new Set(ids)].filter((id) => typeof id === 'string' && id && !known[id])
  if (!missing.length) return known
  if (!isOnline()) return null
  const at = epoch
  try {
    const sb = await supabase()
    const answers = await Promise.all(chunks(missing, 100).map((ids) => sb.from('profiles').select(PERSON).in('id', ids)))
    if (answers.some((a) => a.error) || at !== epoch) return null
    const found = answers.flatMap((a) => rowsOf(a.data)).map(personOf).filter((p): p is Person => !!p)
    if (found.length) setState((s) => ({ people: { ...s.people, ...Object.fromEntries(found.map((p) => [p.id, p])) } }))
    return getState().people
  } catch {
    return null
  }
}

/** Home's feed: friends' plays from the last week and their newest posts. Cached for a minute. */
export function loadFeed(): Promise<Feed | null> {
  const me = currentMe()
  if (!me) return Promise.resolve(null)
  const cached = getState().feed
  if (cached && cached.at && Date.now() - cached.at < MINUTE) return Promise.resolve(cached)
  return once('feed', async () => {
    const at = epoch
    const fail = () => {
      if (at === epoch) setState({ feed: null })
      return null
    }
    try {
      if (!getState().following && !(await loadMine())) return fail()
      const following = getState().following ?? []
      if (!following.length) {
        const feed: Feed = { plays: [], posts: [], at: Date.now() }
        if (at === epoch) setState({ feed })
        return feed
      }
      const sb = await supabase()
      const week = ago(7 * DAY)
      const parts = await Promise.all(
        chunks(following, 100).map((ids) =>
          Promise.all([
            sb.from('plays').select(PLAY).in('user_id', ids).gt('played_at', week).order('played_at', { ascending: false }).limit(200),
            sb.from('videos').select(VIDEO).in('user_id', ids).is('removed_at', null).order('created_at', { ascending: false }).limit(30),
            sb.from('posts').select(POST).in('user_id', ids).is('removed_at', null).order('created_at', { ascending: false }).limit(30),
          ]),
        ),
      )
      if (parts.flat().some((a) => a.error)) return fail()
      const plays = parts.flatMap(([p]) => rowsOf(p.data)) as unknown as PlayRow[]
      const videos = parts.flatMap(([, v]) => rowsOf(v.data).flatMap((r) => postOf('video', r) ?? []))
      const posts = parts.flatMap(([, , p]) => rowsOf(p.data).flatMap((r) => postOf('post', r) ?? []))
      const people = await loadPeople([...plays.map((p) => p.user_id), ...videos.map((p) => p.userId), ...posts.map((p) => p.userId)])
      if (!people) return fail()
      if (at !== epoch) return null
      const feed: Feed = { plays: friendsListening(plays, 20), posts: mergePosts(videos, posts, 30, { hidden: getState().hidden, people }), at: Date.now() }
      setState({ feed })
      return feed
    } catch {
      return fail()
    }
  })
}

/** Someone's posts and videos, newest first: the first page (cached for a minute), or with `more` the next one. */
export function loadPosts(userId: string, more = false): Promise<PostList | null> {
  const list = getState().lists[userId]
  if (!more && list?.at && Date.now() - list.at < MINUTE) return Promise.resolve(list)
  if (more && (!list || list.done || !list.cursor)) return Promise.resolve(list ?? null)
  if (!isOnline()) return Promise.resolve(null)
  const cursor = more ? list!.cursor : undefined
  return once(`posts:${userId}:${cursor ?? ''}`, async () => {
    const at = epoch
    try {
      const sb = await supabase()
      const page = (table: 'videos' | 'posts', columns: string) => {
        const q = sb.from(table).select(columns).eq('user_id', userId).is('removed_at', null)
        return (cursor ? q.lt('created_at', cursor) : q).order('created_at', { ascending: false }).limit(PAGE)
      }
      const [v, p] = await Promise.all([page('videos', VIDEO), page('posts', POST)])
      if (v.error || p.error || at !== epoch) return null
      const wrap = (kind: Post['kind'], data: unknown) => rowsOf(data).map((r) => ({ createdAt: String(r.created_at), post: postOf(kind, r) }))
      const taken = takePage(wrap('video', v.data), wrap('post', p.data), PAGE)
      const { hidden } = getState()
      const fresh = taken.items.flatMap(({ post }) => (post && !hidden.has(keyOf(post)) ? [post] : []))
      setState((s) => {
        const old = s.lists[userId]
        let items = cursor ? (old?.items ?? []).concat(fresh.filter((p) => !old?.items.some((o) => keyOf(o) === keyOf(p)))) : fresh
        if (!cursor) for (const post of justPosted) if (post.userId === userId && !hidden.has(keyOf(post))) items = withPost(items, post)
        return { lists: { ...s.lists, [userId]: { items, cursor: taken.cursor ?? old?.cursor, done: taken.done, at: cursor ? (old?.at ?? 0) : Date.now() } } }
      })
      return getState().lists[userId]
    } catch {
      return null
    }
  })
}

/** What someone I follow played in the last two weeks (while they share it), for their profile. */
export async function loadListening(userId: string): Promise<FriendPlay[] | null> {
  const me = currentMe()
  if (!me || userId === me.id) return null
  try {
    const sb = await supabase()
    const { data, error } = await sb.from('plays').select(PLAY).eq('user_id', userId).gt('played_at', ago(14 * DAY))
      .order('played_at', { ascending: false }).limit(100)
    if (error) return null
    return friendsListening(rowsOf(data) as unknown as PlayRow[], 20)
  } catch {
    return null
  }
}

/** Who someone follows, or who follows them: 50 at a time from `from`, newest first. Public, so anyone may ask. */
export async function loadFollows(userId: string, which: 'following' | 'followers', from = 0): Promise<{ people: Person[]; done: boolean } | null> {
  if (!isOnline()) return null
  const [column, by] = which === 'following' ? ['followee_id', 'follower_id'] : ['follower_id', 'followee_id']
  try {
    const sb = await supabase()
    const { data, error } = await sb.from('follows').select(column).eq(by, userId).order('created_at', { ascending: false }).range(from, from + 49)
    if (error) return null
    const ids = rowsOf(data).flatMap((r) => (typeof r[column] === 'string' ? [r[column] as string] : []))
    const people = await loadPeople(ids)
    if (!people) return null
    return { people: ids.flatMap((id) => (people[id] && !people[id].banned ? [people[id]] : [])), done: ids.length < 50 }
  } catch {
    return null
  }
}

/** Luma search (signed in only): people first, then posts and videos, each in the server's rank order. Anything
 * that didn't load, is by someone banned, or is hidden here is left out. Null on an error or an abort. */
export async function lumaSearch(q: string, signal?: AbortSignal): Promise<LumaHit[] | null> {
  if (!signedIn() || !q.trim()) return null
  const at = epoch
  try {
    const sb = await supabase()
    const search = sb.rpc('luma_search', { q })
    const { data, error } = await (signal ? search.abortSignal(signal) : search)
    if (error || signal?.aborted) return null
    const rows = rowsOf(data).filter((r) => typeof r.id === 'string' && typeof r.user_id === 'string') as unknown as LumaSearchRow[]
    const idsOf = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.id)
    const fill = (table: 'videos' | 'posts', columns: string, ids: string[]) => {
      if (!ids.length) return Promise.resolve({ data: [] as unknown, error: null })
      const query = sb.from(table).select(columns).in('id', ids).is('removed_at', null)
      return signal ? query.abortSignal(signal) : query
    }
    const [people, v, p] = await Promise.all([
      loadPeople([...idsOf('profile'), ...rows.map((r) => r.user_id)]),
      fill('videos', VIDEO, idsOf('video')),
      fill('posts', POST, idsOf('post')),
    ])
    if (!people || v.error || p.error || signal?.aborted || at !== epoch) return null
    const { hidden } = getState()
    const shown = (id: string) => !!people[id] && !people[id].banned
    const posts = new Map(
      [...rowsOf(v.data).map((r) => postOf('video', r)), ...rowsOf(p.data).map((r) => postOf('post', r))]
        .filter((x): x is Post => !!x)
        .map((x) => [keyOf(x), x]),
    )
    const hits: LumaHit[] = rows.flatMap((r) =>
      r.kind === 'profile' && shown(r.id) && !hidden.has(`profile:${r.id}`) ? [{ kind: 'person' as const, person: people[r.id] }] : [],
    )
    const seen = new Set<string>()
    for (const r of rows) {
      const post = r.kind === 'profile' ? undefined : posts.get(`${r.kind}:${r.id}`)
      if (!post || seen.has(keyOf(post)) || hidden.has(keyOf(post)) || !shown(post.userId)) continue
      seen.add(keyOf(post))
      hits.push({ kind: 'post', post })
    }
    return hits
  } catch {
    return null
  }
}

// ── Wiring ───────────────────────────────────────────────────────────────

if (typeof document !== 'undefined') {
  // Another account (or none): nothing of the last one's stays.
  useAccount.subscribe((s, prev) => {
    if (s.user?.id !== prev.user?.id) resetSocial()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && mineAt && Date.now() - mineAt > FRESH_MINE) void loadMine(true)
  })
}
