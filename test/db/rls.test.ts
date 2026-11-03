// Row level security, proven against the real migration on PGlite (harness.ts stubs the Supabase bits).
import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, MIGRATION, type Db } from './harness.ts'

let db: Db
let alice: { id: string } // member, handle alice
let bob: { id: string } // member, handle bob, follows alice
let carol: { id: string } // member, follows nobody
let nobody: { id: string } // signed in, not a member

const denied = /permission denied|row-level security|violates/

beforeAll(async () => {
  db = await createDb()
  await db.pg.exec(MIGRATION) // a second run changes nothing and doesn't fail
  alice = await db.member('alice')
  bob = await db.member('bob')
  carol = await db.member('carol')
  nobody = await db.user()
  await db.as(bob, 'insert into public.follows (follower_id, followee_id) values (auth.uid(), $1)', [alice.id])
}, 60_000)

const count = async (who: Parameters<Db['as']>[0], sql: string, params?: unknown[]) =>
  Number((await db.as<{ n: string }>(who, `with q as (${sql}) select count(*) as n from q`, params))[0].n)

describe('signed out', () => {
  it('reads public profiles, videos, posts and follows', async () => {
    await db.as(alice, `insert into public.posts (body) values ('hello world')`)
    await db.as(alice, `insert into public.videos (path, caption) values ($1, 'first video')`, [`${alice.id}/videos/a.mp4`])
    expect(await count('anon', `select * from public.profiles where handle = 'alice'`)).toBe(1)
    expect(await count('anon', `select * from public.posts where user_id = $1`, [alice.id])).toBe(1)
    expect(await count('anon', `select * from public.videos where user_id = $1`, [alice.id])).toBe(1)
    expect(await count('anon', `select * from public.follows`)).toBe(1)
  })

  it("can't write anything", async () => {
    await expect(db.as('anon', `insert into public.posts (user_id, body) values ($1, 'x')`, [alice.id])).rejects.toThrow(denied)
    await expect(db.as('anon', `update public.profiles set bio = 'x'`)).rejects.toThrow(denied)
    await expect(db.as('anon', `insert into public.follows values ($1, $2)`, [alice.id, bob.id])).rejects.toThrow(denied)
    await expect(db.as('anon', `insert into public.library_tracks (user_id, id, updated_at) values ($1, 'x', now())`, [alice.id])).rejects.toThrow(denied)
    await expect(db.as('anon', `delete from public.posts`)).rejects.toThrow(denied)
  })

  it("can't read private tables", async () => {
    await expect(db.as('anon', 'select * from public.plays')).rejects.toThrow(denied)
    await expect(db.as('anon', 'select * from public.library_tracks')).rejects.toThrow(denied)
    await expect(db.as('anon', 'select * from public.invites')).rejects.toThrow(denied)
    await expect(db.as('anon', 'select * from public.reports')).rejects.toThrow(denied)
    await expect(db.as('anon', 'select * from luma.invite_attempts')).rejects.toThrow(denied)
  })
})

describe('non-members', () => {
  it('have no profile and cannot create one', async () => {
    expect(await count(nobody, 'select * from public.profiles where id = auth.uid()')).toBe(0)
    await expect(db.as(nobody, `insert into public.profiles (id, handle) values (auth.uid(), 'squat')`)).rejects.toThrow(denied)
  })

  it("can't post, upload, follow, report, log plays or sync a library", async () => {
    await expect(db.as(nobody, `insert into public.posts (body) values ('x')`)).rejects.toThrow(denied)
    await expect(db.as(nobody, `insert into public.videos (path) values ($1)`, [`${nobody.id}/videos/a.mp4`])).rejects.toThrow(denied)
    await expect(db.as(nobody, `insert into public.follows (follower_id, followee_id) values (auth.uid(), $1)`, [alice.id])).rejects.toThrow(denied)
    await expect(db.as(nobody, `insert into public.reports (kind, target_id) values ('profile', $1)`, [alice.id])).rejects.toThrow(denied)
    await expect(db.as(nobody, `insert into public.library_tracks (id, updated_at) values ('x', now())`)).rejects.toThrow(denied)
  })
})

describe('members', () => {
  it('edit only their own profile', async () => {
    expect(await count(alice, `update public.profiles set bio = 'hi' where id = auth.uid() returning 1`)).toBe(1)
    expect(await count(alice, `update public.profiles set bio = 'pwned' where id = $1 returning 1`, [bob.id])).toBe(0)
  })

  it("can't change their own member, admin or banned flags", async () => {
    await expect(db.as(alice, `update public.profiles set admin = true where id = auth.uid()`)).rejects.toThrow(denied)
    await expect(db.as(alice, `update public.profiles set banned = false where id = auth.uid()`)).rejects.toThrow(denied)
    await expect(db.as(alice, `update public.profiles set member = true where id = auth.uid()`)).rejects.toThrow(denied)
  })

  it('handles are unique, case-insensitively, and well-formed', async () => {
    await expect(db.as(carol, `update public.profiles set handle = 'alice' where id = auth.uid()`)).rejects.toThrow(/unique|duplicate/)
    await expect(db.as(carol, `update public.profiles set handle = 'Alice' where id = auth.uid()`)).rejects.toThrow(/check/)
    await expect(db.as(carol, `update public.profiles set handle = 'ab' where id = auth.uid()`)).rejects.toThrow(/check/)
    await expect(db.as(carol, `update public.profiles set handle = 'way_too_long_handle_123' where id = auth.uid()`)).rejects.toThrow(/check/)
  })

  it('store image crops as a small object', async () => {
    expect(await count(alice, `update public.profiles set crops = '{"avatar":{"x":0.5,"y":0.4,"zoom":1.5}}' where id = auth.uid() returning 1`)).toBe(1)
    await expect(db.as(alice, `update public.profiles set crops = '[1]' where id = auth.uid()`)).rejects.toThrow(/check/)
  })

  it('profile media must point into their own folder', async () => {
    await expect(
      db.as(alice, `update public.profiles set avatar_path = $1 where id = auth.uid()`, [`${bob.id}/profile/a.jpg`]),
    ).rejects.toThrow(/check/)
  })

  it('post only as themselves, with at most 4 images in their own folder', async () => {
    await expect(db.as(alice, `insert into public.posts (user_id, body) values ($1, 'x')`, [bob.id])).rejects.toThrow(denied)
    await expect(
      db.as(alice, `insert into public.posts (body, image_paths) values ('x', $1)`, [[`${bob.id}/posts/a.jpg`]]),
    ).rejects.toThrow(denied)
    const five = [1, 2, 3, 4, 5].map((i) => `${alice.id}/posts/${i}.jpg`)
    await expect(db.as(alice, `insert into public.posts (body, image_paths) values ('x', $1)`, [five])).rejects.toThrow(/check/)
    expect(await count(alice, `insert into public.posts (body, image_paths) values ('four', $1) returning 1`, [five.slice(0, 4)])).toBe(1)
  })

  it("can't edit or delete someone else's post, nor un-remove their own", async () => {
    expect(await count(bob, `update public.posts set body = 'x' where user_id = $1 returning 1`, [alice.id])).toBe(0)
    expect(await count(bob, `delete from public.posts where user_id = $1 returning 1`, [alice.id])).toBe(0)
    await expect(db.as(alice, `update public.posts set removed_at = null`)).rejects.toThrow(denied)
  })

  it('follow only as themselves, never themselves', async () => {
    await expect(db.as(carol, `insert into public.follows values ($1, $2)`, [bob.id, carol.id])).rejects.toThrow(denied)
    await expect(db.as(carol, `insert into public.follows (follower_id, followee_id) values (auth.uid(), auth.uid())`)).rejects.toThrow(/check|violates/)
  })

  it("reports are visible to their reporter, not to others", async () => {
    await db.as(carol, `insert into public.reports (kind, target_id, reason) values ('post', gen_random_uuid(), 'spam')`)
    expect(await count(carol, 'select * from public.reports')).toBe(1)
    expect(await count(bob, 'select * from public.reports')).toBe(0)
  })

  it("invites aren't readable by members", async () => {
    expect(await count(alice, 'select * from public.invites')).toBe(0)
  })
})

describe('library rows', () => {
  it('belong to their owner only', async () => {
    await db.as(alice, `insert into public.library_tracks (id, title, updated_at) values ('dQw4w9WgXcQ', 'Song', now())`)
    await db.as(alice, `insert into public.library_playlists (id, name, track_ids, updated_at) values ('p1', 'Mix', '{dQw4w9WgXcQ}', now())`)
    expect(await count(alice, 'select * from public.library_tracks')).toBe(1)
    expect(await count(alice, 'select * from public.library_playlists')).toBe(1)
    expect(await count(bob, 'select * from public.library_tracks')).toBe(0)
    expect(await count(bob, 'select * from public.library_playlists')).toBe(0)
    expect(await count(bob, `update public.library_tracks set title = 'x' returning 1`)).toBe(0)
    expect(await count(bob, `delete from public.library_tracks returning 1`)).toBe(0)
    await expect(
      db.as(bob, `insert into public.library_tracks (user_id, id, updated_at) values ($1, 'z', now())`, [alice.id]),
    ).rejects.toThrow(denied)
  })

  it('last write wins on updated_at, and tombstones stick', async () => {
    const t = '2026-01-01T00:00:00Z'
    await db.as(alice, `insert into public.library_tracks (id, title, updated_at) values ('lww', 'new', $1)`, [t])
    // An older edit loses, even as an upsert
    await db.as(
      alice,
      `insert into public.library_tracks (id, title, updated_at) values ('lww', 'old', $1::timestamptz - interval '1 day')
       on conflict (user_id, id) do update set title = excluded.title, updated_at = excluded.updated_at`,
      [t],
    )
    expect((await db.as<{ title: string }>(alice, `select title from public.library_tracks where id = 'lww'`))[0].title).toBe('new')
    const [before] = await db.as<{ synced_at: Date }>(alice, `select synced_at from public.library_tracks where id = 'lww'`)
    await db.as(alice, `update public.library_tracks set deleted = true, updated_at = $1::timestamptz + interval '1 day' where id = 'lww'`, [t])
    const [after] = await db.as<{ deleted: boolean; synced_at: Date }>(alice, `select deleted, synced_at from public.library_tracks where id = 'lww'`)
    expect(after.deleted).toBe(true)
    expect(after.synced_at.getTime()).toBeGreaterThan(before.synced_at.getTime())
  })
})

describe('activity', () => {
  beforeAll(async () => {
    await db.as(alice, `insert into public.plays (track_id, youtube_id, title, artist, played_at, listened_ms)
      values ('dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'Song', 'Artist', now(), 30000)`)
  })

  it('is hidden from followers while sharing is off', async () => {
    expect(await count(alice, 'select * from public.plays')).toBe(1)
    expect(await count(bob, 'select * from public.plays where user_id = $1', [alice.id])).toBe(0)
  })

  it('shows to followers only, once shared', async () => {
    await db.as(alice, 'update public.profiles set share_activity = true where id = auth.uid()')
    expect(await count(bob, 'select * from public.plays where user_id = $1', [alice.id])).toBe(1)
    expect(await count(carol, 'select * from public.plays where user_id = $1', [alice.id])).toBe(0)
    expect(await count(nobody, 'select * from public.plays where user_id = $1', [alice.id])).toBe(0)
  })

  it("can't be logged for someone else", async () => {
    await expect(
      db.as(bob, `insert into public.plays (user_id, track_id, title, played_at) values ($1, 'x', 'x', now())`, [alice.id]),
    ).rejects.toThrow(denied)
  })
})

describe('banned users', () => {
  let dave: { id: string }
  let admin: { id: string }
  beforeAll(async () => {
    dave = await db.member('dave')
    admin = await db.admin()
    await db.as(dave, `insert into public.posts (body) values ('dave was here')`)
    await db.as(dave, `insert into public.library_tracks (id, updated_at) values ('d1', now())`)
    await db.as(dave, `update public.profiles set share_activity = true where id = auth.uid()`)
    await db.as(dave, `insert into public.plays (track_id, title, played_at) values ('d1', 'x', now())`)
    await db.as(bob, `insert into public.follows (follower_id, followee_id) values (auth.uid(), $1)`, [dave.id])
    await db.as(admin, 'select public.admin_ban($1)', [dave.id])
  })

  it("can't write", async () => {
    expect(await count(dave, `update public.profiles set bio = 'x' where id = auth.uid() returning 1`)).toBe(0)
    await expect(db.as(dave, `insert into public.posts (body) values ('again')`)).rejects.toThrow(denied)
    await expect(db.as(dave, `insert into public.library_tracks (id, updated_at) values ('d2', now())`)).rejects.toThrow(denied)
    await expect(db.as(dave, `insert into public.follows (follower_id, followee_id) values (auth.uid(), $1)`, [alice.id])).rejects.toThrow(denied)
  })

  it('have their public content hidden', async () => {
    expect(await count('anon', `select * from public.profiles where handle = 'dave'`)).toBe(0)
    expect(await count('anon', 'select * from public.posts where user_id = $1', [dave.id])).toBe(0)
    expect(await count(bob, 'select * from public.plays where user_id = $1', [dave.id])).toBe(0)
    expect(await count('anon', 'select * from public.follows where followee_id = $1', [dave.id])).toBe(0)
    expect(await count('anon', `select * from public.luma_search('dave')`)).toBe(0)
  })

  it('still see their own profile (with the flag) and library backup', async () => {
    const [me] = await db.as<{ banned: boolean }>(dave, 'select banned from public.profiles where id = auth.uid()')
    expect(me.banned).toBe(true)
    expect(await count(dave, 'select * from public.library_tracks')).toBe(1)
  })

  it('come back when unbanned', async () => {
    await db.as(admin, 'select public.admin_ban($1, false)', [dave.id])
    expect(await count('anon', `select * from public.profiles where handle = 'dave'`)).toBe(1)
  })
})
