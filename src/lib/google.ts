// Connect YouTube: sign in with Google (Google Identity Services' token client, the browser flow with no secret)
// for read-only access to the owner's playlists and Liked videos. The token lives for this session only.

import { create } from 'zustand'
import { GOOGLE_CLIENT_ID } from './google-config.ts'

const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly'
const GIS = 'https://accounts.google.com/gsi/client'
const CONNECTED = 'luma-youtube-connected' // localStorage: asked for consent once, so later sign-ins skip the prompt
const TOKEN = 'luma-youtube-token' // sessionStorage: { token, expires }

interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  error?: string
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (r: TokenResponse) => void
            error_callback?: (e: { type?: string }) => void
          }): TokenClient
          revoke(token: string, done?: () => void): void
        }
      }
    }
  }
}

interface GoogleState {
  token: string | null
  expires: number // ms since epoch
  connected: boolean
}

function readToken(): Pick<GoogleState, 'token' | 'expires'> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOKEN) ?? 'null') as { token?: string; expires?: number } | null
    if (saved?.token && (saved.expires ?? 0) > Date.now()) return { token: saved.token, expires: saved.expires! }
  } catch {}
  return { token: null, expires: 0 }
}

function readConnected(): boolean {
  try {
    return localStorage.getItem(CONNECTED) === '1'
  } catch {
    return false
  }
}

export const useGoogle = create<GoogleState>()(() => ({ ...readToken(), connected: readConnected() }))

/** False until the owner adds a client ID to google-config.ts: everything about Connect YouTube hides. */
export const googleEnabled = (): boolean => !!GOOGLE_CLIENT_ID

/** The token, if it is good for at least another minute. */
export function validToken(): string | null {
  const { token, expires } = useGoogle.getState()
  return token && expires - Date.now() > 60_000 ? token : null
}

let script: Promise<void> | undefined

/** Load Google's script ahead of the tap that signs in: the popup must open within that tap. */
export function preload(): Promise<void> {
  if (!googleEnabled()) return Promise.reject(new Error('no client id'))
  script ??= new Promise<void>((resolve, reject) => {
    if (window.google?.accounts) return resolve()
    const el = document.createElement('script')
    el.src = GIS
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => {
      script = undefined
      el.remove()
      reject(new Error('offline'))
    }
    document.head.append(el)
  })
  return script
}

let client: TokenClient | undefined
let pending: { resolve: (token: string) => void; reject: (e: Error) => void }[] = []

function settle(token: string | null, error?: string) {
  const waiting = pending
  pending = []
  for (const p of waiting) (token ? p.resolve(token) : p.reject(new Error(error ?? 'failed')))
}

function tokenClient(): TokenClient {
  client ??= window.google!.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPE,
    callback: (r) => {
      if (!r.access_token) return settle(null, r.error)
      const expires = Date.now() + Number(r.expires_in ?? 3600) * 1000
      useGoogle.setState({ token: r.access_token, expires, connected: true })
      try {
        sessionStorage.setItem(TOKEN, JSON.stringify({ token: r.access_token, expires }))
        localStorage.setItem(CONNECTED, '1')
      } catch {}
      settle(r.access_token)
    },
    error_callback: (e) => settle(null, e.type), // closed the popup, or it was blocked
  })
  return client
}

/**
 * A token, signing in if needed. Call it straight from a tap: the sign-in popup needs the user's gesture,
 * so Google's script should already be loaded (preload). Rejects when the owner closes the popup.
 */
export function ensureToken(): Promise<string> {
  const valid = validToken()
  if (valid) return Promise.resolve(valid)
  const result = new Promise<string>((resolve, reject) => pending.push({ resolve, reject }))
  if (pending.length > 1) return result // a sign-in is already open
  const ask = () => tokenClient().requestAccessToken({ prompt: useGoogle.getState().connected ? '' : 'consent' })
  if (window.google?.accounts) ask()
  else preload().then(ask, () => settle(null, 'offline'))
  return result
}

/** Forget the token here and revoke it at Google. Linked playlists stay linked. */
export function disconnect(): void {
  const { token } = useGoogle.getState()
  if (token) window.google?.accounts.oauth2.revoke(token)
  useGoogle.setState({ token: null, expires: 0, connected: false })
  try {
    sessionStorage.removeItem(TOKEN)
    localStorage.removeItem(CONNECTED)
  } catch {}
}
