// Posting: a post (text and up to 4 images) or one video with a caption, either with the song that's playing as
// metadata (never audio). The files go up first, one at a time through `uploader` (XHR, for progress; tests swap it),
// then the row. Anything that fails after an upload removes what went up (but an insert that may have landed keeps
// them); files left behind anyway (a closed tab, a lost answer) are swept later by their owner (sweepOrphans). Files
// without a row still count against the quota.

import { uid } from './format.ts'
import { extOf, processMedia, type Media } from './media.ts'
import { addMine, currentMe, hide, isOnline, POST, postOf, VIDEO, type Post } from './social.ts'
import { BUCKET, SUPABASE_KEY, SUPABASE_URL, supabase } from './supabase.ts'
import type { Track } from '../types.ts'

const MB = 1024 * 1024
const HOUR = 3600_000
const DAY = 24 * HOUR
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

/** Space a post must leave in the member's quota, so profile sync keeps working. */
export const RESERVE = 20 * MB

export type PostErrorCode = 'offline' | 'storage-full' | 'daily-limit' | 'too-large' | 'failed'

export class PostError extends Error {
  code: PostErrorCode
  constructor(code: PostErrorCode) {
    super(code)
    this.code = code
  }
}

/** The word the Post button shows for a failure. */
export function postErrorLabel(error: unknown): string {
  const code = error instanceof PostError ? error.code : 'failed'
  return { offline: 'Offline', 'storage-full': 'Storage Full', 'daily-limit': 'Daily Limit', 'too-large': 'Too Large', failed: 'Failed' }[code]
}

// ── Picking ──────────────────────────────────────────────────────────────

/** Which picked files to take: the first video when nothing is attached yet, else images up to 4 in all. */
export function choosePicks<T extends { type: string }>(files: readonly T[], attached: { images: number; video: boolean }): T[] {
  if (attached.video) return []
  const isVideo = (f: T) => f.type.startsWith('video/')
  const video = files.find(isVideo)
  if (video && !attached.images) return [video]
  return files.filter((f) => !isVideo(f)).slice(0, Math.max(0, 4 - attached.images))
}

/** A pick, ready to post: an image becomes a JPEG (long side 1600, no EXIF), a video is checked (60 s, 50 MB) and gets
 * a still. Throws a MediaError (errorLabel names it). */
export function prepareMedia(file: Blob): Promise<Media> {
  return processMedia(file, file.type.startsWith('video/') ? 'video' : 'post')
}

// ── Uploading ────────────────────────────────────────────────────────────

/** An upload the Storage API refused (status 0: the network failed). */
export class UploadError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type Uploader = (path: string, blob: Blob, o: { token: string; signal: AbortSignal; onProgress: (sent: number) => void }) => Promise<void>

const aborted = () => new DOMException('Aborted', 'AbortError')

/** Uploads one file to the media bucket with XHR, which reports progress (fetch doesn't, for uploads). Social files
 * are cached for a day, so a removed one stops being served soon. */
export const xhrUpload: Uploader = (path, blob, { token, signal, onProgress }) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(aborted())
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`)
    xhr.setRequestHeader('authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', SUPABASE_KEY)
    xhr.setRequestHeader('content-type', blob.type)
    xhr.setRequestHeader('cache-control', 'max-age=86400')
    xhr.setRequestHeader('x-upsert', 'false')
    const stop = () => xhr.abort()
    signal.addEventListener('abort', stop, { once: true })
    const done = () => signal.removeEventListener('abort', stop)
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => {
      done()
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      // Storage puts its own status in the body (a refused policy is a 400 holding "403"; too large, "413").
      let body: { statusCode?: unknown; message?: unknown; error?: unknown } = {}
      try {
        body = JSON.parse(xhr.responseText)
      } catch {}
      const status = Number(body.statusCode) || xhr.status
      reject(new UploadError(status, String(body.message ?? body.error ?? xhr.statusText)))
    }
    xhr.onerror = () => (done(), reject(new UploadError(0, 'network')))
    xhr.onabort = () => (done(), reject(aborted()))
    xhr.send(blob)
  })

let uploader: Uploader = xhrUpload

/** For tests: upload with this instead (undefined puts XHR back). */
export function setUploader(u?: Uploader): void {
  uploader = u ?? xhrUpload
}

// ── Publishing ───────────────────────────────────────────────────────────

export interface Draft {
  text: string
  /** Processed picks (prepareMedia): up to 4 images, or one video. */
  media: Media[]
  /** The song to attach, as metadata. */
  track?: Pick<Track, 'id' | 'title' | 'artist' | 'source'>
}

/** At most `n` characters, as the server counts them (never half an emoji). */
const cut = (s: string, n: number) => (s.length <= n ? s : Array.from(s).slice(0, n).join(''))

function songColumns(track: Draft['track']) {
  if (!track || typeof track.title !== 'string' || !track.title.trim()) return { youtube_id: null, track_title: null, track_artist: null }
  return {
    youtube_id: track.source === 'youtube' && YOUTUBE_ID.test(track.id) ? track.id : null,
    track_title: cut(track.title, 300),
    track_artist: cut(track.artist ?? '', 300),
  }
}

type Client = Awaited<ReturnType<typeof supabase>>

async function spaceLeft(sb: Client): Promise<number | null | undefined> {
  try {
    const { data, error } = await sb.rpc('media_left')
    if (error) return undefined
    return data === null ? null : Number(data)
  } catch {
    return undefined
  }
}

async function postErrorOf(error: unknown, sb: Client): Promise<PostError> {
  if (error instanceof PostError) return error
  if (!isOnline()) return new PostError('offline')
  if (error instanceof UploadError) {
    if (error.status === 413) return new PostError('too-large')
    if ((error.status === 400 || error.status === 403) && /row-level security/i.test(error.message)) {
      const left = await spaceLeft(sb)
      if (typeof left === 'number' && left <= 0) return new PostError('storage-full')
    }
    return new PostError('failed')
  }
  if ((error as { code?: unknown } | null)?.code === '54000') return new PostError('daily-limit')
  return new PostError('failed')
}

/**
 * Publishes a draft: checks the space left, uploads the files in order (a video's still, then the video; or the
 * images), then inserts the row. The new post goes first in my list, and is returned. Throws a PostError; whatever
 * went up before a failure or an abort is removed, unless the insert's answer was lost (the row may be in).
 */
export async function publish(
  draft: Draft,
  { onProgress, signal }: { onProgress?: (sent: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<Post | undefined> {
  if (!isOnline()) throw new PostError('offline')
  const me = currentMe()
  const video = draft.media.find((m) => m.kind === 'video')
  const images = video ? [] : draft.media.slice(0, 4)
  const text = draft.text.trim()
  if (!me || (!video && !text && !images.length) || text.length > (video ? 300 : 1000)) throw new PostError('failed')

  const base = uid()
  const folder = `${me.id}/${video ? 'videos' : 'posts'}`
  const files = video
    ? [
        ...(video.still ? [{ path: `${folder}/${base}-still.jpg`, blob: video.still }] : []),
        { path: `${folder}/${base}.${extOf(video.blob.type) ?? 'mp4'}`, blob: video.blob },
      ]
    : images.map((m, i) => ({ path: `${folder}/${base}-${i}.${extOf(m.blob.type) ?? 'jpg'}`, blob: m.blob }))
  const total = files.reduce((n, f) => n + f.blob.size, 0)

  let sb: Client
  try {
    sb = await supabase()
  } catch {
    throw new PostError(isOnline() ? 'failed' : 'offline')
  }
  const uploaded: string[] = []
  let row: unknown
  // Whether the row may be in: from the insert on, until the server names its refusal. An insert whose answer was lost
  // (a dropped connection: no code) may have landed, so its files stay; the sweep removes them if it didn't.
  let maybeIn = false
  try {
    const left = await spaceLeft(sb)
    if (typeof left === 'number' && total + RESERVE > left) throw new PostError('storage-full')
    const token = (await sb.auth.getSession()).data.session?.access_token
    if (!token) throw new PostError('failed')
    const stop = signal ?? new AbortController().signal
    let sent = 0
    onProgress?.(0, total)
    for (const f of files) {
      if (stop.aborted) throw aborted()
      await uploader(f.path, f.blob, { token, signal: stop, onProgress: (n) => onProgress?.(sent + Math.min(n, f.blob.size), total) })
      uploaded.push(f.path)
      sent += f.blob.size
      onProgress?.(sent, total)
    }
    if (stop.aborted) throw aborted()
    const song = songColumns(draft.track)
    maybeIn = true
    const { data, error } = video
      ? await sb.from('videos').insert({
          path: uploaded.at(-1), still_path: video.still ? uploaded[0] : null, caption: text, ...song,
          duration: Number.isFinite(video.duration) ? video.duration : 0,
        }).select(VIDEO).single()
      : await sb.from('posts').insert({ body: text, image_paths: uploaded, ...song }).select(POST).single()
    if (error) {
      if (typeof error.code === 'string' && error.code) maybeIn = false // refused: no row
      throw error
    }
    row = data
  } catch (error) {
    if (uploaded.length && !maybeIn) await sb.storage.from(BUCKET).remove(uploaded).catch(() => {})
    throw await postErrorOf(error, sb)
  }
  const post = postOf(video ? 'video' : 'post', row)
  if (post) addMine(post)
  return post
}

/** Delete my own post: gone here at once, back if the server refuses. Then its files, as best effort (the sweep
 * catches whatever is left). */
export async function deletePost(post: Post): Promise<boolean> {
  const me = currentMe()
  if (!me || post.userId !== me.id) return false
  const undo = hide(post.kind, post.id)
  let sb: Client
  try {
    sb = await supabase()
    const { error } = await sb.from(post.kind === 'video' ? 'videos' : 'posts').delete().eq('id', post.id)
    if (error) throw error
  } catch {
    undo()
    return false
  }
  if (post.paths.length) await sb.storage.from(BUCKET).remove(post.paths).then(() => {}, () => {})
  return true
}

// ── Orphans ──────────────────────────────────────────────────────────────

const swept = new Map<string, number>()
let sweeping = false

/** Every path my rows point at (removed rows too: owners read their own), or undefined on an error. */
async function referenced(sb: Client, me: string): Promise<Set<string> | undefined> {
  const paths = new Set<string>()
  for (const [table, columns] of [['videos', 'path,still_path'], ['posts', 'image_paths']] as const) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select(columns).eq('user_id', me).order('created_at').range(from, from + 999)
      if (error || !Array.isArray(data)) return
      for (const row of data as unknown as Record<string, unknown>[]) {
        for (const p of [row.path, row.still_path, ...(Array.isArray(row.image_paths) ? row.image_paths : [])]) if (typeof p === 'string') paths.add(p)
      }
      if (data.length < 1000) break
    }
  }
  return paths
}

/** Remove my files no row points at (an upload whose post never made it), once they are a day old: far longer than
 * any upload takes (another device may be mid-post, its still up and its video still going), and safe from a device
 * clock that runs ahead of the server's. At most once a day per account; the composer runs it when it opens. */
export async function sweepOrphans(now = Date.now()): Promise<void> {
  const me = currentMe()
  if (!me || sweeping) return
  const key = `luma-swept:${me.id}`
  let last = swept.get(me.id) ?? 0
  try {
    last = Math.max(last, Number(localStorage.getItem(key)) || 0)
  } catch {}
  if (now - last < DAY) return
  sweeping = true
  try {
    const sb = await supabase()
    const folders = [`${me.id}/videos`, `${me.id}/posts`]
    const listed = await Promise.all(folders.map((f) => sb.storage.from(BUCKET).list(f, { limit: 1000 })))
    if (listed.some((l) => l.error)) return
    const keep = await referenced(sb, me.id)
    if (!keep) return
    const orphans = listed.flatMap((l, i) =>
      (l.data ?? []).flatMap((o) => {
        const path = `${folders[i]}/${o.name}`
        const made = Date.parse(o.created_at ?? '')
        return o.id && !keep.has(path) && Number.isFinite(made) && now - made > DAY ? [path] : []
      }),
    )
    for (let i = 0; i < orphans.length; i += 100) {
      const { error } = await sb.storage.from(BUCKET).remove(orphans.slice(i, i + 100))
      if (error) return
    }
    swept.set(me.id, now)
    try {
      localStorage.setItem(key, String(now))
    } catch {}
  } catch {
    // Offline or refused: try again next time.
  } finally {
    sweeping = false
  }
}
