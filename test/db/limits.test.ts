// Every value a member writes is bounded, and so is how much they can write. The publishable key is public, so these
// are what stands between one member with curl and a full (read-only) free-plan database or a broken public page.
import { beforeAll, describe, expect, it } from 'vitest'
import { BADGE_IDS, EFFECT_IDS, FRAME_IDS, NAME_STYLE_IDS } from '../../src/types.ts'
import { createDb, type Db } from './harness.ts'

let db: Db
let m: { id: string }

beforeAll(async () => {
  db = await createDb()
  m = await db.member('limits')
}, 60_000)

const set = (sql: string, params: unknown[] = []) => db.as(m, `update public.profiles set ${sql} where id = auth.uid() returning 1`, params)
const bad = /check constraint|violates/

describe('profile fields', () => {
  it('take only the ids the app knows', async () => {
    for (const id of FRAME_IDS) expect(await set('frame = $1', [id])).toHaveLength(1)
    for (const id of EFFECT_IDS) expect(await set('effect = $1', [id])).toHaveLength(1)
    for (const id of NAME_STYLE_IDS) expect(await set('name_style = $1', [id])).toHaveLength(1)
    expect(await set('frame = null, effect = null, name_style = null')).toHaveLength(1)
    await expect(set(`effect = 'boom'`)).rejects.toThrow(bad)
    await expect(set(`frame = 'x pc-wrap'`)).rejects.toThrow(bad)
    await expect(set(`name_style = 'a b c'`)).rejects.toThrow(bad)
  })

  it('badges are known ids with a tier from 1 to 4', async () => {
    expect(await set('badges = $1', [JSON.stringify(BADGE_IDS.map((id) => ({ id, tier: 4 })))])).toHaveLength(1)
    for (const badges of [
      [{ id: 'toString', tier: 1 }],
      [{ id: 'hours', tier: 5 }],
      [{ id: 'hours', tier: '1' }],
      [{ id: 'hours', tier: 1.5 }],
      [{ id: 'hours', tier: 1, x: 'y' }],
      [null],
      ['hours'],
      { id: 'hours', tier: 1 },
    ])
      await expect(set('badges = $1', [JSON.stringify(badges)]), JSON.stringify(badges)).rejects.toThrow(bad)
  })

  it('pinned songs are { id, title, artist, source } with strings', async () => {
    const song = { id: 'dQw4w9WgXcQ', title: 'Song', artist: 'Artist', source: 'youtube' }
    expect(await set('pinned_songs = $1', [JSON.stringify([song, { ...song, id: 'f-1', source: 'file' }])])).toHaveLength(1)
    for (const pins of [
      [null],
      [{ ...song, title: { a: 1 } }],
      [{ ...song, artist: [] }],
      [{ ...song, source: 'audio' }],
      [{ ...song, id: '' }],
      [{ ...song, extra: 'x'.repeat(1000) }],
      [{ ...song, title: 'x'.repeat(301) }],
      [song, song, song, song, song, song],
    ])
      await expect(set('pinned_songs = $1', [JSON.stringify(pins)]), JSON.stringify(pins).slice(0, 80)).rejects.toThrow(bad)
  })

  it('pinned playlists are at most 6 short ids', async () => {
    expect(await set('pinned_playlists = $1', [['a', 'b', 'c', 'd', 'e', 'f']])).toHaveLength(1)
    await expect(set('pinned_playlists = $1', [['x'.repeat(65)]])).rejects.toThrow(bad)
    await expect(set('pinned_playlists = $1', [['x'.repeat(5_000_000)]])).rejects.toThrow(bad)
    await expect(set('pinned_playlists = array[null]::text[]')).rejects.toThrow(bad)
  })

  it('media paths are one file in their own profile folder, short, without ..', async () => {
    expect(await set('avatar_path = $1, avatar_still_path = $2', [`${m.id}/profile/avatar-1.gif`, `${m.id}/profile/avatar-1-still.jpg`])).toHaveLength(1)
    const victim = await db.member()
    for (const path of [
      `${m.id}/profile/../../${victim.id}/profile/avatar-1.jpg`,
      `${m.id}/profile/x/../../${victim.id}/profile/avatar-1.jpg`,
      `${m.id}/profile/deep/a.jpg`,
      `${m.id}/profile/`,
      `${m.id}/profile/` + 'x'.repeat(200),
      `${victim.id}/profile/a.jpg`,
    ])
      for (const col of ['avatar_path', 'banner_still_path', 'backdrop_path'])
        await expect(set(`${col} = $1`, [path]), `${col} ${path.slice(37, 80)}`).rejects.toThrow(bad)
  })

  it('updated_at stays a sane time', async () => {
    // A device sending a far-future time is capped at the server's (rpc.test.ts); the range itself holds for everyone.
    await expect(db.as('owner', `update public.profiles set updated_at = '294276-12-31Z' where id = $1`, [m.id])).rejects.toThrow(bad)
    await expect(db.as('owner', `update public.profiles set updated_at = '-infinity' where id = $1`, [m.id])).rejects.toThrow(bad)
  })
})

describe('posts and videos', () => {
  it('image paths: no nulls, no climbing out of the folder, at most 200 characters', async () => {
    for (const paths of [[null], [null, null], [`${m.id}/posts/../profile/a.jpg`], [`${m.id}/posts/` + 'x'.repeat(5_000_000)]])
      await expect(db.as(m, `insert into public.posts (body, image_paths) values ('', $1::text[])`, [paths])).rejects.toThrow(/row-level security|check/)
    await expect(db.as(m, `insert into public.videos (path) values ($1)`, [`${m.id}/videos/` + 'x'.repeat(300)])).rejects.toThrow(/row-level security|check/)
    await expect(db.as(m, `insert into public.videos (path, still_path) values ($1, $2)`, [`${m.id}/videos/v.mp4`, `${m.id}/videos/../x.jpg`])).rejects.toThrow(/row-level security|check/)
  })

  it('at most 100 posts and 25 videos a day', async () => {
    const poster = await db.member()
    await db.as(poster, `insert into public.posts (body) select 'post ' || i from generate_series(1, 100) i`)
    await expect(db.as(poster, `insert into public.posts (body) values ('one more')`)).rejects.toThrow(/limit reached/)
    await db.as(poster, `insert into public.videos (path) select $1 || i || '.mp4' from generate_series(1, 25) i`, [`${poster.id}/videos/`])
    await expect(db.as(poster, `insert into public.videos (path) values ($1)`, [`${poster.id}/videos/x.mp4`])).rejects.toThrow(/limit reached/)
    // Yesterday's don't count.
    await db.as('owner', `update public.posts set created_at = now() - interval '2 days' where user_id = $1`, [poster.id])
    expect(await db.as(poster, `insert into public.posts (body) values ('next day') returning 1`)).toHaveLength(1)
  })

  it('at most 50 open reports per member', async () => {
    const reporter = await db.member()
    await db.as(reporter, `insert into public.reports (kind, target_id) select 'post', gen_random_uuid() from generate_series(1, 50)`)
    await expect(db.as(reporter, `insert into public.reports (kind, target_id) values ('post', gen_random_uuid())`)).rejects.toThrow(/limit reached/)
  })
})

describe('library backup', () => {
  it('playlists hold short ids only', async () => {
    await expect(
      db.as(m, `insert into public.library_playlists (id, track_ids, updated_at) values ('p', $1, now())`, [['x'.repeat(2000)]]),
    ).rejects.toThrow(bad)
    await expect(db.as(m, `insert into public.library_playlists (id, track_ids, updated_at) values ('p', array[null]::text[], now())`)).rejects.toThrow(bad)
  })

  it('has a size limit per member: 20,000 songs, 2,000 playlists, 100,000 playlist entries', async () => {
    const big = await db.member()
    await db.as(big, `insert into public.library_tracks (id, updated_at) select 't' || i, now() from generate_series(1, 20000) i`)
    await expect(db.as(big, `insert into public.library_tracks (id, updated_at) values ('one-more', now())`)).rejects.toThrow(/limit reached/)
    // Updating what is there still works (an upsert of known songs).
    expect(await db.as(big, `insert into public.library_tracks (id, title, updated_at) values ('t1', 'Renamed', now())
      on conflict (user_id, id) do update set title = excluded.title, updated_at = excluded.updated_at returning 1`)).toHaveLength(1)

    const ids = Array.from({ length: 5000 }, (_, i) => `t${i}`)
    await db.as(big, `insert into public.library_playlists (id, track_ids, updated_at) select 'p' || i, $1, now() from generate_series(1, 19) i`, [ids])
    await db.as(big, `insert into public.library_playlists (id, track_ids, updated_at) values ('p20', $1, now())`, [ids.slice(0, 4999)])
    await db.as(big, `update public.library_playlists set track_ids = track_ids || '{t1}'::text[], updated_at = now() where id = 'p20'`) // 100,000
    await expect(db.as(big, `insert into public.library_playlists (id, track_ids, updated_at) values ('p21', '{t1}', now())`)).rejects.toThrow(/limit reached/)
    await db.as(big, `update public.library_playlists set track_ids = '{}', updated_at = now() where id = 'p19'`) // 95,000
    await db.as(big, `insert into public.library_playlists (id, track_ids, updated_at) values ('p21', $1, now())`, [ids]) // 100,000
    await expect(db.as(big, `update public.library_playlists set track_ids = '{t1}', updated_at = now() where id = 'p19'`)).rejects.toThrow(/limit reached/)
    await expect(
      db.as(big, `insert into public.library_playlists (id, updated_at) select 'e' || i, now() from generate_series(1, 2001) i`),
    ).rejects.toThrow(/limit reached/)
  }, 60_000)
})

describe('plays', () => {
  it('keep each player’s newest 5,000', async () => {
    const fan = await db.member()
    await db.as(fan, 'update public.profiles set share_activity = true where id = auth.uid()')
    await db.as(fan, `insert into public.plays (track_id, title, played_at)
      select 's', 'Song', now() + make_interval(secs => i) from generate_series(1, 5001) i`)
    const [{ n, first }] = await db.as<{ n: string; first: Date }>(fan, 'select count(*) as n, min(played_at) as first from public.plays')
    expect(Number(n)).toBe(5000)
    expect(first.getTime()).toBeGreaterThan(Date.now()) // the oldest one went
  })
})

describe('sharing listening', () => {
  let player: { id: string }
  let follower: { id: string }
  const play = (sql: string) =>
    db.as(player, `insert into public.plays (track_id, title, played_at) values ${sql}
      on conflict (user_id, track_id, played_at) do update set listened_ms = excluded.listened_ms`)
  const seen = async () => (await db.as<{ title: string }>(follower, 'select title from public.plays where user_id = $1 order by played_at', [player.id])).map((r) => r.title)

  beforeAll(async () => {
    player = await db.member()
    follower = await db.member()
    await db.as(follower, 'insert into public.follows (follower_id, followee_id) values (auth.uid(), $1)', [player.id])
  })

  it('the server notes when sharing turned on; nobody can set it', async () => {
    await db.as(player, 'update public.profiles set share_activity = true where id = auth.uid()')
    const [p] = await db.as<{ sharing_since: Date }>(player, 'select sharing_since from public.profiles where id = auth.uid()')
    expect(Math.abs(p.sharing_since.getTime() - Date.now())).toBeLessThan(5000)
    await expect(db.as(player, `update public.profiles set sharing_since = '2000-01-01Z' where id = auth.uid()`)).rejects.toThrow(/permission denied/)
  })

  it("a device that missed the switch-off can't publish what was played meanwhile", async () => {
    await play(`('a', 'shared', now())`)
    // Sharing goes off on the phone. The desk still has the old row and keeps uploading.
    await db.as(player, 'update public.profiles set share_activity = false where id = auth.uid()')
    await new Promise((r) => setTimeout(r, 5))
    await play(`('b', 'while off', now())`)
    await new Promise((r) => setTimeout(r, 5))
    const off = new Date().toISOString()
    // Sharing comes back on. The desk sends its whole batch: only plays since then land, without an error.
    await new Promise((r) => setTimeout(r, 5))
    await db.as(player, 'update public.profiles set share_activity = true where id = auth.uid()')
    await new Promise((r) => setTimeout(r, 5))
    await play(`('b', 'while off', '${off}'), ('c', 'after', now())`)
    expect(await seen()).toEqual(['shared', 'after'])
  })
})
