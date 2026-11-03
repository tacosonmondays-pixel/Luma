// The script can be run again, and over a database made by its previous release, even one holding rows today's
// rules refuse: they are brought within the rules, and the result matches a fresh install.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'
import { createDb, MIGRATION } from './harness.ts'

const PREVIOUS = readFileSync(new URL('./fixtures/0001_luma.previous.sql', import.meta.url), 'utf8')
const EVIL = '00000000-0000-4000-8000-00000000e711'

// What a member could store under the previous release (written here as the owner, the way PostgREST would have).
const HOSTILE = `
insert into auth.users (id, email) values ('${EVIL}', 'evil@example.com');
insert into public.profiles (id, member, handle) values ('${EVIL}', true, 'evil');
update public.profiles set bio = 'SPAM', effect = 'boom', frame = 'x pc-wrap', name_style = 'a b c',
  badges = '[{"id": "toString", "tier": 1}]', pinned_songs = '[null]', pinned_playlists = array[repeat('x', 100000)],
  avatar_path = '${EVIL}/profile/../../someone/profile/a.jpg', banner_path = '${EVIL}/profile/' || repeat('x', 1000),
  share_activity = true, updated_at = '294276-12-31T23:59:59.999999Z' where id = '${EVIL}';
insert into public.posts (user_id, body, image_paths) values ('${EVIL}', '', array[null]::text[]), ('${EVIL}', 'fine', '{}');
insert into public.videos (user_id, path, still_path) values ('${EVIL}', '${EVIL}/videos/../x.mp4', null),
  ('${EVIL}', '${EVIL}/videos/ok.mp4', '${EVIL}/videos/../still.jpg');
insert into public.library_tracks (user_id, id, updated_at) values ('${EVIL}', 't', '294276-12-31T23:59:59.999999Z');
insert into public.library_playlists (user_id, id, track_ids, updated_at) values ('${EVIL}', 'p', array[repeat('y', 2000)], now());
`

async function snapshot(pg: PGlite) {
  const q = async (sql: string) => (await pg.query(sql)).rows
  return {
    tables: await q(`select n.nspname, c.relname, c.relacl::text, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'luma') and c.relkind = 'r' order by 1, 2`),
    columns: await q(`select c.relname, a.attname, a.attacl::text from pg_attribute a join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'luma') and a.attnum > 0 and not a.attisdropped order by 1, 2`),
    functions: await q(`select n.nspname, p.proname, p.proacl::text, p.prosecdef, p.proconfig::text, md5(p.prosrc) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'luma') order by 1, 2`),
    policies: await q(`select schemaname, tablename, policyname, roles::text, cmd, qual, with_check from pg_policies order by 1, 2, 3`),
    constraints: await q(`select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint
      where connamespace in ('public'::regnamespace, 'luma'::regnamespace) order by 1, 2`),
    triggers: await q(`select tgrelid::regclass::text, tgname, pg_get_triggerdef(oid) from pg_trigger where not tgisinternal order by 1, 2`),
  }
}

it('a second run, and an upgrade from the previous release, give a fresh install', async () => {
  const fresh = await createDb()
  const again = await createDb(MIGRATION)
  const upgraded = await createDb(PREVIOUS + HOSTILE)
  const a = await snapshot(fresh.pg)
  expect(await snapshot(again.pg)).toEqual(a)
  expect(await snapshot(upgraded.pg)).toEqual(a)
}, 120_000)

it('an upgrade brings old rows within the rules, and the admin RPCs work on them', async () => {
  const db = await createDb(PREVIOUS + HOSTILE)
  const [p] = await db.as<Record<string, unknown>>('owner', 'select * from public.profiles where id = $1', [EVIL])
  expect(p).toMatchObject({
    bio: 'SPAM', effect: null, frame: null, name_style: null, badges: [], pinned_songs: [], pinned_playlists: [],
    avatar_path: null, banner_path: null, share_activity: true,
  })
  expect((p.updated_at as Date).getTime()).toBeLessThanOrEqual(Date.now() + 1000)
  expect(p.sharing_since).not.toBeNull()
  const posts = await db.as<{ body: string }>('owner', 'select body from public.posts where user_id = $1', [EVIL])
  expect(posts.map((r) => r.body)).toEqual(['fine'])
  const videos = await db.as<{ path: string; still_path: string | null }>('owner', 'select path, still_path from public.videos where user_id = $1', [EVIL])
  expect(videos).toEqual([{ path: `${EVIL}/videos/ok.mp4`, still_path: null }])
  const [t] = await db.as<{ updated_at: Date }>('owner', 'select updated_at from public.library_tracks where user_id = $1', [EVIL])
  expect(t.updated_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
  const [l] = await db.as<{ track_ids: string[] }>('owner', 'select track_ids from public.library_playlists where user_id = $1', [EVIL])
  expect(l.track_ids).toEqual([])

  await db.as('owner', `select public.admin_remove('profile', $1)`, [EVIL])
  await db.as('owner', 'select public.admin_ban($1)', [EVIL])
  const [after] = await db.as<{ banned: boolean; bio: string | null }>('owner', 'select banned, bio from public.profiles where id = $1', [EVIL])
  expect(after).toEqual({ banned: true, bio: null })
}, 60_000)
