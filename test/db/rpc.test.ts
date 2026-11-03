// The RPCs: invites, admin tools, search and make_admin.
import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from './harness.ts'

let db: Db
let admin: { id: string }
let member: { id: string }

const denied = /permission denied|admins only/

beforeAll(async () => {
  db = await createDb()
  admin = await db.admin()
  member = await db.member('member')
}, 60_000)

const redeem = async (who: { id: string }, code: string) =>
  (await db.as<{ r: string }>(who, 'select public.redeem_invite($1) as r', [code]))[0].r

const invites = async (n = 1, days: number | null = 30) =>
  (await db.as<{ code: string }>(admin, 'select code from public.create_invites($1, $2)', [n, days])).map((r) => r.code)

describe('invites', () => {
  it('admins create them; codes are unique and expire', async () => {
    const rows = await db.as<{ code: string; expires_at: Date }>(admin, 'select * from public.create_invites(3)')
    expect(new Set(rows.map((r) => r.code)).size).toBe(3)
    for (const r of rows) expect(r.code).toMatch(/^[A-Z0-9]{10}$/)
    expect(rows[0].expires_at.getTime()).toBeGreaterThan(Date.now())
    expect((await db.as(admin, 'select * from public.invites')).length).toBeGreaterThanOrEqual(3)
  })

  it('are single use', async () => {
    const [code] = await invites()
    const first = await db.user()
    const second = await db.user()
    expect(await redeem(first, code.toLowerCase())).toBe('ok') // any case, any spaces
    expect(await redeem(first, code)).toBe('member')
    expect(await redeem(second, code)).toBe('invalid')
    const [me] = await db.as<{ member: boolean }>(first, 'select member from public.profiles where id = auth.uid()')
    expect(me.member).toBe(true)
    const [none] = await db.as<{ n: string }>(second, 'select count(*) as n from public.profiles where id = auth.uid()')
    expect(Number(none.n)).toBe(0)
  })

  it("expired codes don't work", async () => {
    const [code] = await invites()
    await db.as('owner', `update public.invites set expires_at = now() - interval '1 minute' where code = $1`, [code])
    expect(await redeem(await db.user(), code)).toBe('invalid')
  })

  it('are rate-limited: five failures an hour, then even a good code waits', async () => {
    const guesser = await db.user()
    for (let i = 0; i < 5; i++) expect(await redeem(guesser, `WRONG${i}XX`)).toBe('invalid')
    const [code] = await invites()
    expect(await redeem(guesser, code)).toBe('rate_limited')
    await db.as('owner', `update luma.invite_attempts set at = now() - interval '2 hours' where user_id = $1`, [guesser.id])
    expect(await redeem(guesser, code)).toBe('ok')
  })

  it('need a signed-in user', async () => {
    await expect(db.as('anon', `select public.redeem_invite('ABCDEFGHIJ')`)).rejects.toThrow(/permission denied/)
  })

  it("can't be inserted or claimed directly", async () => {
    await expect(db.as(member, `insert into public.invites (code) values ('MINEMINE')`)).rejects.toThrow(/permission denied/)
    await expect(db.as(member, `update public.invites set used_by = auth.uid()`)).rejects.toThrow(/permission denied/)
  })
})

describe('admin RPCs', () => {
  it('are refused to normal users and signed-out visitors', async () => {
    const [post] = await db.as<{ id: string }>(member, `insert into public.posts (body) values ('keep me') returning id`)
    for (const who of [member, await db.user()]) {
      await expect(db.as(who, 'select * from public.create_invites(1)')).rejects.toThrow(denied)
      await expect(db.as(who, `select public.admin_remove('post', $1)`, [post.id])).rejects.toThrow(denied)
      await expect(db.as(who, 'select public.admin_ban($1)', [admin.id])).rejects.toThrow(denied)
    }
    for (const sql of [`select * from public.create_invites(1)`, `select public.admin_ban(gen_random_uuid())`])
      await expect(db.as('anon', sql)).rejects.toThrow(/permission denied/)
    expect((await db.as('anon', 'select * from public.posts where id = $1', [post.id])).length).toBe(1)
  })

  it('make_admin works only from the SQL editor', async () => {
    const u = await db.user('climber@example.com')
    await expect(db.as(u, `select public.make_admin('climber@example.com')`)).rejects.toThrow(/permission denied/)
    await expect(db.as('anon', `select public.make_admin('climber@example.com')`)).rejects.toThrow(/permission denied/)
    await expect(db.as('owner', `select public.make_admin('nobody@example.com')`)).rejects.toThrow(/no account/)
  })

  it('admin_remove hides a post or video and resolves its reports', async () => {
    const [post] = await db.as<{ id: string }>(member, `insert into public.posts (body) values ('rude') returning id`)
    await db.as(member, `insert into public.reports (kind, target_id) values ('post', $1)`, [post.id])
    await db.as(admin, `select public.admin_remove('post', $1)`, [post.id])
    expect((await db.as('anon', 'select * from public.posts where id = $1', [post.id])).length).toBe(0)
    expect((await db.as(admin, 'select * from public.posts where id = $1', [post.id])).length).toBe(1)
    const [report] = await db.as<{ resolved_at: Date | null }>(admin, 'select resolved_at from public.reports where target_id = $1', [post.id])
    expect(report.resolved_at).not.toBeNull()

    const [video] = await db.as<{ id: string }>(member, `insert into public.videos (path) values ($1) returning id`, [`${member.id}/videos/v.mp4`])
    await db.as(admin, `select public.admin_remove('video', $1)`, [video.id])
    expect((await db.as('anon', 'select * from public.videos where id = $1', [video.id])).length).toBe(0)
  })

  it('admin_remove clears a profile, even one edited with a later clock', async () => {
    await db.as(member, `update public.profiles set bio = 'spam', updated_at = now() + interval '1 day' where id = auth.uid()`)
    await db.as(admin, `select public.admin_remove('profile', $1)`, [member.id])
    const [p] = await db.as<{ bio: string | null }>('anon', 'select bio from public.profiles where id = $1', [member.id])
    expect(p.bio).toBeNull()
  })

  it("admins can't be banned", async () => {
    const other = await db.admin()
    await expect(db.as(admin, 'select public.admin_ban($1)', [other.id])).rejects.toThrow(/can't be banned/)
  })

  it('a banned non-member can never redeem an invite', async () => {
    const u = await db.user()
    await db.as(admin, 'select public.admin_ban($1)', [u.id])
    const [code] = await invites()
    expect(await redeem(u, code)).toBe('banned')
  })
})

describe('luma_search', () => {
  beforeAll(async () => {
    const singer = await db.member('night_singer')
    await db.as(singer, `update public.profiles set name = 'Midnight Choir', bio = 'synthwave forever' where id = auth.uid()`)
    await db.as(singer, `insert into public.posts (body) values ('new synthwave mix tonight')`)
    await db.as(singer, `insert into public.videos (path, caption, track_title) values ($1, 'dancing', 'Neon Synthwave')`, [`${singer.id}/videos/s.mp4`])
    const [hidden] = await db.as<{ id: string }>(singer, `insert into public.posts (body) values ('synthwave secret') returning id`)
    await db.as(admin, `select public.admin_remove('post', $1)`, [hidden.id])
    const lurker = await db.user()
    // A non-member's leftover row would never be public anyway
    await db.as(admin, 'select public.admin_ban($1, false)', [lurker.id])
  })

  it('finds public profiles, videos and posts by word prefix, signed out too', async () => {
    const rows = await db.as<{ kind: string; handle: string; title: string }>('anon', `select * from public.luma_search('synthw')`)
    expect(rows.map((r) => r.kind).sort()).toEqual(['post', 'profile', 'video'])
    expect(rows.every((r) => r.handle === 'night_singer')).toBe(true)
    expect(rows.some((r) => r.title.includes('secret'))).toBe(false)
    expect((await db.as('anon', `select * from public.luma_search('night singer')`)).length).toBe(1)
  })

  it('ignores punctuation and blank queries', async () => {
    expect(await db.as('anon', `select * from public.luma_search($1)`, [`'); drop table x; --`])).toEqual([])
    expect(await db.as('anon', `select * from public.luma_search('  ')`)).toEqual([])
    expect(await db.as('anon', `select * from public.luma_search(null)`)).toEqual([])
  })
})

describe('the SQL Editor', () => {
  it('runs the admin RPCs as the owner, without signing in', async () => {
    const rows = await db.as<{ code: string }>('owner', 'select * from public.create_invites(2)')
    expect(rows).toHaveLength(2)
    const u = await db.user()
    await db.as('owner', 'select public.admin_ban($1)', [u.id])
    expect(await redeem(u, rows[0].code)).toBe('banned')
  })

  it("a signed-in request can't pass for the owner", async () => {
    // Even if someone could set the role setting through a request, API calls run as anon or authenticated.
    await expect(db.as(member, 'select * from public.create_invites(1)')).rejects.toThrow(/admins only/)
  })
})
