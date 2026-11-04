# Luma's server: the contract

The Supabase layer, for code built on it (the social screens: friends feed, videos, posts, Luma search, moderation). The source of truth is `supabase/migrations/`: `0001_luma.sql`, then `0002_social.sql` (the media quota, `admin_dismiss`, `admin_purge` and a song on posts). The tests in `test/db/` prove every rule below against them, run in order. Setup steps for the owner are in `supabase/README.md`.

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
| `luma.media_quota()` | (returns) the bytes each member may keep in the bucket: 200 MB. Called only by `public.media_left()`. |

Policies use these. New tables should too. But a function that a policy added after `0001` calls must live in `public` (see Migrations). The checks use these immutable ones:

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

Feed query (`loadFeed` in `social.ts`): `plays` where `user_id` is in your follows (in chunks of 100) and `played_at` is within the last 7 days, newest first, 200 per chunk. RLS also narrows it to people you follow who share, but the filters keep `sees_activity` from running on every play. A profile's Listening To reads that one user's last 14 days, 100 at most.

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

`id`, `user_id`, `body` (≤ 1000), `image_paths text[]` (≤ 4, each `<user_id>/posts/<file>`, no nulls), the song it carries as metadata only (`youtube_id`: 11 characters or null; `track_title`, `track_artist`: ≤ 300 each; added by `0002`), `created_at`, `removed_at`, `search` (body, track title, track artist). A post needs a body or at least one image: a song alone is not a post. The policies match `videos`; updates touch `body` only. At most 100 a day per member.

### `reports`

`id`, `reporter_id`, `kind` (`profile`/`video`/`post`), `target_id`, `reason` (≤ 500), `created_at`, `resolved_at`. Unique per reporter and target.
- **insert:** members, at most 50 open (unresolved) at a time. **select:** your own reports; admins see all.
- `admin_remove`, `admin_ban`, `admin_purge` and `admin_dismiss` resolve matching open reports.

## RPCs

All are `security definer` with `search_path = ''`. Execute is revoked from `public` and `anon`, then granted as listed.

| Call | Who | Does |
|---|---|---|
| `redeem_invite(code text) → text` | authenticated | Makes the caller a member, creating their profile row. Returns `ok`, `member` (already), `invalid` (unknown, used or expired), `rate_limited` (5 failed tries an hour) or `banned` (this account, or its email, is banned). Single use, ever, atomic. Case and spaces don't matter. |
| `create_invites(n int = 1, days int = 30) → (code, expires_at)` | operators | `n` from 1 to 100. `days = null` makes codes that never expire. |
| `luma_search(q text) → (kind, id, user_id, handle, title, rank)` | anon, authenticated | Full-text search over visible profiles, unremoved videos and posts. Each word is a prefix (`synth` finds "synthwave"). At most 8 words, 50 rows, best first. `title` is the name, caption or start of the post. Blank queries return nothing. |
| `admin_remove(kind text, id uuid)` | operators | `video`/`post`: sets `removed_at`. `profile`: clears name, bio, pins and media, and bumps `updated_at` past any device's edit. Resolves reports. |
| `admin_ban(target uuid, ban bool = true)` | operators | Sets `banned`, creating a row for non-members so they can't redeem later, and remembers the email (unbanning forgets it). Admins can't be banned. Resolves profile reports. |
| `admin_purge(target uuid)` | operators | After a ban (else `22023`): sets `removed_at` on all their videos and posts, clears the profile (`admin_remove('profile', …)`), and resolves every open report on the profile and on their content. Idempotent. The app's Ban is `admin_ban`, then `admin_purge`, then deleting their three folders; a ban is permanent (unban only in the SQL Editor, and the media stays gone). |
| `admin_dismiss(kind text, id uuid)` | operators | Resolves that target's open reports and leaves the content alone. `22023` for an unknown kind. |
| `media_left() → bigint` | authenticated | What the caller may still upload: `null` for admins (no limit), `0` for non-members, else the quota minus the sizes of their files (`0` once they keep 2,000 files). |
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
- Use a new file name per version, never overwrite in place. The CDN caches profile files for a year (`cacheControl: '31536000'`), and social files (`videos/`, `posts/`) for a day (`cache-control: max-age=86400`), so a removed one stops being served soon.
- Size and type limits per kind (avatar, canvas, background, post image, video) live in the client (`media.ts` `LIMITS`: videos at most 60 s and 50 MB). The bucket enforces the global 50 MB cap, and `0002` a quota per member. Videos go up without their metadata (`withoutMetadata`: the place they were filmed and the camera), as post images are re-encoded without EXIF.

### The quota (`0002`)

- Each member may keep **200 MB and 2,000 files** (`luma.media_quota()`; admins have no limit). The free plan holds 1 GB in all.
- Two **restrictive** policies on `storage.objects`, `media: within quota` (insert) and `media: within quota when replacing` (update), refuse a write into `media` while `public.media_left()` is `0`. They sit on top of 0001's permissive policies, so a refused upload fails as row-level security (Storage answers 400 or 403).
- It counts the sizes Storage records (`metadata.size`) of the files already there; a malformed size counts 0. It is soft: one upload can overshoot by up to 50 MB.
- The policies call a `public` function on purpose: every run of `0001` revokes execute on everything in `luma` from the API roles, which would make a policy that calls a `luma` function refuse every upload (profile sync included) until `0002` ran again.
- The client checks `media_left()` before posting and keeps a **20 MB reserve** (`RESERVE` in `posting.ts`), so a member who fills up with posts can still sync their profile.
- Files without a row (an upload whose post never made it) still count. Each member's app sweeps its own: files in `videos/` and `posts/` that no row of theirs references and that are over a day old (longer than any upload, and safe from a device clock that runs ahead), at most once a day (`sweepOrphans`).

## Client modules

- `src/lib/supabase.ts`: the project URL and publishable key, `supabase()` (lazy-loaded client), `mediaUrl()`, `BUCKET`. The session lives in localStorage under `luma-auth`.
- `src/lib/account.ts`: `useAccount` (`user`, `row`). Also `startAccount`, `resumeAccount`, `signIn(email)` (sends a 6-digit code), `verify(email, code)`, `signOut`, `redeemInvite`, `claimHandle`, `setShareActivity`, `refreshRow`, `ensureRow` (the row again when it failed to load: a profile page waits for it once), `fetchPublicProfile(handle)`, `profileFromRow`, `pinnedOf`, `badgesOf`, `profilePath`, `profileLink(handle)` and `isMember()`. `signOut` forgets the saved session on the device first, so it holds offline too (supabase-js alone keeps a session whose access token expired when it can't refresh it).
- Someone's row is anyone's JSON: read it through `profileFromRow`, `pinnedOf`, `badgesOf` and `profilePath`, which leave out whatever isn't well-formed (unknown ids, odd shapes, paths outside their profile folder). Each screen sits in an error boundary (`Boundary` in `src/ui/kit.tsx`), so a failure there never takes down the nav or the player.
- `src/lib/sync.ts`: `startSync()`, `requestSync()`, `syncNow()`, `linkDevice()`, `useSyncOwner`. Members only. Library, playlists, profile and pins go up, debounced by 2 s. Plays go up, debounced by 30 s, while sharing is on. Everything is pulled on sign-in, at start and when the app becomes visible. Per-user state is kept in localStorage `luma-sync:<uid>`. The rules that keep it from losing data:
  - It waits for the library to load from IndexedDB, and `library.ts` never writes the record before it has loaded once.
  - Edits are stamped as they happen (offline and signed out too), and deletions only that way. Something missing on a device that wasn't deleted there (a library that loaded empty, cleared storage) is fetched again, never deleted everywhere.
  - A device's library belongs to one account (localStorage `luma-sync-owner`): the first member to sync there. Another account signed in on that device doesn't sync it until it chooses Sync Library (`linkDevice()`), which merges the device's library into that account.
  - On a device's first sync with an account, what the server already has wins: a non-blank profile, and anything changed or deleted there since the device added it.
  - A profile update the server skips (it holds a newer edit) changes nothing here and deletes no file; the newer row comes down instead. Files are deleted only once the row no longer points at them, and a missing file is skipped, not fatal.
- `src/types.ts`: `ProfileRow`, `VideoRow`, `PostRow`, `PlayRow`, `FollowRow`, `ReportRow`, `LumaSearchRow`, `ReportReason`, `PinnedSong`, `RedeemResult`, and the id lists `FRAME_IDS`, `EFFECT_IDS`, `NAME_STYLE_IDS`, `BADGE_IDS`, `REPORT_REASONS`.
- `src/lib/social.ts`: the `useSocial` store (`following`, `hidden`, `people`, `feed`, `lists`), the gates `useOnline`, `useSignedIn`, `useMe`, the column lists `PERSON`, `VIDEO`, `POST`, `PLAY`, the row readers `personOf` and `postOf` (only paths in the owner's own folder, via `ownPath` in `account.ts`), and `loadMine`, `follow`, `unfollow` (one at a time per person), `loadPeople`, `loadFeed` (Home tries a failed one again on its next visit), `loadPosts`, `loadListening`, `loadFollows`, `lumaSearch`, `report`. Nothing is persisted; every loader resolves null on an error; a change of account resets it all. Calls that need a session check for one before loading supabase-js.
- `src/lib/posting.ts`: `prepareMedia`, `publish` (files, then the row; failures remove what went up, unless the insert's answer was lost and the row may be in), `deletePost`, `sweepOrphans`, the uploader seam (`Uploader`, `setUploader`, `xhrUpload`), `PostError` and `postErrorLabel`, `RESERVE`.
- `src/lib/moderation.ts` (admins): `hasOpenReports`, `loadReports` (grouped by target), `removeContent`, `removeProfile`, `ban`, `dismiss`, `createInvite`, `removeFolder`. Files go before rows; every step can run again.
- `src/lib/viewer.ts`: `useViewer`, `openPost`, `closePost`, `pauseForSound` (unmuting a video pauses the music; closing the Viewer resumes it in the same tap), `playable` (the Viewer plays only a video with a picture, within the 60 s cap, whatever its row says: no song audio from the server).
- Route `/u/:handle` (`src/views/User.tsx`): a read-only `ProfileCard` with `remote={{ pinned, badges }}`.

## For the social screens

Build on the client modules above, not on raw queries: `social.ts` (feed, follows, people, posts, search, reports), `posting.ts` (publish, delete, sweep), `moderation.ts` (admins) and `viewer.ts`. The calls they make, in short:

- **Feed:** `plays`, `videos` and `posts` with `user_id` in your follows (chunks of 100); plays from the last 7 days, posts not removed.
- **Following:** insert (`follower_id` = you; it has no default) or delete in `follows`; `23505` means already following. Public lists come from `follows` ordered by `created_at`.
- **Posting:** check `media_left()`, upload to `media/<uid>/videos/<id>.<ext>` and `<id>-still.jpg`, or `media/<uid>/posts/<id>-<n>.jpg`, then insert the row. `54000` is the daily limit.
- **Search:** `rpc('luma_search', { q })`, then the rows themselves, `is('removed_at', null)`.
- **Moderation:** shown when `useMe().admin`. Remove deletes the files, then calls `admin_remove`. Ban is `admin_ban`, `admin_purge`, then the three folders; it stays on offer for someone already banned (not an admin), so a ban that stopped part-way runs again, and Reports keeps the open reports of someone banned before it loaded. Dismiss is `admin_dismiss`.
- **Never** stream song audio from the server, and never upload it. A song in a video or post is metadata. Playback stays local, or goes through Search to download.

## Migrations

- The owner runs **every migration, in order** (`0001`, then `0002`, …), and runs the later ones again after any re-run of an earlier one. `test/db/harness.ts` runs them that way (`MIGRATIONS`, `MIGRATION` all of them joined, `FIRST` 0001 alone).
- Each is idempotent: a second run, or a run over a database made by an earlier release, gives a fresh install (`test/db/upgrade.test.ts`, which also re-runs `0001` alone and then the rest).
- **The re-run hazard.** A run of `0001` revokes execute on every function in `luma`, revokes all table grants and gives back only its own, and drops and re-creates its own named policies. So in a later migration:
  - anything a policy calls must live in `public`, never `luma`, or a lone run of `0001` breaks it (a quota policy calling `luma.*` would refuse every upload);
  - new policies get their own names (0001 never drops them);
  - a new column grant is revoked by a lone run of `0001` until the later migration runs again (`0002`'s song columns on `posts`): hence "run every migration after it".
- Add `supabase/migrations/000N_….sql` with tests in `test/db/`, and change this document with it. A new limit on an existing column goes the way of the Limits section: bring old rows within it, then drop and add the named constraint. `test/db/upgrade.test.ts` runs the scripts over a database made by the previous release of `0001` (`test/db/fixtures/0001_luma.previous.sql`) holding rows today's rules refuse.

## What only the live project can confirm

The PGlite tests stub `auth.users`, `auth.uid()`, the roles and a minimal `storage` schema. Not tested locally:
- delivery of real email codes;
- real uploads through the Storage API (MIME and size checks happen there);
- the SQL on Supabase's actual Postgres, including how its storage schema and its grants on it differ from the stub;
- that Storage records `metadata.size` for finished uploads, and that `public.media_left()` (a security definer owned by `postgres`) reads `storage.objects` past its RLS, which the quota relies on. Check once: upload past the quota as a member, expect a 400 or 403, and see `select media_left()` fall;
- that PostgREST sets the `role` setting `is_operator()` relies on;
- that the RPCs run as `postgres` (they're created in the SQL Editor), which the triggers rely on to let their writes through.
