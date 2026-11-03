// The Supabase project: sign-in, library backup, public profiles. Optional: everything works without it.
// The client loads on first use, so signed-out and offline starts never fetch or parse it.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Public values (the publishable key is meant for browsers; row level security guards the data). */
export const SUPABASE_URL = 'https://kbdevcrqrjnqxsfeszbe.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_MUnZLIMgfa6bKpkeH9J2Cg_GyxpGis3'

/** Where supabase-js keeps the session (localStorage), so a start can tell "signed in" without loading it. */
export const AUTH_KEY = 'luma-auth'

export const BUCKET = 'media'

let client: Promise<SupabaseClient> | undefined

export function supabase(): Promise<SupabaseClient> {
  return (client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    }),
  ))
}

/** True when a session was saved here: worth loading the client at start. */
export function hasSavedSession(): boolean {
  try {
    return !!localStorage.getItem(AUTH_KEY)
  } catch {
    return false
  }
}

/** A file's public URL in the media bucket. */
export function mediaUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`
}

/** For tests: use this client instead. */
export function setClient(c: SupabaseClient | undefined): void {
  client = c ? Promise.resolve(c) : undefined
}
