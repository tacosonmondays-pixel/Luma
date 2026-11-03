-- Luma on Supabase: tables, row level security, RPCs and the media bucket.
-- Paste the whole file into Supabase → SQL Editor → New query, and Run. It is idempotent: running it again
-- updates functions, policies and the bucket, and leaves data alone.
--
-- Rules, in short (docs/server.md has the full contract):
--   · Everyone (even signed out) reads public profiles, videos and posts of members who aren't banned.
--   · Anyone may sign in, but only members write; you become a member by redeeming an invite code.
--   · Banned users can't write, and their public content is hidden.
--   · Library rows are private to their owner. Plays are visible to followers only while the player shares activity.
--   · Song audio is never stored here: library sync is metadata only.

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
  frame text check (char_length(frame) <= 20),
  effect text check (char_length(effect) <= 20),
  name_style text check (char_length(name_style) <= 20),
  -- [{ "id", "title", "artist", "source" }], newest first: public, so the profile page shows them without the library
  pinned_songs jsonb not null default '[]' check (jsonb_typeof(pinned_songs) = 'array' and jsonb_array_length(pinned_songs) <= 5 and pg_column_size(pinned_songs) <= 4096),
  pinned_playlists text[] not null default '{}' check (cardinality(pinned_playlists) <= 6),
  -- [{ "id", "tier" }], the earned badges
  badges jsonb not null default '[]' check (jsonb_typeof(badges) = 'array' and pg_column_size(badges) <= 2048),
  -- Media: paths in the media bucket (always under '<id>/profile/'), the kind, and the device's blob version
  avatar_path text check (avatar_path like id::text || '/profile/%'),
  avatar_still_path text check (avatar_still_path like id::text || '/profile/%'),
  avatar_kind text check (avatar_kind in ('image', 'animated')),
  avatar_version bigint,
  banner_path text check (banner_path like id::text || '/profile/%'),
  banner_still_path text check (banner_still_path like id::text || '/profile/%'),
  banner_kind text check (banner_kind in ('image', 'animated')),
  banner_version bigint,
  backdrop_path text check (backdrop_path like id::text || '/profile/%'),
  backdrop_still_path text check (backdrop_still_path like id::text || '/profile/%'),
  backdrop_kind text check (backdrop_kind in ('image', 'animated', 'video')),
  backdrop_version bigint,
  share_activity boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), -- the device's edit time: last write wins
  search tsvector generated always as (
    to_tsvector('simple', coalesce(handle, '') || ' ' || coalesce(name, '') || ' ' || coalesce(bio, ''))
  ) stored
);
create unique index if not exists profiles_handle_ci on public.profiles (lower(handle));
create index if not exists profiles_search on public.profiles using gin (search);

create table if not exists public.invites (
  code text primary key check (code ~ '^[A-Z0-9]{6,32}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_by uuid unique references auth.users (id) on delete set null,
  used_at timestamptz
);

-- Failed redeem attempts, for the rate limit. Private.
create table if not exists luma.invite_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists invite_attempts_user on luma.invite_attempts (user_id, at);

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
  updated_at timestamptz not null, -- the device's edit time: last write wins
  synced_at timestamptz not null default now(), -- set by the server on every write; pull with it
  primary key (user_id, id)
);
create index if not exists library_tracks_synced on public.library_tracks (user_id, synced_at);

create table if not exists public.library_playlists (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) <= 64),
  name text not null default '' check (char_length(name) <= 200),
  track_ids text[] not null default '{}' check (cardinality(track_ids) <= 5000),
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
  path text not null check (path like user_id::text || '/videos/%'),
  still_path text check (still_path like user_id::text || '/videos/%'),
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
  image_paths text[] not null default '{}' check (cardinality(image_paths) <= 4),
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

/** Every path is in the caller's own folder, under `sub` ('posts', 'videos'). */
create or replace function luma.own_paths(paths text[], sub text) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(bool_and(p like auth.uid()::text || '/' || sub || '/%' and p not like '%..%'), true) from unnest(paths) p
$$;

-- Last write wins: an older edit (by the device's clock) never overwrites a newer one.
create or replace function luma.last_write_wins() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end $$;

-- Library rows also get the server's time, which pulls follow.
create or replace function luma.stamp_synced() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists profiles_lww on public.profiles;
create trigger profiles_lww before update on public.profiles for each row execute function luma.last_write_wins();
drop trigger if exists library_tracks_lww on public.library_tracks;
create trigger library_tracks_lww before insert or update on public.library_tracks for each row execute function luma.stamp_synced();
drop trigger if exists library_playlists_lww on public.library_playlists;
create trigger library_playlists_lww before insert or update on public.library_playlists for each row execute function luma.stamp_synced();

-- ── Privileges: nothing by default, then exactly what the policies cover ─────────────────────────────

revoke all on public.profiles, public.invites, public.follows, public.plays, public.library_tracks,
  public.library_playlists, public.videos, public.posts, public.reports from anon, authenticated;
revoke all on all tables in schema luma from public, anon, authenticated;
revoke all on all functions in schema luma from public, anon, authenticated;
grant usage on schema luma to anon, authenticated;
grant execute on function luma.is_member(), luma.is_admin(), luma.is_visible(uuid), luma.sees_activity(uuid),
  luma.own_paths(text[], text) to anon, authenticated;

grant select on public.profiles to anon, authenticated;
-- Never id, handle checks aside, nor the member / admin / banned flags: those change only through the RPCs.
grant update (handle, name, bio, colors, auto_colors, frame, effect, name_style, pinned_songs, pinned_playlists, badges,
  avatar_path, avatar_still_path, avatar_kind, avatar_version, banner_path, banner_still_path, banner_kind, banner_version,
  backdrop_path, backdrop_still_path, backdrop_kind, backdrop_version, share_activity, updated_at) on public.profiles to authenticated;
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
 * Five failed tries an hour per account. */
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
  if (select count(*) from luma.invite_attempts a where a.user_id = me and a.at > now() - interval '1 hour') >= 5 then
    return 'rate_limited';
  end if;
  update public.invites i set used_by = me, used_at = now()
    where i.code = upper(btrim(redeem_invite.code)) and i.used_by is null and (i.expires_at is null or i.expires_at > now());
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
      backdrop_path = null, backdrop_still_path = null, backdrop_kind = null, backdrop_version = null,
      updated_at = greatest(now(), p.updated_at + interval '1 millisecond')
    where p.id = admin_remove.id;
  else
    raise exception 'kind must be profile, video or post' using errcode = '22023';
  end if;
  update public.reports r set resolved_at = now() where r.kind = admin_remove.kind and r.target_id = admin_remove.id and r.resolved_at is null;
end $$;

/** Admins: ban (or with ban = false, unban) an account. Admins can't be banned. */
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
    on conflict (id) do update set banned = ban, updated_at = greatest(now(), p.updated_at + interval '1 millisecond');
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
