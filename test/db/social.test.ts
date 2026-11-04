// 0002: the media quota, admin_dismiss, admin_purge and a song on posts.
import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, FIRST, type Db, type Who } from './harness.ts'

const MB = 1024 * 1024
const QUOTA = 200 * MB
const rls = /row-level security/
const denied = /permission denied/

/** The error's SQLSTATE, or 'ok'. */
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? String(e))

describe('media quota', () => {
  let db: Db
  let alice: { id: string }
  let bob: { id: string }
  let nobody: { id: string }
  let admin: { id: string }
  let n = 0

  const put = (who: Who, owner: { id: string }, size: unknown, sub = 'posts') =>
    db.as(who, `insert into storage.objects (bucket_id, name, metadata) values ('media', $1, $2)`, [
      `${owner.id}/${sub}/f-${++n}.jpg`, JSON.stringify({ size }),
    ])
  const upload = (who: { id: string }, size: unknown = 1) => put(who, who, size)
  const left = async (who: Who) => (await db.as<{ l: string | null }>(who, 'select public.media_left() l'))[0].l
  const clear = (who: { id: string }) => db.as('owner', `delete from storage.objects where name like $1`, [`${who.id}/%`])

  beforeAll(async () => {
    db = await createDb()
    alice = await db.member('alice')
    bob = await db.member('bob')
    nobody = await db.user()
    admin = await db.admin()
  }, 60_000)

  it('media_left: quota minus used for members, 0 for non-members, null for admins, never for signed-out visitors', async () => {
    await upload(alice, 5 * MB)
    await upload(alice, 3 * MB)
    expect(Number(await left(alice))).toBe(QUOTA - 8 * MB)
    expect(Number(await left(bob))).toBe(QUOTA)
    expect(Number(await left(nobody))).toBe(0)
    expect(await left(admin)).toBeNull()
    await expect(left('anon')).rejects.toThrow(denied)
    await clear(alice)
  })

  it('refuses a member at the quota, uploads and replacements alike; others still upload', async () => {
    await upload(alice)
    await put('owner', alice, QUOTA, 'videos')
    expect(Number(await left(alice))).toBe(0)
    await expect(upload(alice)).rejects.toThrow(rls)
    await expect(db.as(alice, `update storage.objects set metadata = '{"size": 1}' where name like $1`, [`${alice.id}/posts/%`])).rejects.toThrow(rls)
    await upload(bob)

    await db.as('owner', `delete from storage.objects where name like $1`, [`${alice.id}/videos/%`])
    await upload(alice)
    await clear(alice)
    await clear(bob)
  })

  it('refuses a member keeping 2,000 files, however small', async () => {
    await db.as('owner', `insert into storage.objects (bucket_id, name, metadata)
      select 'media', $1 || '/posts/n-' || i || '.jpg', '{"size": 1}' from generate_series(1, 2000) i`, [alice.id])
    expect(Number(await left(alice))).toBe(0)
    await expect(upload(alice)).rejects.toThrow(rls)
    await clear(alice)
  })

  it('admins have no quota', async () => {
    await put('owner', admin, QUOTA * 2, 'videos')
    await upload(admin)
    await clear(admin)
  })

  it('a malformed size counts as 0 and never raises', async () => {
    for (const size of ['abc', -5, 1.5, '1e30', '9'.repeat(40), null, { a: 1 }]) await put('owner', alice, size)
    await db.as('owner', `insert into storage.objects (bucket_id, name, metadata) values ('media', $1, null)`, [`${alice.id}/posts/none.jpg`])
    expect(Number(await left(alice))).toBe(QUOTA)
    await upload(alice)
    await clear(alice)
  })

  it('still holds after a lone re-run of 0001', async () => {
    await put('owner', alice, QUOTA, 'videos')
    await db.pg.exec(FIRST)
    await expect(upload(alice)).rejects.toThrow(rls)
    await upload(bob)
    expect(Number(await left(alice))).toBe(0)
    await clear(alice)
    await clear(bob)
  })
})

describe('admin_dismiss and admin_purge', () => {
  let db: Db
  let admin: { id: string }
  let alice: { id: string }
  let bob: { id: string }
  let carol: { id: string }

  beforeAll(async () => {
    db = await createDb()
    admin = await db.admin()
    alice = await db.member('alice')
    bob = await db.member('bob')
    carol = await db.member('carol')
  }, 60_000)

  const post = async (who: { id: string }, body = 'hello') =>
    (await db.as<{ id: string }>(who, `insert into public.posts (body) values ($1) returning id`, [body]))[0].id
  const video = async (who: { id: string }) =>
    (await db.as<{ id: string }>(who, `insert into public.videos (path) values ($1) returning id`, [`${who.id}/videos/${Math.random()}.mp4`]))[0].id
  const report = (who: { id: string }, kind: string, id: string) =>
    db.as(who, `insert into public.reports (kind, target_id, reason) values ($1, $2, 'spam')`, [kind, id])
  const open = async (kind: string, id: string) =>
    Number((await db.as<{ n: string }>('owner', `select count(*) n from public.reports where kind = $1 and target_id = $2 and resolved_at is null`, [kind, id]))[0].n)

  it('admin_dismiss: admins and the SQL Editor only, a known kind', async () => {
    const id = await post(alice)
    expect(await code(db.as(bob, `select public.admin_dismiss('post', $1)`, [id]))).toBe('42501')
    await expect(db.as('anon', `select public.admin_dismiss('post', $1)`, [id])).rejects.toThrow(denied)
    expect(await code(db.as(admin, `select public.admin_dismiss('song', $1)`, [id]))).toBe('22023')
    expect(await code(db.as(admin, `select public.admin_dismiss(null, $1)`, [id]))).toBe('22023')
    await report(bob, 'post', id)
    await db.as('owner', `select public.admin_dismiss('post', $1)`, [id])
    expect(await open('post', id)).toBe(0)
  })

  it("admin_dismiss resolves only that target's open reports, and leaves the content showing", async () => {
    const reporter = await db.member()
    const target = await post(alice, 'keep me')
    const other = await post(alice, 'other')
    await report(reporter, 'post', target)
    await report(reporter, 'post', other)
    await db.as(reporter, `insert into public.reports (kind, target_id) select 'post', gen_random_uuid() from generate_series(1, 48)`)
    await expect(report(reporter, 'video', await video(alice))).rejects.toThrow(/limit reached/) // 50 open

    await db.as(admin, `select public.admin_dismiss('post', $1)`, [target])
    expect(await open('post', target)).toBe(0)
    expect(await open('post', other)).toBe(1)
    const shown = await db.as<{ body: string }>('anon', 'select body from public.posts where id = $1', [target])
    expect(shown).toEqual([{ body: 'keep me' }])
    await report(reporter, 'video', await video(alice)) // room again
  })

  it('admin_purge: admins only, and only after a ban', async () => {
    expect(await code(db.as(bob, 'select public.admin_purge($1)', [carol.id]))).toBe('42501')
    await expect(db.as('anon', 'select public.admin_purge($1)', [carol.id])).rejects.toThrow(denied)
    expect(await code(db.as(admin, 'select public.admin_purge($1)', [carol.id]))).toBe('22023')
  })

  it('after a ban, removes everything they posted, clears the profile and resolves every report about them', async () => {
    const target = await db.member('target')
    await db.as(target, `update public.profiles set name = 'Target', bio = 'hi', avatar_path = $1, avatar_kind = 'image' where id = auth.uid()`, [`${target.id}/profile/a.jpg`])
    const posts = [await post(target), await post(target)]
    const videos = [await video(target)]
    const mine = await post(bob, 'not theirs')
    await report(alice, 'profile', target.id)
    await report(alice, 'post', posts[0])
    await report(carol, 'video', videos[0])
    await report(alice, 'post', mine)

    await db.as(admin, 'select public.admin_ban($1)', [target.id])
    await db.as(admin, 'select public.admin_purge($1)', [target.id])

    const rows = await db.as<{ removed: boolean }>('owner', `select removed_at is not null removed from public.posts where user_id = $1
      union all select removed_at is not null from public.videos where user_id = $1`, [target.id])
    expect(rows.length).toBe(3)
    expect(rows.every((r) => r.removed)).toBe(true)
    const [p] = await db.as<Record<string, unknown>>('owner', 'select name, bio, avatar_path, banned from public.profiles where id = $1', [target.id])
    expect(p).toEqual({ name: '', bio: null, avatar_path: null, banned: true })
    expect(await open('profile', target.id)).toBe(0)
    expect(await open('post', posts[0])).toBe(0)
    expect(await open('video', videos[0])).toBe(0)
    expect(await open('post', mine)).toBe(1) // someone else's content

    const before = await db.as('owner', `select id, removed_at from public.posts where user_id = $1 union all select id, removed_at from public.videos where user_id = $1
      union all select id, resolved_at from public.reports order by 1`, [target.id])
    await db.as(admin, 'select public.admin_purge($1)', [target.id]) // a second call changes nothing
    expect(await db.as('owner', `select id, removed_at from public.posts where user_id = $1 union all select id, removed_at from public.videos where user_id = $1
      union all select id, resolved_at from public.reports order by 1`, [target.id])).toEqual(before)
    await db.as('owner', 'select public.admin_purge($1)', [target.id]) // the SQL Editor too
  })
})

describe('a song on posts', () => {
  let db: Db
  let alice: { id: string }
  let nobody: { id: string }

  beforeAll(async () => {
    db = await createDb()
    alice = await db.member('alice')
    nobody = await db.user()
  }, 60_000)

  const insert = (who: Who, row: Record<string, unknown>) =>
    db.as<{ id: string }>(who, `insert into public.posts (${Object.keys(row)}) values (${Object.keys(row).map((_, i) => `$${i + 1}`)}) returning id`, Object.values(row))

  it('members attach a song; anyone reads it; search finds it', async () => {
    const [{ id }] = await insert(alice, { body: 'on repeat', youtube_id: 'dQw4w9WgXcQ', track_title: 'Neverland Synth', track_artist: 'Rick' })
    const [row] = await db.as('anon', 'select youtube_id, track_title, track_artist from public.posts where id = $1', [id])
    expect(row).toEqual({ youtube_id: 'dQw4w9WgXcQ', track_title: 'Neverland Synth', track_artist: 'Rick' })
    expect(await db.as('anon', `select kind, id from public.luma_search('neverla')`)).toEqual([{ kind: 'post', id }])
    expect(await db.as('anon', `select kind, id from public.luma_search('rick')`)).toEqual([{ kind: 'post', id }])
  })

  it('bounded: an 11-character YouTube id, titles of at most 300 characters', async () => {
    expect(await code(insert(alice, { body: 'x', youtube_id: 'bad' }))).toBe('23514')
    expect(await code(insert(alice, { body: 'x', track_title: 'x'.repeat(301) }))).toBe('23514')
    expect(await code(insert(alice, { body: 'x', track_artist: 'x'.repeat(301) }))).toBe('23514')
    expect(await code(insert(alice, { body: 'x', track_title: 'x'.repeat(300), track_artist: 'y'.repeat(300) }))).toBe('ok')
  })

  it('a song alone is not a post', async () => {
    expect(await code(insert(alice, { youtube_id: 'dQw4w9WgXcQ', track_title: 'Song' }))).toBe('23514')
  })

  it('non-members and signed-out visitors post nothing', async () => {
    await expect(insert(nobody, { body: 'x', track_title: 'Song' })).rejects.toThrow(rls)
    await expect(insert('anon', { body: 'x', track_title: 'Song' })).rejects.toThrow(denied)
  })
})
