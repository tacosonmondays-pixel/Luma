// Sign Out with the real supabase-js the app ships, offline, after the access token expired (the iPhone app reopened
// after an hour in the background, on a plane): the device must forget the session, so the next start is signed out.
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryStorage } from './mocks.ts'

let online = false
const calls: string[] = []
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const userA = { id: '00000000-0000-4000-8000-00000000000a', aud: 'authenticated', role: 'authenticated', email: 'a@example.com' }

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input)
  calls.push(`${online ? 'online' : 'offline'} ${init?.method ?? 'GET'} ${url.replace(/^https:\/\/[^/]+/, '')}`)
  if (!online) throw new TypeError('Load failed')
  if (url.includes('/auth/v1/token?grant_type=refresh_token'))
    return json({ access_token: 'new.access.token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'rt-A-2', user: userA })
  if (url.includes('/auth/v1/logout')) return new Response(null, { status: 204 })
  if (url.includes('/rest/v1/profiles'))
    return json({ id: userA.id, handle: 'alice', member: true, banned: false, admin: false, name: 'Alice', pinned_songs: [], pinned_playlists: [], badges: [], share_activity: false, updated_at: new Date().toISOString() })
  return json({}, 404)
}

async function launch(storage: MemoryStorage) {
  vi.resetModules()
  Object.assign(globalThis, { localStorage: storage, fetch: fakeFetch })
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = await import('../../src/lib/supabase.ts')
  // The options of supabase.ts; `storage` only because Node has no localStorage of its own for supabase-js to find.
  const sb = createClient(supabase.SUPABASE_URL, supabase.SUPABASE_KEY, {
    auth: { storageKey: supabase.AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage },
    global: { fetch: fakeFetch },
  })
  supabase.setClient(sb)
  clients.push(sb)
  return { sb, account: await import('../../src/lib/account.ts') }
}

const clients: { auth: { stopAutoRefresh(): Promise<void> } }[] = []
afterEach(async () => {
  for (const sb of clients.splice(0)) await sb.auth.stopAutoRefresh()
})

const session = (expiresIn: number) =>
  JSON.stringify({
    access_token: 'old.access.token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: 'rt-A', user: userA,
  })

for (const [when, expiresIn] of [['expired', -600], ['still valid', 3000]] as const)
  it(`Sign Out offline, access token ${when}: signed out now and on the next start`, async () => {
    const storage = new MemoryStorage()
    storage.setItem('luma-auth', session(3000))
    online = true
    const first = await launch(storage)
    await first.account.startAccount()
    await vi.waitFor(() => expect(first.account.useAccount.getState().row?.handle).toBe('alice'))

    storage.setItem('luma-auth', JSON.stringify({ ...JSON.parse(storage.getItem('luma-auth')!), expires_at: Math.floor(Date.now() / 1000) + expiresIn }))
    online = false
    const t = Date.now()
    await first.account.signOut()
    expect(Date.now() - t).toBeLessThan(3000) // no 25 s of refresh retries first
    expect(first.account.useAccount.getState().user).toBeUndefined()
    expect([...Array(storage.length)].map((_, i) => storage.key(i)).filter((k) => k?.startsWith('luma-auth'))).toEqual([])

    online = true
    const second = await launch(storage)
    second.account.resumeAccount() // what main.tsx does
    await new Promise((r) => setTimeout(r, 200))
    expect(second.account.useAccount.getState().user).toBeUndefined()
    expect(calls.filter((c) => c.includes('grant_type=refresh_token') && c.startsWith('online'))).toEqual([])
  }, 30_000)

it('Sign Out online revokes the session on the server', async () => {
  const storage = new MemoryStorage()
  storage.setItem('luma-auth', session(3000))
  online = true
  const first = await launch(storage)
  await first.account.startAccount()
  await vi.waitFor(() => expect(first.account.useAccount.getState().user?.id).toBe(userA.id))
  calls.length = 0
  await first.account.signOut()
  await vi.waitFor(() => expect(calls.some((c) => c.startsWith('online POST /auth/v1/logout'))).toBe(true))
  expect(storage.getItem('luma-auth')).toBeNull()
})
