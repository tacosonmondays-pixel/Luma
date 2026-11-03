# Luma's server: the contract

The Supabase layer, for code built on it (the social screens: friends feed, videos, posts, Luma search, moderation). The source of truth is `supabase/migrations/0001_luma.sql`. The tests in `test/db/` prove every rule below against it. Setup steps for the owner are in `supabase/README.md`.

The server is optional. Signed out or offline, Luma works exactly as it does without one. Never make a local feature depend on it.

## Principles

- **Invite-only writes.** Anyone may sign in. Only **members** (who redeemed an invite) write anything: profile, uploads, posts, follows, plays, library backup.
- **Public reads.** Anyone, even signed out (the `anon` role), reads public profiles, videos, posts and follows.
- **Banned** users can't write, and their public content disappears from every public read and from search. They still read their own profile row (with `banned = true`) and their own library backup.
- **Admins** (the owner) create invites, remove content and ban accounts, through RPCs only.
- **Never song audio.** No table or bucket holds audio. The bucket refuses audio MIME types and extensions. Library sync is metadata only.
- **Deny by default.** Every table has RLS on, and grants are revoked and given back per column where it matters. Anything not listed here is refused.
- **Bounded.** The publishable key is public, so a member can send any value with curl. Every value members write has a type and a size limit (CHECK constraints), and each member has quotas (triggers), so one member can't break someone's page or fill the free plan's 500 MB. A write over a limit fails: `23514` (a check) or `54000` (a quota).

Roles: `anon` (signed out) and `authenticated` (signed in, member or not). `auth.uid()` is the signed-in user. The SQL Editor runs as the owner.

## Helpers (schema `luma`, not exposed through the API)

| Function | True when |
|---|---|
| `luma.is_member()` | the caller has a profile with `member` and not `banned` |
| `luma.is_admin()` | the caller is a member, an admin and not banned |
| `luma.is_operator()` | `is_admin()`, or the call comes from the SQL Editor (not an `anon`/`authenticated` request) |
| `luma.is_visible(uid)` | that user is a member and not banned: their public content shows |
| `luma.sees_activity(uid)` | the caller may read that user's plays (see `plays`) |
| `luma.own_paths(paths, sub)` | every path is a media path (below) of the caller's, under `sub` |
| `luma.media_path_ok(name)` | a storage name is `<caller uid>/<profile\|videos\|posts>/<file>.<allowed ext>` |

Policies use these. New tables should too. The checks use these immutable ones:

| Function | True when |
|---|---|
| `luma.ids(kind)` | (returns) the ids the app knows: `frame`, `effect`, `name_style`, `badge`. The same lists as `FRAME_IDS`, `EFFECT_IDS`, `NAME_STYLE_IDS` and `BADGE_IDS` in `src/types.ts`: add a new one to both (`test/db/limits.test.ts` checks the server takes each of the app's). |
| `luma.path_ok(p, owner, sub)` | `p` is null, or `<owner>/<sub>/<file>`: one level, no `..`, at most 200 characters |
| `luma.paths_ok(paths, owner, sub)` | every path is one of those, and none is null |
| `luma.texts_ok(texts, n, len)` | at most `n` texts of at most `len` characters, none null |
| `luma.pins_ok(pins)`, `luma.badges_ok(badges)` | the shapes of `pinned_songs` and `badges` (below) |

Triggers act on the app's writes only (requests as `anon` or `authenticated`). The RPCs (security definer, so they run as the functions' owner) and the SQL Editor are never skipped or limited by them.

## Tables

All timestamps are `timestamptz`. `user_id` columns default to `auth.uid()`, so inserts may omit them.

### `profiles`: one per member

| Column | Notes |
|---|---|
| `id` | = `auth.users.id` |
| `handle` | `^[a-z0-9_]{3,20}$`, unique (also on `lower(handle)`), null until claimed |
| `member`, `admin`, `banned` | Flags. **Not writable by users** (no column grant). They change only through RPCs. |
| `name` (≤ 40), `bio` (≤ 190) | |
| `colors`, `auto_colors` | `text[2]` of `#rrggbb`, or null |
| `frame`, `effect`, `name_style` | ids from `src/types.ts` (`FRAME_IDS`, `EFFECT_IDS`, `NAME_STYLE_IDS`), nothing else |
| `pinned_songs` | jsonb `[{ id, title, artist, source }]`, ≤ 5, newest first: exactly those keys, strings (`id` 1–64 characters, `title` and `artist` ≤ 300), `source` `youtube` or `file`. Denormalized so the public page needs no library access. |
| `pinned_playlists` | text[] of playlist ids, ≤ 6, each ≤ 64 characters (private ids; playlists aren't public) |
| `badges` | jsonb `[{ id, tier }]`, earned badges (max tier seen on any device): ids from `BADGE_IDS`, `tier` a whole number from 1 to 4, nothing else |
| `{avatar,banner,backdrop}_path` | storage path in `media`: `<id>/profile/<file>` (`luma.path_ok`). |
| `…_still_path` | the JPEG still of an animated image or video |
| `…_kind` | `image`, `animated` (and for the backdrop `video`) |
| `…_version` | the device's blob version (`Date.now()`) the file was made from |
| `crops` | jsonb `{ avatar?, banner?, backdrop? }`, each `{ x, y, zoom }`: the visible position and zoom (`Profile.avatarCrop` …). Apply them on the public card too. |
| `share_activity` | default false. Followers see plays only while it's on. |
| `sharing_since` | the server's time when `share_activity` last turned on. Set by a trigger; not writable. |
| `updated_at` | the editing device's clock, capped at the server's (a clock that runs ahead, or a crafted request, can't put an edit in the future). From 1970 to 9999. **Last write wins**: an update with an older `updated_at` is skipped by a trigger, and PostgREST then returns no row and no error: the server holds a newer edit. |
| `search` | generated tsvector (handle, name, bio) |

Policies:
- **select:** `anon` and `authenticated` see rows with a handle that are members and not banned. Users always see their own row. Admins see all.
- **update:** members, own row, allowed columns only.
- **No insert or delete policy.** Rows are made by `redeem_invite`, `make_admin` and `admin_ban`. Deleting the auth user cascades.

### `invites`

`code` (`^[A-Z0-9]{6,32}$`, primary key), `created_by`, `created_at`, `expires_at` (null = never), `used_by` (unique), `used_at`. Only admins can read it. Only RPCs write it. A code is spent once `used_at` is set, for good: deleting the account that used it empties `used_by` but doesn't free the code. Failed attempts go to the private `luma.invite_attempts` table, which nobody can read through the API.

The private `luma.banned_emails` holds the (lower-case) emails of banned accounts, so a ban outlives the account.

### `follows`

`(follower_id, followee_id)` primary key, `created_at`. You can't follow yourself.
- **select:** public when both users are visible. Your own follows are always visible to you.
- **insert:** members, as themselves, and only to follow a visible user.
- **delete:** members, their own follows.

No approval step. Anyone may follow any visible member.

### `plays`: the activity feed

`id`, `user_id`, `track_id` (the library id), `youtube_id` (11 chars, or null for imported files), `title`, `artist`, `played_at`, `listened_ms`. Unique `(user_id, track_id, played_at)`, so clients upsert (`onConflict: 'user_id,track_id,played_at'`) as listened time grows.
- **select:** your own plays. Also another user's, if all of these hold: you're a member, you follow them, they're visible, and their `share_activity` is on. Signed-out visitors see nothing.
- **insert, update, delete:** members, own rows only.
- **Only while sharing:** a trigger skips (without an error, so the rest of a batch lands) any play written while its player's `share_activity` is off, or with `played_at` before `sharing_since`. A device that missed sharing going off can't publish what was played meanwhile, even later.
- Each player keeps their newest 5,000 plays; older ones are deleted as new ones arrive.

The client (`sync.ts`) uploads plays only while `share_activity` is on (it checks the row first), and only those started after it was turned on.

Feed query: `select * from plays order by played_at desc limit 50`. RLS already narrows it to people you follow (plus yourself).

### `library_tracks` and `library_playlists`: private backup

| `library_tracks` | `library_playlists` |
|---|---|
| `user_id, id` primary key | `user_id, id` primary key |
| `title`, `artist`, `duration`, `source` (`youtube`/`file`), `added_at` | `name`, `track_ids text[]`, `created_at` |
| `deleted` (tombstone), `updated_at` (device clock), `synced_at` (server clock) | same |

- Owner only: select your own rows; insert, update and delete need membership. A banned owner can still read.
- **Last write wins:** a write with an older `updated_at` than the stored row is dropped by a trigger, even through an upsert. Deletions are rows with `deleted = true`, never row deletes.
- Every write sets `synced_at = clock_timestamp()`. Pull with `synced_at > cursor` (`sync.ts` goes back a minute to cover late commits).
- `updated_at` is capped at the server's clock, as on `profiles`.
- Limits per member: 20,000 songs (tombstones count), 2,000 playlists, 100,000 playlist entries in all; ids ≤ 64 characters.

No audio, no cover art. A synced song arrives on a new device as `Track.missing`, shown as not downloaded until it is downloaded or imported again.

### `videos`

`id`, `user_id`, `path` and `still_path` (`<user_id>/videos/<file>`), `caption` (≤ 300), the song it's set to as metadata only (`youtube_id`, `track_title`, `track_artist`), `duration`, `created_at`, `removed_at`, `search` (caption, track title, track artist).
- **select:** public when not removed and the owner is visible. The owner and admins always see them.
- **insert:** members, as themselves, with paths in their own `videos/` folder.
- **update:** members, own, not removed, `caption` only. **delete:** members, own.
- At most 25 a day per member.

### `posts`

`id`, `user_id`, `body` (≤ 1000), `image_paths text[]` (≤ 4, each `<user_id>/posts/<file>`, no nulls), `created_at`, `removed_at`, `search`. A post needs a body or at least one image. The policies match `videos`; updates touch `body` only. At most 100 a day per member.

### `reports`

`id`, `reporter_id`, `kind` (`profile`/`video`/`post`), `target_id`, `reason` (≤ 500), `created_at`, `resolved_at`. Unique per reporter and target.
- **insert:** members, at most 50 open (unresolved) at a time. **select:** your own reports; admins see all.
- `admin_remove` and `admin_ban` resolve matching open reports.

## RPCs

All are `security definer` with `search_path = ''`. Execute is revoked from `public` and `anon`, then granted as listed.

| Call | Who | Does |
|---|---|---|
| `redeem_invite(code text) → text` | authenticated | Makes the caller a member, creating their profile row. Returns `ok`, `member` (already), `invalid` (unknown, used or expired), `rate_limited` (5 failed tries an hour) or `banned` (this account, or its email, is banned). Single use, ever, atomic. Case and spaces don't matter. |
| `create_invites(n int = 1, days int = 30) → (code, expires_at)` | operators | `n` from 1 to 100. `days = null` makes codes that never expire. |
| `luma_search(q text) → (kind, id, user_id, handle, title, rank)` | anon, authenticated | Full-text search over visible profiles, unremoved videos and posts. Each word is a prefix (`synth` finds "synthwave"). At most 8 words, 50 rows, best first. `title` is the name, caption or start of the post. Blank queries return nothing. |
| `admin_remove(kind text, id uuid)` | operators | `video`/`post`: sets `removed_at`. `profile`: clears name, bio, pins and media, and bumps `updated_at` past any device's edit. Resolves reports. |
| `admin_ban(target uuid, ban bool = true)` | operators | Sets `banned`, creating a row for non-members so they can't redeem later, and remembers the email (unbanning forgets it). Admins can't be banned. Resolves profile reports. |
| `make_admin(email text) → uuid` | SQL Editor only (no grants) | Makes that account a member and admin. |

Call from the client: `supabase.rpc('luma_search', { q })`. Errors raised to callers use SQLSTATE `42501` (not allowed) or `22023` (bad argument). Whatever a member writes, the RPCs' own writes always land: no member's row can make `admin_ban` or `admin_remove` fail.

## Storage: the `media` bucket

Public bucket, 50 MB per file (the free plan's cap). Accepted MIME types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/apng`, `video/mp4`, `video/quicktime`, `video/webm`. No audio.

```
media/<uid>/profile/<slot>-<version>.<ext>         avatar | banner | backdrop
media/<uid>/profile/<slot>-<version>-still.jpg
media/<uid>/videos/<anything>.<mp4|mov|webm|jpg…>
media/<uid>/posts/<anything>.<jpg|png|gif|webp…>
```

- **insert:** members, into their own folder, one level of subfolder (`profile`, `videos` or `posts`), allowed extensions only, no `..`.
- **update:** the same rules (for upserts). **select** (listing): the owner and admins. **delete:** the owner, if a member, and admins.
- **Reads go through public URLs** and skip RLS: `${SUPABASE_URL}/storage/v1/object/public/media/<path>` (`mediaUrl()` in `src/lib/supabase.ts`). Hiding a row hides the content in the app, but a public URL keeps working until the file is deleted. When moderating, delete the files too (admins can, through `storage.from('media').remove([...])`).
- Use a new file name per version, never overwrite in place. The CDN caches public files for a year (`cacheControl: '31536000'`).
- Size and type limits per kind (avatar, canvas, background) live in the client (`media.ts` `LIMITS`). The bucket only enforces the global 50 MB cap.

## Client modules

- `src/lib/supabase.ts`: the project URL and publishable key, `supabase()` (lazy-loaded client), `mediaUrl()`, `BUCKET`. The session lives in localStorage under `luma-auth`.
- `src/lib/account.ts`: `useAccount` (`user`, `row`). Also `startAccount`, `resumeAccount`, `signIn(email)` (sends a 6-digit code), `verify(email, code)`, `signOut`, `redeemInvite`, `claimHandle`, `setShareActivity`, `refreshRow`, `fetchPublicProfile(handle)`, `profileFromRow`, `pinnedOf`, `badgesOf`, `profilePath`, `profileLink(handle)` and `isMember()`. `signOut` forgets the saved session on the device first, so it holds offline too (supabase-js alone keeps a session whose access token expired when it can't refresh it).
- Someone's row is anyone's JSON: read it through `profileFromRow`, `pinnedOf`, `badgesOf` and `profilePath`, which leave out whatever isn't well-formed (unknown ids, odd shapes, paths outside their profile folder). Each screen sits in an error boundary (`Boundary` in `src/ui/kit.tsx`), so a failure there never takes down the nav or the player.
- `src/lib/sync.ts`: `startSync()`, `requestSync()`, `syncNow()`, `linkDevice()`, `useSyncOwner`. Members only. Library, playlists, profile and pins go up, debounced by 2 s. Plays go up, debounced by 30 s, while sharing is on. Everything is pulled on sign-in, at start and when the app becomes visible. Per-user state is kept in localStorage `luma-sync:<uid>`. The rules that keep it from losing data:
  - It waits for the library to load from IndexedDB, and `library.ts` never writes the record before it has loaded once.
  - Edits are stamped as they happen (offline and signed out too), and deletions only that way. Something missing on a device that wasn't deleted there (a library that loaded empty, cleared storage) is fetched again, never deleted everywhere.
  - A device's library belongs to one account (localStorage `luma-sync-owner`): the first member to sync there. Another account signed in on that device doesn't sync it until it chooses Sync Library (`linkDevice()`), which merges the device's library into that account.
  - On a device's first sync with an account, what the server already has wins: a non-blank profile, and anything changed or deleted there since the device added it.
  - A profile update the server skips (it holds a newer edit) changes nothing here and deletes no file; the newer row comes down instead. Files are deleted only once the row no longer points at them, and a missing file is skipped, not fatal.
- `src/types.ts`: `ProfileRow`, `PinnedSong`, `RedeemResult`, and the id lists `FRAME_IDS`, `EFFECT_IDS`, `NAME_STYLE_IDS`, `BADGE_IDS`.
- Route `/u/:handle` (`src/views/User.tsx`): a read-only `ProfileCard` with `remote={{ pinned, badges }}`.

## For the social screens

- **Feed:** `plays` (RLS does the filtering), plus `videos` and `posts` from the people in `follows where follower_id = me`.
- **Following:** insert or delete in `follows`. Public lists come from `select … from follows where followee_id = X`.
- **Uploads:** upload to `media/<uid>/videos/<uuid>.mp4` (and a still), then insert into `videos` with those paths. The policy rejects paths outside the caller's folder.
- **Posts:** upload up to 4 images to `media/<uid>/posts/`, then insert the post.
- **Search:** `rpc('luma_search', { q })`, then link each result: `/u/<handle>`, or its video or post.
- **Moderation UI:** shown when `useAccount().row.admin`. Read `reports where resolved_at is null`, then call `admin_remove` / `admin_ban` and remove the files from storage.
- **Never** stream song audio from the server, and never upload it. A song in a video or post is metadata. Playback stays local, or goes through Search to download.
- Migrations after `0001`: add `supabase/migrations/0002_….sql`, keep it idempotent, and add tests to `test/db/`. A new limit on an existing column goes the way of the Limits section: bring old rows within it, then drop and add the named constraint. `test/db/upgrade.test.ts` runs the script over a database made by its previous release (`test/db/fixtures/0001_luma.previous.sql`) holding rows today's rules refuse.

## What only the live project can confirm

The PGlite tests stub `auth.users`, `auth.uid()`, the roles and a minimal `storage` schema. Not tested locally:
- delivery of real email codes;
- real uploads through the Storage API (MIME and size checks happen there);
- the SQL on Supabase's actual Postgres, including how its storage schema and its grants on it differ from the stub;
- that PostgREST sets the `role` setting `is_operator()` relies on;
- that the RPCs run as `postgres` (they're created in the SQL Editor), which the triggers rely on to let their writes through.
