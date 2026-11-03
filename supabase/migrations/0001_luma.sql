-- Luma on Supabase: tables, row level security, RPCs and the media bucket.
-- Paste the whole file into Supabase → SQL Editor → New query, and Run. It is idempotent: running it again
-- updates functions, policies and the bucket, and leaves data alone (except values outside the current Limits, which
-- only a crafted request could have written: those are cleared, or their rows deleted).
--
-- Rules, in short (docs/server.md has the full contract):
--   · Everyone (even signed out) reads public profiles, videos and posts of members who aren't banned.
--   · Anyone may sign in, but only members write; you become a member by redeeming an invite code.
--   · Banned users can't write, and their public content is hidden.
--   · Library rows are private to their owner. Plays are visible to followers only while the player shares activity.
--   · Song audio is never stored here: library sync is metadata only.
--   · The publishable key is public: every value members write is bounded, and each member has quotas (Limits).

create schema if not exists luma; -- private helpers, not exposed through the Data API

-- ── Tables ──────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  member boolean not null default false,
  admin boolean not null default false,
  banned boolean not null default false,
  name text not null default '' check (char_length(name) <= 40),
  bio text check (char_length(bio) <= 190),
  colors text[] check (colors is null or (cardinality(colors) = 2 and colors[1] ~ '^#[0-9a-f]{6}$' and colors[2] ~ '^#[0-9a-f]{6}$')),
  auto_colors text[] check (auto_colors is null or (cardinality(auto_colors) = 2 and auto_colors[1] ~ '^#[0-9a-f]{6}$' and auto_colors[2] ~ '^#[0-9a-f]{6}$')),
  -- frame, effect, name_style: ids from src/types.ts (checked in Limits, below, like every column marked "Limits")
  frame text,
  effect text,
  name_style text,
  -- [{ "id", "title", "artist", "source" }], newest first: public, so the profile page shows them without the library
  pinned_songs jsonb not null default '[]', -- Limits
  pinned_playlists text[] not null default '{}', -- Limits
  -- [{ "id", "tier" }], the earned badges
  badges jsonb not null default '[]', -- Limits
  -- Media: paths in the media bucket (always '<id>/profile/<file>', Limits), the kind, and the device's blob version
  avatar_path text,
  avatar_still_path text,
  avatar_kind text check (avatar_kind in ('image', 'animated')),
  avatar_version bigint,
  banner_path text,
  banner_still_path text,
  banner_kind text check (banner_kind in ('image', 'animated')),
  banner_version bigint,
  backdrop_path text,
  backdrop_still_path text,
  backdrop_kind text check (backdrop_kind in ('image', 'animated', 'video')),
  backdrop_version bigint,
  -- { "avatar": { "x", "y", "zoom" }, "banner": …, "backdrop": … }: each image's visible position and zoom
  crops jsonb not null default '{}' check (jsonb_typeof(crops) = 'object' and pg_column_size(crops) <= 1024),
  share_activity boolean not null default false,
  sharing_since timestamptz, -- the server's time when share_activity last turned on (a trigger sets it)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), -- the device's edit time, capped at the server's: last write wins
  search tsvector generated always as (
    to_tsvector('simple', coalesce(handle, '') || ' ' || coalesce(name, '') || ' ' || coalesce(bio, ''))
  ) stored
);
-- Added after the first release of this script: keep re-runs on older databases working.
alter table public.profiles add column if not exists crops jsonb not null default '{}'
  check (jsonb_typeof(crops) = 'object' and pg_column_size(crops) <= 1024);
alter table public.profiles add column if not exists sharing_since timestamptz;
create unique index if not exists profiles_handle_ci on public.profiles (lower(handle));
create index if not exists profiles_search on public.profiles using gin (search);

create table if not exists public.invites (
  code text primary key check (code ~ '^[A-Z0-9]{6,32}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_by uuid unique references auth.users (id) on delete set null,
  used_at timestamptz -- set once: a code stays used even after its account is deleted (used_by goes null)
);

-- Failed redeem attempts, for the rate limit. Private.
create table if not exists luma.invite_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists invite_attempts_user on luma.invite_attempts (user_id, at);

-- Emails of banned accounts. Private. Deleting the account and signing up again with the email doesn't lift a ban.
create table if not exists luma.banned_emails (
  email text primary key, -- lower case
  banned_at timestamptz not null default now()
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists follows_followee on public.follows (followee_id);

create table if not exists public.plays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  track_id text not null check (char_length(track_id) <= 64),
  youtube_id text check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check (char_length(title) <= 300),
  artist text not null default '' check (char_length(artist) <= 300),
  played_at timestamptz not null,
  listened_ms integer not null default 0 check (listened_ms >= 0),
  unique (user_id, track_id, played_at)
);
create index if not exists plays_user_time on public.plays (user_id, played_at desc);

create table if not exists public.library_tracks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) <= 64),
  title text not null default '' check (char_length(title) <= 300),
  artist text not null default '' check (char_length(artist) <= 300),
  duration real not null default 0,
  source text not null default 'youtube' check (source in ('youtube', 'file')),
  added_at timestamptz not null default now(),
  deleted boolean not null default false,
  updated_at timestamptz not null, -- the device's edit time, capped at the server's: last write wins
  synced_at timestamptz not null default now(), -- set by the server on every write; pull with it
  primary key (user_id, id)
);
create index if not exists library_tracks_synced on public.library_tracks (user_id, synced_at);

create table if not exists public.library_playlists (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) <= 64),
  name text not null default '' check (char_length(name) <= 200),
  track_ids text[] not null default '{}', -- Limits
  created_at timestamptz not null default now(),
  deleted boolean not null default false,
  updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists library_playlists_synced on public.library_playlists (user_id, synced_at);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  path text not null, -- '<user_id>/videos/<file>' (Limits)
  still_path text, -- the same
  caption text not null default '' check (char_length(caption) <= 300),
  -- the song it is set to, if any (metadata only, never audio)
  youtube_id text check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  track_title text check (char_length(track_title) <= 300),
  track_artist text check (char_length(track_artist) <= 300),
  duration real not null default 0,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(caption, '') || ' ' || coalesce(track_title, '') || ' ' || coalesce(track_artist, ''))
  ) stored
);
create index if not exists videos_user_time on public.videos (user_id, created_at desc);
create index if not exists videos_search on public.videos using gin (search);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 1000),
  image_paths text[] not null default '{}', -- up to 4 '<user_id>/posts/<file>' (Limits)
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  search tsvector generated always as (to_tsvector('simple', coalesce(body, ''))) stored,
  check (char_length(body) > 0 or cardinality(image_paths) > 0)
);
create index if not exists posts_user_time on public.posts (user_id, created_at desc);
create index if not exists posts_search on public.posts using gin (search);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('profile', 'video', 'post')),
  target_id uuid not null,
  reason text not null default '' check (char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (reporter_id, kind, target_id)
);
create index if not exists reports_open on public.reports (created_at) where resolved_at is null;

-- ── Helpers (used by policies; security definer so they can read profiles past its own RLS) ─────────

create or replace function luma.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.member and not p.banned)
$$;

create or replace function luma.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.admin and p.member and not p.banned)
$$;

/** An admin, or the project owner in the SQL Editor (not an API request: those always run as anon or authenticated). */
create or replace function luma.is_operator() returns boolean
language sql stable security definer set search_path = '' as $$
  select luma.is_admin() or coalesce(nullif(current_setting('role', true), ''), 'none') not in ('anon', 'authenticated')
$$;

/** A member who isn't banned: their public content shows. */
create or replace function luma.is_visible(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = target and p.member and not p.banned)
$$;

/** The caller may see this user's plays: their own, or a member following a visible player who shares activity. */
create or replace function luma.sees_activity(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select target = auth.uid() or (
    luma.is_member()
    and exists (select 1 from public.profiles p where p.id = target and p.member and not p.banned and p.share_activity)
    and exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = target)
  )
$$;

-- ── Value checks (immutable, so CHECK constraints in Limits can use them) ──────────────────────────────

/** The ids the client knows (src/types.ts): frames, effects, name styles and badges. Keep in step with it. */
create or replace function luma.ids(kind text) returns text[]
language sql immutable set search_path = '' as $$
  select case kind
    when 'frame' then array['halo', 'aurora', 'vinyl', 'orbit', 'equalizer', 'laurel', 'blossoms', 'sparkles']
    when 'effect' then array['petals', 'snow', 'sparkles', 'stars', 'notes', 'fireflies']
    when 'name_style' then array['shimmer', 'aurora', 'chrome', 'neon', 'glitch', 'wave', 'pop', 'sparkle', 'outline', 'pixel', 'script']
    when 'badge' then array['first-spin', 'hours', 'streak', 'on-repeat', 'night-owl', 'early-bird', 'marathon', 'explorer',
      'crate-digger', 'curator', 'founder']
  end
$$;

/** A media path: '<owner>/<sub>/<file>', one level deep, no '..', at most 200 characters. Null is fine (none). */
create or replace function luma.path_ok(p text, owner uuid, sub text) returns boolean
language sql immutable set search_path = '' as $$
  select p is null or (
    char_length(p) <= 200
    and char_length(p) > char_length(owner::text) + char_length(sub) + 2
    and starts_with(p, owner::text || '/' || sub || '/')
    and strpos(substr(p, char_length(owner::text) + char_length(sub) + 3), '/') = 0
    and p not like '%..%'
  )
$$;

/** Every path is a media path (no nulls). */
create or replace function luma.paths_ok(paths text[], owner uuid, sub text) returns boolean
language sql immutable set search_path = '' as $$
  select array_position(paths, null) is null and coalesce((select bool_and(luma.path_ok(p, owner, sub)) from unnest(paths) p), true)
$$;

/** At most `n` texts of at most `len` characters each, no nulls. */
create or replace function luma.texts_ok(texts text[], n integer, len integer) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(texts) <= n and array_position(texts, null) is null
    and coalesce((select max(char_length(t)) from unnest(texts) t), 0) <= len
$$;

/** Pinned songs as the public page shows them: up to 5 { id, title, artist, source } with nothing else. */
create or replace function luma.pins_ok(pins jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  s jsonb;
begin
  if jsonb_typeof(pins) is distinct from 'array' or jsonb_array_length(pins) > 5 or pg_column_size(pins) > 8192 then
    return false;
  end if;
  for s in select value from jsonb_array_elements(pins) loop
    if jsonb_typeof(s) <> 'object' then
      return false;
    end if;
    if s - array['id', 'title', 'artist', 'source'] <> '{}'::jsonb
      or jsonb_typeof(s -> 'id') is distinct from 'string' or jsonb_typeof(s -> 'title') is distinct from 'string'
      or jsonb_typeof(s -> 'artist') is distinct from 'string' or jsonb_typeof(s -> 'source') is distinct from 'string' then
      return false;
    end if;
    if char_length(s ->> 'id') not between 1 and 64 or char_length(s ->> 'title') > 300 or char_length(s ->> 'artist') > 300
      or (s ->> 'source') not in ('youtube', 'file') then
      return false;
    end if;
  end loop;
  return true;
end $$;

/** Earned badges: [{ id, tier }], each a known badge id and a tier from 1 to 4, with nothing else. */
create or replace function luma.badges_ok(badges jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  b jsonb;
begin
  if jsonb_typeof(badges) is distinct from 'array' or jsonb_array_length(badges) > 20 or pg_column_size(badges) > 2048 then
    return false;
  end if;
  for b in select value from jsonb_array_elements(badges) loop
    if jsonb_typeof(b) <> 'object' then
      return false;
    end if;
    if b - array['id', 'tier'] <> '{}'::jsonb or jsonb_typeof(b -> 'id') is distinct from 'string'
      or jsonb_typeof(b -> 'tier') is distinct from 'number' then
      return false;
    end if;
    if not ((b ->> 'id') = any (luma.ids('badge'))) or (b ->> 'tier') not in ('1', '2', '3', '4') then
      return false;
    end if;
  end loop;
  return true;
end $$;

/** Every path is in the caller's own folder, under `sub` ('posts', 'videos'). */
create or replace function luma.own_paths(paths text[], sub text) returns boolean
language sql stable set search_path = '' as $$
  select luma.paths_ok(paths, auth.uid(), sub)
$$;

-- ── Triggers ────────────────────────────────────────────────────────────
-- A device's writes come through the API, as anon or authenticated. The RPCs (security definer, so they run as the
-- functions' owner) and the SQL Editor don't: their writes are never skipped or limited by these triggers.

-- Last write wins: an older edit (by the device's clock) never overwrites a newer one. The device's clock is capped
-- at the server's, so a clock that runs ahead (or a crafted request) can't put an edit in the future and freeze the row.
create or replace function luma.last_write_wins() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  new.updated_at := least(new.updated_at, now());
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end $$;

-- Library rows also get the server's time, which pulls follow.
create or replace function luma.stamp_synced() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.updated_at := least(new.updated_at, now());
    if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
      return null;
    end if;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

-- When sharing turns on, note the server's time: plays from before it never go up (luma.shared_plays_only).
create or replace function luma.note_sharing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.share_activity and (tg_op = 'INSERT' or not old.share_activity) then
    new.sharing_since := now();
  end if;
  return new;
end $$;

-- Plays land only while their player shares activity, and only plays started since it was turned on. A device that
-- missed the switch (its copy of the profile is old) can't publish what was played meanwhile. Others are skipped
-- without an error, so the rest of the batch still lands.
create or replace function luma.shared_plays_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') and not exists (
    select 1 from public.profiles p where p.id = new.user_id and p.share_activity and new.played_at >= p.sharing_since
  ) then
    return null;
  end if;
  return new;
end $$;

-- Per-user limits, so one member can't fill the database (the free plan has 500 MB). Checked once per statement.
-- Plays keep only each player's newest 5,000.
create or replace function luma.limit_rows() returns trigger
language plpgsql set search_path = '' as $$
declare
  me uuid := auth.uid();
  over boolean := false;
begin
  if current_user not in ('anon', 'authenticated') or me is null then
    return null;
  end if;
  if tg_table_name = 'library_tracks' then
    over := (select count(*) > 20000 from public.library_tracks t where t.user_id = me);
  elsif tg_table_name = 'library_playlists' then
    over := (select count(*) > 2000 or coalesce(sum(cardinality(l.track_ids)), 0) > 100000 from public.library_playlists l where l.user_id = me);
  elsif tg_table_name = 'posts' then
    over := (select count(*) > 100 from public.posts t where t.user_id = me and t.created_at > now() - interval '1 day');
  elsif tg_table_name = 'videos' then
    over := (select count(*) > 25 from public.videos v where v.user_id = me and v.created_at > now() - interval '1 day');
  elsif tg_table_name = 'reports' then
    over := (select count(*) > 50 from public.reports r where r.reporter_id = me and r.resolved_at is null);
  elsif tg_table_name = 'plays' then
    delete from public.plays p
      where p.id in (select q.id from public.plays q where q.user_id = me order by q.played_at desc offset 5000);
  end if;
  if over then
    raise exception '% limit reached', tg_table_name using errcode = '54000';
  end if;
  return null;
end $$;

drop trigger if exists profiles_lww on public.profiles;
create trigger profiles_lww before update on public.profiles for each row execute function luma.last_write_wins();
drop trigger if exists profiles_sharing on public.profiles;
create trigger profiles_sharing before insert or update of share_activity on public.profiles
  for each row execute function luma.note_sharing();
drop trigger if exists library_tracks_lww on public.library_tracks;
create trigger library_tracks_lww before insert or update on public.library_tracks for each row execute function luma.stamp_synced();
drop trigger if exists library_playlists_lww on public.library_playlists;
create trigger library_playlists_lww before insert or update on public.library_playlists for each row execute function luma.stamp_synced();
drop trigger if exists plays_shared on public.plays;
create trigger plays_shared before insert or update on public.plays for each row execute function luma.shared_plays_only();

drop trigger if exists library_tracks_limit on public.library_tracks;
create trigger library_tracks_limit after insert on public.library_tracks for each statement execute function luma.limit_rows();
drop trigger if exists library_playlists_limit on public.library_playlists;
create trigger library_playlists_limit after insert or update on public.library_playlists for each statement execute function luma.limit_rows();
drop trigger if exists posts_limit on public.posts;
create trigger posts_limit after insert on public.posts for each statement execute function luma.limit_rows();
drop trigger if exists videos_limit on public.videos;
create trigger videos_limit after insert on public.videos for each statement execute function luma.limit_rows();
drop trigger if exists reports_limit on public.reports;
create trigger reports_limit after insert on public.reports for each statement execute function luma.limit_rows();
drop trigger if exists plays_limit on public.plays;
create trigger plays_limit after insert on public.plays for each statement execute function luma.limit_rows();

-- ── Limits ──────────────────────────────────────────────────────────────
-- The publishable key is public: anyone with an account can send any value. Every value members write is bounded,
-- either inline above or here. These are dropped and added again on every run, so a database made by an earlier
-- version of this script gets the current rules. Rows from before them are brought within them first.

update public.profiles p set
  frame = case when p.frame = any (luma.ids('frame')) then p.frame end,
  effect = case when p.effect = any (luma.ids('effect')) then p.effect end,
  name_style = case when p.name_style = any (luma.ids('name_style')) then p.name_style end,
  pinned_songs = case when luma.pins_ok(p.pinned_songs) then p.pinned_songs else '[]' end,
  pinned_playlists = case when luma.texts_ok(p.pinned_playlists, 6, 64) then p.pinned_playlists else '{}' end,
  badges = case when luma.badges_ok(p.badges) then p.badges else '[]' end,
  avatar_path = case when luma.path_ok(p.avatar_path, p.id, 'profile') then p.avatar_path end,
  avatar_still_path = case when luma.path_ok(p.avatar_still_path, p.id, 'profile') then p.avatar_still_path end,
  banner_path = case when luma.path_ok(p.banner_path, p.id, 'profile') then p.banner_path end,
  banner_still_path = case when luma.path_ok(p.banner_still_path, p.id, 'profile') then p.banner_still_path end,
  backdrop_path = case when luma.path_ok(p.backdrop_path, p.id, 'profile') then p.backdrop_path end,
  backdrop_still_path = case when luma.path_ok(p.backdrop_still_path, p.id, 'profile') then p.backdrop_still_path end,
  sharing_since = coalesce(p.sharing_since, case when p.share_activity then now() end),
  updated_at = case when p.updated_at between '1970-01-01 00:00+00' and now() then p.updated_at else now() end;
update public.library_tracks t set updated_at = now() where not t.updated_at between '1970-01-01 00:00+00' and now();
update public.library_playlists l set
  track_ids = case when luma.texts_ok(l.track_ids, 5000, 64) then l.track_ids else '{}' end,
  updated_at = case when l.updated_at between '1970-01-01 00:00+00' and now() then l.updated_at else now() end
  where not (luma.texts_ok(l.track_ids, 5000, 64) and l.updated_at between '1970-01-01 00:00+00' and now());
delete from public.posts t where not (cardinality(t.image_paths) <= 4 and luma.paths_ok(t.image_paths, t.user_id, 'posts'));
delete from public.videos v where not luma.path_ok(v.path, v.user_id, 'videos');
update public.videos v set still_path = null where not luma.path_ok(v.still_path, v.user_id, 'videos');

alter table public.profiles
  -- the first release's checks on these columns
  drop constraint if exists profiles_frame_check, drop constraint if exists profiles_effect_check,
  drop constraint if exists profiles_name_style_check, drop constraint if exists profiles_pinned_songs_check,
  drop constraint if exists profiles_pinned_playlists_check, drop constraint if exists profiles_badges_check,
  drop constraint if exists profiles_check, drop constraint if exists profiles_check1, drop constraint if exists profiles_check2,
  drop constraint if exists profiles_check3, drop constraint if exists profiles_check4, drop constraint if exists profiles_check5,
  drop constraint if exists profiles_ids_ok, add constraint profiles_ids_ok check (
    frame = any (luma.ids('frame')) and effect = any (luma.ids('effect')) and name_style = any (luma.ids('name_style'))),
  drop constraint if exists profiles_pins_ok, add constraint profiles_pins_ok check (
    luma.pins_ok(pinned_songs) and luma.texts_ok(pinned_playlists, 6, 64)),
  drop constraint if exists profiles_badges_ok, add constraint profiles_badges_ok check (luma.badges_ok(badges)),
  drop constraint if exists profiles_paths_ok, add constraint profiles_paths_ok check (
    luma.path_ok(avatar_path, id, 'profile') and luma.path_ok(avatar_still_path, id, 'profile')
    and luma.path_ok(banner_path, id, 'profile') and luma.path_ok(banner_still_path, id, 'profile')
    and luma.path_ok(backdrop_path, id, 'profile') and luma.path_ok(backdrop_still_path, id, 'profile')),
  -- A sane clock, so nothing (the RPCs' "a millisecond later" included) can overflow the timestamp range.
  drop constraint if exists profiles_updated_at_ok, add constraint profiles_updated_at_ok check (
    updated_at >= '1970-01-01 00:00+00' and updated_at < '9999-01-01 00:00+00');
alter table public.library_tracks
  drop constraint if exists library_tracks_updated_at_ok, add constraint library_tracks_updated_at_ok check (
    updated_at >= '1970-01-01 00:00+00' and updated_at < '9999-01-01 00:00+00');
alter table public.library_playlists
  drop constraint if exists library_playlists_track_ids_check,
  drop constraint if exists library_playlists_track_ids_ok, add constraint library_playlists_track_ids_ok check (
    luma.texts_ok(track_ids, 5000, 64)),
  drop constraint if exists library_playlists_updated_at_ok, add constraint library_playlists_updated_at_ok check (
    updated_at >= '1970-01-01 00:00+00' and updated_at < '9999-01-01 00:00+00');
alter table public.posts
  drop constraint if exists posts_image_paths_check,
  drop constraint if exists posts_image_paths_ok, add constraint posts_image_paths_ok check (
    cardinality(image_paths) <= 4 and luma.paths_ok(image_paths, user_id, 'posts'));
alter table public.videos
  drop constraint if exists videos_check, drop constraint if exists videos_check1,
  drop constraint if exists videos_paths_ok, add constraint videos_paths_ok check (
    luma.path_ok(path, user_id, 'videos') and luma.path_ok(still_path, user_id, 'videos'));

-- ── Privileges: nothing by default, then exactly what the policies cover ─────────────────────────────

revoke all on public.profiles, public.invites, public.follows, public.plays, public.library_tracks,
  public.library_playlists, public.videos, public.posts, public.reports from anon, authenticated;
revoke all on all tables in schema luma from public, anon, authenticated;
revoke all on all functions in schema luma from public, anon, authenticated;
grant usage on schema luma to anon, authenticated;
grant execute on function luma.is_member(), luma.is_admin(), luma.is_visible(uuid), luma.sees_activity(uuid),
  luma.own_paths(text[], text), luma.ids(text), luma.path_ok(text, uuid, text), luma.paths_ok(text[], uuid, text),
  luma.texts_ok(text[], integer, integer), luma.pins_ok(jsonb), luma.badges_ok(jsonb) to anon, authenticated;

grant select on public.profiles to anon, authenticated;
-- Never id, handle checks aside, nor the member / admin / banned flags: those change only through the RPCs.
grant update (handle, name, bio, colors, auto_colors, frame, effect, name_style, pinned_songs, pinned_playlists, badges,
  avatar_path, avatar_still_path, avatar_kind, avatar_version, banner_path, banner_still_path, banner_kind, banner_version,
  backdrop_path, backdrop_still_path, backdrop_kind, backdrop_version, crops, share_activity, updated_at) on public.profiles to authenticated;
grant select on public.invites to authenticated;
grant select on public.follows to anon, authenticated;
grant insert (follower_id, followee_id), delete on public.follows to authenticated;
grant select, delete on public.plays to authenticated;
grant insert (user_id, track_id, youtube_id, title, artist, played_at, listened_ms),
  update (user_id, track_id, youtube_id, title, artist, played_at, listened_ms) on public.plays to authenticated;
grant select, insert, update, delete on public.library_tracks, public.library_playlists to authenticated;
grant select on public.videos, public.posts to anon, authenticated;
grant insert (user_id, path, still_path, caption, youtube_id, track_title, track_artist, duration), update (caption), delete
  on public.videos to authenticated;
grant insert (user_id, body, image_paths), update (body), delete on public.posts to authenticated;
grant select, insert (reporter_id, kind, target_id, reason) on public.reports to authenticated;

-- ── Row level security ──────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table luma.invite_attempts enable row level security;
alter table luma.banned_emails enable row level security;
alter table public.follows enable row level security;
alter table public.plays enable row level security;
alter table public.library_tracks enable row level security;
alter table public.library_playlists enable row level security;
alter table public.videos enable row level security;
alter table public.posts enable row level security;
alter table public.reports enable row level security;

-- profiles: public when they're a member with a handle and not banned; your own row always; admins see all.
-- No insert policy: rows are made by redeem_invite (members), admin_ban and make_admin.
drop policy if exists "profiles: read" on public.profiles;
create policy "profiles: read" on public.profiles for select to anon, authenticated
  using ((handle is not null and member and not banned) or id = (select auth.uid()) or (select luma.is_admin()));
drop policy if exists "profiles: members edit their own" on public.profiles;
create policy "profiles: members edit their own" on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select luma.is_member()))
  with check (id = (select auth.uid()) and (select luma.is_member()));

-- invites: admins read them; only RPCs write them.
drop policy if exists "invites: admins read" on public.invites;
create policy "invites: admins read" on public.invites for select to authenticated using ((select luma.is_admin()));

-- follows: public between visible members; members follow and unfollow for themselves.
drop policy if exists "follows: read" on public.follows;
create policy "follows: read" on public.follows for select to anon, authenticated
  using ((luma.is_visible(follower_id) and luma.is_visible(followee_id)) or follower_id = (select auth.uid()));
drop policy if exists "follows: members follow" on public.follows;
create policy "follows: members follow" on public.follows for insert to authenticated
  with check (follower_id = (select auth.uid()) and (select luma.is_member()) and luma.is_visible(followee_id));
drop policy if exists "follows: members unfollow" on public.follows;
create policy "follows: members unfollow" on public.follows for delete to authenticated
  using (follower_id = (select auth.uid()) and (select luma.is_member()));

-- plays: yours, or a followed player's while they share activity.
drop policy if exists "plays: read" on public.plays;
create policy "plays: read" on public.plays for select to authenticated using (luma.sees_activity(user_id));
drop policy if exists "plays: members log" on public.plays;
create policy "plays: members log" on public.plays for insert to authenticated
  with check (user_id = (select auth.uid()) and (select luma.is_member()));
drop policy if exists "plays: members update" on public.plays;
create policy "plays: members update" on public.plays for update to authenticated
  using (user_id = (select auth.uid()) and (select luma.is_member()))
  with check (user_id = (select auth.uid()) and (select luma.is_member()));
drop policy if exists "plays: members delete" on public.plays;
create policy "plays: members delete" on public.plays for delete to authenticated
  using (user_id = (select auth.uid()) and (select luma.is_member()));

-- library: the owner only. Reading stays open to a banned owner (it's their backup); writing needs membership.
drop policy if exists "library_tracks: owner reads" on public.library_tracks;
create policy "library_tracks: owner reads" on public.library_tracks for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "library_tracks: members write" on public.library_tracks;
create policy "library_tracks: members write" on public.library_tracks for insert to authenticated
  with check (user_id = (select auth.uid()) and (select luma.is_member()));
drop policy if exists "library_tracks: members update" on public.library_tracks;
create policy "library_tracks: members update" on public.library_tracks for update to authenticated
  using (user_id = (select auth.uid()) and (select luma.is_member()))
  with check (user_id = (select auth.uid()) and (select luma.is_member()));
drop policy if exists "library_tracks: members delete" on public.library_tracks;
create policy "library_tracks: members delete" on public.library_tracks for delete to authenticated
  using (user_id = (select auth.uid()) and (select luma.is_member()));

drop policy if exists "library_playlists: owner reads" on public.library_playlists;
create policy "library_playlists: owner reads" on public.library_playlists for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "library_playlists: members write" on public.library_playlists;
create policy "library_playlists: members write" on public.library_playlists for insert to authenticated
  with check (user_id = (select auth.uid()) and (select luma.is_member()));
drop policy if exists "library_playlists: members update" on public.library_playlists;
create policy "library_playlists: members update" on public.library_playlists for update to authenticated
  using (user_id = (select auth.uid()) and (select luma.is_member()))
  with check (user_id = (select auth.uid()) and (select luma.is_member()));
drop policy if exists "library_playlists: members delete" on public.library_playlists;
create policy "library_playlists: members delete" on public.library_playlists for delete to authenticated
  using (user_id = (select auth.uid()) and (select luma.is_member()));

-- videos and posts: public unless removed or the owner is banned; owners and admins still see them.
drop policy if exists "videos: read" on public.videos;
create policy "videos: read" on public.videos for select to anon, authenticated
  using ((removed_at is null and luma.is_visible(user_id)) or user_id = (select auth.uid()) or (select luma.is_admin()));
drop policy if exists "videos: members upload" on public.videos;
create policy "videos: members upload" on public.videos for insert to authenticated
  with check (user_id = (select auth.uid()) and (select luma.is_member())
    and luma.own_paths(array_remove(array[path, still_path], null), 'videos'));
drop policy if exists "videos: members edit" on public.videos;
create policy "videos: members edit" on public.videos for update to authenticated
  using (user_id = (select auth.uid()) and (select luma.is_member()) and removed_at is null)
  with check (user_id = (select auth.uid()) and (select luma.is_member()));
drop policy if exists "videos: members delete" on public.videos;
create policy "videos: members delete" on public.videos for delete to authenticated
  using (user_id = (select auth.uid()) and (select luma.is_member()));

drop policy if exists "posts: read" on public.posts;
create policy "posts: read" on public.posts for select to anon, authenticated
  using ((removed_at is null and luma.is_visible(user_id)) or user_id = (select auth.uid()) or (select luma.is_admin()));
drop policy if exists "posts: members post" on public.posts;
create policy "posts: members post" on public.posts for insert to authenticated
  with check (user_id = (select auth.uid()) and (select luma.is_member()) and luma.own_paths(image_paths, 'posts'));
drop policy if exists "posts: members edit" on public.posts;
create policy "posts: members edit" on public.posts for update to authenticated
  using (user_id = (select auth.uid()) and (select luma.is_member()) and removed_at is null)
  with check (user_id = (select auth.uid()) and (select luma.is_member()));
drop policy if exists "posts: members delete" on public.posts;
create policy "posts: members delete" on public.posts for delete to authenticated
  using (user_id = (select auth.uid()) and (select luma.is_member()));

-- reports: members file them; reporters see their own, admins see all. admin_remove resolves them.
drop policy if exists "reports: members report" on public.reports;
create policy "reports: members report" on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and (select luma.is_member()));
drop policy if exists "reports: read" on public.reports;
create policy "reports: read" on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()) or (select luma.is_admin()));

-- ── RPCs ────────────────────────────────────────────────────────────────

/** Become a member. Returns 'ok', 'member' (already), 'invalid' (unknown, used or expired), 'rate_limited' or 'banned'.
 * Five failed tries an hour per account. A code is used once, ever: deleting the account that used it doesn't free it. */
create or replace function public.redeem_invite(code text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  p public.profiles;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = me;
  if found and p.banned then return 'banned'; end if;
  if found and p.member then return 'member'; end if;
  if exists (select 1 from auth.users u join luma.banned_emails b on b.email = lower(u.email) where u.id = me) then
    return 'banned';
  end if;
  delete from luma.invite_attempts a where a.user_id = me and a.at <= now() - interval '1 hour';
  if (select count(*) from luma.invite_attempts a where a.user_id = me) >= 5 then
    return 'rate_limited';
  end if;
  update public.invites i set used_by = me, used_at = now()
    where i.code = upper(btrim(redeem_invite.code)) and i.used_at is null and i.used_by is null
      and (i.expires_at is null or i.expires_at > now());
  if not found then
    insert into luma.invite_attempts (user_id) values (me);
    return 'invalid';
  end if;
  insert into public.profiles (id, member) values (me, true)
    on conflict (id) do update set member = true;
  return 'ok';
end $$;

/** Admins: make `n` single-use codes (1–100) that expire after `days` (null: never). */
create or replace function public.create_invites(n integer default 1, days integer default 30)
returns table (code text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not luma.is_operator() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if n < 1 or n > 100 then
    raise exception 'n must be 1 to 100' using errcode = '22023';
  end if;
  return query
    insert into public.invites (code, created_by, expires_at)
    select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), auth.uid(),
      case when days is null then null else now() + make_interval(days => days) end
    from generate_series(1, n)
    returning invites.code, invites.expires_at;
end $$;

/** Full-text search over public profiles, videos and posts. Each word matches as a prefix. */
create or replace function public.luma_search(q text)
returns table (kind text, id uuid, user_id uuid, handle text, title text, rank real)
language plpgsql stable security definer set search_path = '' as $$
declare
  query tsquery;
begin
  select to_tsquery('simple', string_agg(w || ':*', ' & ')) into query
    from (select w from regexp_split_to_table(lower(coalesce(q, '')), '[^[:alnum:]]+') w where w <> '' limit 8) words;
  if query is null then return; end if;
  return query
    select * from (
      select 'profile'::text, p.id, p.id, p.handle, p.name, ts_rank(p.search, query)
        from public.profiles p
        where p.search @@ query and p.handle is not null and p.member and not p.banned
      union all
      select 'video', v.id, v.user_id, p.handle, v.caption, ts_rank(v.search, query)
        from public.videos v join public.profiles p on p.id = v.user_id
        where v.search @@ query and v.removed_at is null and p.member and not p.banned
      union all
      select 'post', t.id, t.user_id, p.handle, left(t.body, 200), ts_rank(t.search, query)
        from public.posts t join public.profiles p on p.id = t.user_id
        where t.search @@ query and t.removed_at is null and p.member and not p.banned
    ) found
    order by 6 desc
    limit 50;
end $$;

/** Admins: hide a video or post, or clear a profile's name, bio and media. Resolves its reports. */
create or replace function public.admin_remove(kind text, id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not luma.is_operator() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if kind = 'video' then
    update public.videos v set removed_at = now() where v.id = admin_remove.id;
  elsif kind = 'post' then
    update public.posts t set removed_at = now() where t.id = admin_remove.id;
  elsif kind = 'profile' then
    update public.profiles p set name = '', bio = null, pinned_songs = '[]',
      avatar_path = null, avatar_still_path = null, avatar_kind = null, avatar_version = null,
      banner_path = null, banner_still_path = null, banner_kind = null, banner_version = null,
      backdrop_path = null, backdrop_still_path = null, backdrop_kind = null, backdrop_version = null, crops = '{}',
      -- later than any device's edit, so devices take the cleared profile (this write itself always lands)
      updated_at = greatest(now(), least(p.updated_at, now()) + interval '1 millisecond')
    where p.id = admin_remove.id;
  else
    raise exception 'kind must be profile, video or post' using errcode = '22023';
  end if;
  update public.reports r set resolved_at = now() where r.kind = admin_remove.kind and r.target_id = admin_remove.id and r.resolved_at is null;
end $$;

/** Admins: ban (or with ban = false, unban) an account. Admins can't be banned. The email is remembered too, so
 * deleting the account and signing up again doesn't lift the ban. */
create or replace function public.admin_ban(target uuid, ban boolean default true) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not luma.is_operator() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.id = target and p.admin) then
    raise exception 'admins can''t be banned' using errcode = '42501';
  end if;
  insert into public.profiles as p (id, banned) values (target, ban)
    on conflict (id) do update set banned = ban;
  if ban then
    insert into luma.banned_emails (email)
      select lower(u.email) from auth.users u where u.id = target and u.email is not null
      on conflict (email) do nothing;
  else
    delete from luma.banned_emails b using auth.users u where u.id = target and b.email = lower(u.email);
  end if;
  update public.reports r set resolved_at = now() where ban and r.kind = 'profile' and r.target_id = target and r.resolved_at is null;
end $$;

/** SQL Editor only: make the account with this email a member and admin. `select make_admin('you@example.com');` */
create or replace function public.make_admin(email text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  target uuid;
begin
  select u.id into target from auth.users u where lower(u.email) = lower(btrim(make_admin.email));
  if target is null then
    raise exception 'no account with that email: sign in to Luma once first' using errcode = 'P0002';
  end if;
  insert into public.profiles (id, member, admin) values (target, true, true)
    on conflict (id) do update set member = true, admin = true, banned = false;
  return target;
end $$;

revoke execute on function public.redeem_invite(text), public.create_invites(integer, integer), public.luma_search(text),
  public.admin_remove(text, uuid), public.admin_ban(uuid, boolean), public.make_admin(text) from public, anon, authenticated;
grant execute on function public.redeem_invite(text), public.create_invites(integer, integer),
  public.admin_remove(text, uuid), public.admin_ban(uuid, boolean) to authenticated;
grant execute on function public.luma_search(text) to anon, authenticated;
-- make_admin: no grants. Only the SQL Editor's role (the owner) can run it.

-- ── Storage: the public `media` bucket, one folder per user ───────────────
-- <uid>/profile/…  avatar, banner, backdrop and their stills
-- <uid>/videos/…   videos and their stills
-- <uid>/posts/…    post images
-- Never song audio: no audio MIME types are allowed.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/apng', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function luma.media_path_ok(name text) returns boolean
language sql stable set search_path = '' as $$
  select (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] in ('profile', 'videos', 'posts')
    and cardinality(storage.foldername(name)) = 2
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'gif', 'webp', 'apng', 'mp4', 'mov', 'webm')
    and name not like '%..%'
$$;
revoke all on function luma.media_path_ok(text) from public;
grant execute on function luma.media_path_ok(text) to anon, authenticated;

drop policy if exists "media: owner lists" on storage.objects;
create policy "media: owner lists" on storage.objects for select to authenticated
  using (bucket_id = 'media' and ((storage.foldername(name))[1] = (select auth.uid()::text) or (select luma.is_admin())));
drop policy if exists "media: members upload to their folder" on storage.objects;
create policy "media: members upload to their folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and luma.media_path_ok(name) and (select luma.is_member()));
drop policy if exists "media: members replace in their folder" on storage.objects;
create policy "media: members replace in their folder" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid()::text) and (select luma.is_member()))
  with check (bucket_id = 'media' and luma.media_path_ok(name) and (select luma.is_member()));
drop policy if exists "media: members and admins delete" on storage.objects;
create policy "media: members and admins delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (((storage.foldername(name))[1] = (select auth.uid()::text) and (select luma.is_member())) or (select luma.is_admin())));
