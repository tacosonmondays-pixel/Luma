// The account: the Supabase session and this user's `profiles` row. Signed out is the normal, complete app.
//
// Sign-in uses a 6-digit email code, not a magic link: a link opens Safari, which doesn't share storage with
// the Home Screen app or the iOS app.

import { create } from 'zustand'
import { hasSavedSession, supabase } from './supabase.ts'
import type { Profile, ProfileRow, RedeemResult } from '../types.ts'

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

export async function signOut(): Promise<void> {
  const sb = await supabase()
  await sb.auth.signOut({ scope: 'local' }).catch(() => {})
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

/** The profile fields of a row, without media versions (sync stores the media; a public page links to it). */
export function profileFromRow(row: ProfileRow): Profile {
  return {
    name: row.name,
    bio: row.bio ?? undefined,
    colors: row.colors ?? undefined,
    autoColors: row.auto_colors ?? undefined,
    frame: row.frame ?? undefined,
    effect: row.effect ?? undefined,
    nameStyle: row.name_style ?? undefined,
    pinnedSongs: row.pinned_songs.map((s) => s.id),
    pinnedPlaylists: row.pinned_playlists,
  }
}

/** Where a profile is shared from. The iOS app's own origin (luma://) isn't a web address: use the site's. */
export function profileLink(handle: string): string {
  const base = /^https?:$/.test(location.protocol) ? `${location.origin}${import.meta.env.BASE_URL}` : SITE
  return `${base}u/${handle}`
}

export const SITE = 'https://tacosonmondays-pixel.github.io/Luma/'
