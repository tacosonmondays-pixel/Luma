// The account: the Supabase session and this user's `profiles` row. Signed out is the normal, complete app.
//
// Sign-in uses a 6-digit email code, not a magic link: a link opens Safari, which doesn't share storage with
// the Home Screen app or the iOS app.

import { create } from 'zustand'
import { AUTH_KEY, hasSavedSession, supabase } from './supabase.ts'
import {
  BADGE_IDS, EFFECT_IDS, FRAME_IDS, NAME_STYLE_IDS,
  type BadgeId, type Crop, type PinnedSong, type Profile, type ProfileRow, type RedeemResult, type Tier,
} from '../types.ts'

interface Account {
  ready: boolean // the saved session (if any) has been checked
  user?: { id: string; email: string }
  /** The row; null when there is none (not a member yet), undefined while unknown (offline). */
  row?: ProfileRow | null
}

export const useAccount = create<Account>()(() => ({ ready: !hasSavedSession() }))

const { getState, setState } = useAccount

export const isMember = (a: Account = getState()) => !!a.row?.member && !a.row.banned

export const HANDLE = /^[a-z0-9_]{3,20}$/

let started: Promise<void> | undefined

/** Load a saved session, and follow sign-ins and sign-outs (this tab or a refresh). */
export function startAccount(): Promise<void> {
  return (started ??= (async () => {
    const sb = await supabase()
    sb.auth.onAuthStateChange((event, session) => {
      const user = session?.user
      if (!user) return setState({ user: undefined, row: undefined, ready: true })
      if (event === 'TOKEN_REFRESHED' && getState().user?.id === user.id) return
      const changed = getState().user?.id !== user.id
      setState({ user: { id: user.id, email: user.email ?? '' }, ready: true, ...(changed ? { row: undefined } : {}) })
      // Not from inside the callback: supabase-js holds its auth lock while it runs.
      if (changed) setTimeout(() => void refreshRow(), 0)
    })
    const { data } = await sb.auth.getSession()
    if (!data.session) setState({ ready: true })
  })().catch(() => setState({ ready: true })))
}

/** Start only when a session was saved: a signed-out start never loads the client. */
export function resumeAccount(): void {
  if (hasSavedSession()) void startAccount()
}

/** Fetch this user's row again. Keeps the last one when offline. */
export async function refreshRow(): Promise<ProfileRow | null | undefined> {
  const id = getState().user?.id
  if (!id) return
  const sb = await supabase()
  const { data, error } = await sb.from('profiles').select('*').eq('id', id).maybeSingle()
  if (error) return getState().row
  if (getState().user?.id === id) setState({ row: (data as ProfileRow | null) ?? null })
  return data as ProfileRow | null
}

/** Email a 6-digit code. Resolves false when it couldn't be sent. */
export async function signIn(email: string): Promise<boolean> {
  await startAccount()
  const sb = await supabase()
  const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } })
  return !error
}

/** Check the code. Resolves true once signed in (and the row is loaded). */
export async function verify(email: string, code: string): Promise<boolean> {
  const sb = await supabase()
  const { data, error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
  if (error || !data.user) return false
  setState({ user: { id: data.user.id, email: data.user.email ?? email }, ready: true, row: undefined })
  await refreshRow()
  return true
}

/** The saved session's access token, while it is still valid. */
function savedToken(): string | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null') as { access_token?: string; expires_at?: number } | null
    return saved?.access_token && (saved.expires_at ?? 0) * 1000 > Date.now() ? saved.access_token : undefined
  } catch {
    return undefined
  }
}

/** Forget the saved session on this device (supabase-js keeps it in localStorage under AUTH_KEY…). */
function forgetSession(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k === AUTH_KEY || k?.startsWith(`${AUTH_KEY}-`)) localStorage.removeItem(k!)
    }
  } catch {}
}

/** Signs out on this device right away, offline too. supabase-js alone keeps the session when its access token has
 * expired and it can't reach the server to refresh it, and would sign back in on the next start. */
export async function signOut(): Promise<void> {
  const sb = await supabase()
  const token = savedToken()
  forgetSession()
  // Revoke the session on the server too, when it is reachable. Nothing waits for it.
  if (token) void sb.auth.admin.signOut(token, 'local').catch(() => {})
  // Now with nothing saved, this only clears supabase-js's state (and tells onAuthStateChange). Don't wait long:
  // a token refresh in progress holds its lock while it retries offline.
  await Promise.race([sb.auth.signOut({ scope: 'local' }).catch(() => {}), new Promise((r) => setTimeout(r, 2000))])
  forgetSession()
  setState({ user: undefined, row: undefined })
}

export async function redeemInvite(code: string): Promise<RedeemResult | 'failed'> {
  const sb = await supabase()
  const { data, error } = await sb.rpc('redeem_invite', { code: code.trim() })
  if (error) return 'failed'
  if (data === 'ok' || data === 'member') await refreshRow()
  return data as RedeemResult
}

export async function claimHandle(handle: string): Promise<'ok' | 'taken' | 'invalid' | 'failed'> {
  const id = getState().user?.id
  const wanted = handle.trim().toLowerCase().replace(/^@/, '')
  if (!id || !HANDLE.test(wanted)) return 'invalid'
  const sb = await supabase()
  const { data, error } = await sb.from('profiles').update({ handle: wanted }).eq('id', id).select('*').maybeSingle()
  if (error) return error.code === '23505' ? 'taken' : 'failed'
  if (!data) return 'failed'
  setState({ row: data as ProfileRow })
  return 'ok'
}

/** Followers see what you play while this is on. */
export async function setShareActivity(on: boolean): Promise<boolean> {
  const id = getState().user?.id
  if (!id) return false
  const sb = await supabase()
  const { data, error } = await sb.from('profiles').update({ share_activity: on }).eq('id', id).select('*').maybeSingle()
  if (error || !data) return false
  setState({ row: data as ProfileRow })
  return true
}

/** A public profile by handle (works signed out). null when there is none; throws when offline. */
export async function fetchPublicProfile(handle: string): Promise<ProfileRow | null> {
  const sb = await supabase()
  const { data, error } = await sb.from('profiles').select('*').eq('handle', handle.toLowerCase()).maybeSingle()
  if (error) throw new Error(error.message)
  return data as ProfileRow | null
}

// A row is anyone's JSON: the server checks it, and the app reads it as if it hadn't. Whatever isn't well-formed is
// left out, so one odd profile can't break the page (or put its own classes, styles or URLs in it).

const oneOf = <T extends string>(ids: readonly T[], value: unknown): T | undefined =>
  (ids as readonly unknown[]).includes(value) ? (value as T) : undefined
const text = (value: unknown, max: number): string | undefined => (typeof value === 'string' ? value.slice(0, max) : undefined)
const COLOR = /^#[0-9a-f]{6}$/i
/** A stored color pair, if it is two `#rrggbb` strings. */
export const colorsOf = (value: unknown): [string, string] | undefined =>
  Array.isArray(value) && value.length === 2 && value.every((c) => typeof c === 'string' && COLOR.test(c)) ? [value[0], value[1]] : undefined

/** A row's pinned songs that are well-formed. */
export function pinnedOf(row: ProfileRow): PinnedSong[] {
  const pins: unknown[] = Array.isArray(row.pinned_songs) ? row.pinned_songs : []
  return pins.flatMap((s) => {
    const { id, title, artist, source } = (s && typeof s === 'object' ? s : {}) as Partial<Record<keyof PinnedSong, unknown>>
    if (typeof id !== 'string' || !id || (source !== 'youtube' && source !== 'file')) return []
    return [{ id: id.slice(0, 64), title: text(title, 300) ?? '', artist: text(artist, 300) ?? '', source }]
  })
}

/** A row's earned badges: known ids with a whole tier from 1 to 4, one of each, highest tier first. */
export function badgesOf(row: ProfileRow): { id: BadgeId; tier: Tier }[] {
  const badges: unknown[] = Array.isArray(row.badges) ? row.badges : []
  const found = new Map<BadgeId, Tier>()
  for (const b of badges) {
    const { id, tier } = (b && typeof b === 'object' ? b : {}) as { id?: unknown; tier?: unknown }
    const known = oneOf(BADGE_IDS, id)
    if (known && !found.has(known) && typeof tier === 'number' && Number.isInteger(tier) && tier >= 1 && tier <= 4) found.set(known, tier as Tier)
  }
  return [...found].map(([id, tier]) => ({ id, tier })).sort((a, b) => b.tier - a.tier)
}

/** A media path someone wrote, if it is one of `owner`'s own files under `sub` ('profile', 'videos', 'posts'):
 * '<owner>/<sub>/<file>', one level deep, no '..', at most 200 characters. The server's rule (luma.path_ok). */
export function ownPath(owner: string, sub: string, path: unknown): string | undefined {
  const folder = `${owner}/${sub}/`
  if (typeof path !== 'string' || !owner || !path.startsWith(folder) || path.length > 200) return undefined
  const file = path.slice(folder.length)
  return file && !file.includes('/') && !path.includes('..') ? path : undefined
}

/** A media path from someone's row, if it is one of their own profile files. */
export function profilePath(row: ProfileRow, path: unknown): string | undefined {
  return ownPath(row.id, 'profile', path)
}

/** The profile fields of a row, without media versions (sync stores the media; a public page links to it). */
export function profileFromRow(row: ProfileRow): Profile {
  return {
    name: text(row.name, 40) ?? '',
    bio: text(row.bio, 190),
    colors: colorsOf(row.colors),
    autoColors: colorsOf(row.auto_colors),
    frame: oneOf(FRAME_IDS, row.frame),
    effect: oneOf(EFFECT_IDS, row.effect),
    nameStyle: oneOf(NAME_STYLE_IDS, row.name_style),
    pinnedSongs: pinnedOf(row).map((s) => s.id),
    pinnedPlaylists: (Array.isArray(row.pinned_playlists) ? row.pinned_playlists : []).filter((id) => typeof id === 'string').slice(0, 6),
    avatarCrop: cropOf(row.crops?.avatar),
    bannerCrop: cropOf(row.crops?.banner),
    backdropCrop: cropOf(row.crops?.backdrop),
  }
}

/** A stored crop, if it is a well-formed one (the row is anyone's JSON). */
export function cropOf(c: unknown): Crop | undefined {
  const { x, y, zoom } = (c ?? {}) as Partial<Crop>
  return [x, y, zoom].every((n) => typeof n === 'number' && Number.isFinite(n)) ? { x: x!, y: y!, zoom: zoom! } : undefined
}

/** Where a profile is shared from. The iOS app's own origin (luma://) isn't a web address: use the site's. */
export function profileLink(handle: string): string {
  const base = /^https?:$/.test(location.protocol) ? `${location.origin}${import.meta.env.BASE_URL}` : SITE
  return `${base}u/${handle}`
}

export const SITE = 'https://tacosonmondays-pixel.github.io/Luma/'
