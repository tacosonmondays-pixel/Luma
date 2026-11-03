-- Luma 0002: the social screens. Paste after 0001 and Run; run it again after any run of 0001. Idempotent.
--
-- Re-run rules (docs/server.md): every function a policy calls lives in `public`, never `luma`, because 0001 revokes
-- execute on everything in `luma` each time it runs. The quota policies are restrictive and named here only, so 0001
-- never drops them. A lone run of 0001 does revoke the posts song-column insert grant: run 0002 after it, every time.

-- ── 1. Per-member media quota ──────────────────────────────────────────

/** Bytes each member may keep in the media bucket (admins: no limit). The one number to tune. */
create or replace function luma.media_quota() returns bigint
language sql immutable set search_path = '' as $$ select 200::bigint * 1024 * 1024 $$;
-- Only media_left (security definer, so it runs as the owner) calls it. Explicit, so a re-run of 0001 changes nothing.
revoke all on function luma.media_quota() from public, anon, authenticated;

/** What the caller may still upload: null for admins, 0 for non-members, else bytes left under the quota
 * (0 once they keep 2,000 files). Counts files Storage has recorded (metadata.size); malformed sizes count 0. */
create or replace function public.media_left() returns bigint
language sql stable security definer set search_path = '' as $$
  select case
    when luma.is_admin() then null
    when not luma.is_member() then 0::bigint
    else (
      select case when count(*) >= 2000 then 0::bigint
        else greatest(luma.media_quota() - coalesce(sum(case when o.metadata ->> 'size' ~ '^[0-9]{1,15}$'
          then (o.metadata ->> 'size')::bigint else 0 end), 0), 0)::bigint end
      from storage.objects o
      where o.bucket_id = 'media' and o.name like auth.uid()::text || '/%')
  end
$$;
revoke execute on function public.media_left() from public, anon, authenticated;
grant execute on function public.media_left() to authenticated;

-- Restrictive: on top of 0001's "members upload to their folder" and "members replace in their folder".
drop policy if exists "media: within quota" on storage.objects;
create policy "media: within quota" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'media' or coalesce((select public.media_left()), 1) > 0);
drop policy if exists "media: within quota when replacing" on storage.objects;
create policy "media: within quota when replacing" on storage.objects as restrictive for update to authenticated
  using (true) with check (bucket_id <> 'media' or coalesce((select public.media_left()), 1) > 0);

-- ── 2. Dismiss a target's open reports, leaving the content alone ──────────

create or replace function public.admin_dismiss(kind text, id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not luma.is_operator() then raise exception 'admins only' using errcode = '42501'; end if;
  if kind is null or kind not in ('profile', 'video', 'post') then
    raise exception 'kind must be profile, video or post' using errcode = '22023';
  end if;
  update public.reports r set resolved_at = now()
    where r.kind = admin_dismiss.kind and r.target_id = admin_dismiss.id and r.resolved_at is null;
end $$;

-- ── 3. After a ban: remove everything they posted, clear the profile, resolve every report about them ──

create or replace function public.admin_purge(target uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not luma.is_operator() then raise exception 'admins only' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = target and p.banned) then
    raise exception 'ban the account first' using errcode = '22023';
  end if;
  update public.videos v set removed_at = now() where v.user_id = target and v.removed_at is null;
  update public.posts t set removed_at = now() where t.user_id = target and t.removed_at is null;
  perform public.admin_remove('profile', target);
  update public.reports r set resolved_at = now()
    where r.resolved_at is null and (
      (r.kind = 'profile' and r.target_id = target)
      or (r.kind = 'video' and exists (select 1 from public.videos v where v.id = r.target_id and v.user_id = target))
      or (r.kind = 'post' and exists (select 1 from public.posts t where t.id = r.target_id and t.user_id = target)));
end $$;

revoke execute on function public.admin_dismiss(text, uuid), public.admin_purge(uuid) from public, anon, authenticated;
grant execute on function public.admin_dismiss(text, uuid), public.admin_purge(uuid) to authenticated;

-- ── 4. A song on posts (metadata only, like videos) ───────────────────────

alter table public.posts add column if not exists youtube_id text,
  add column if not exists track_title text, add column if not exists track_artist text;
-- Search covers the song too. A generated column can't be altered: drop it (its index goes with it) and add it again.
do $$
begin
  if (select c.generation_expression from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'posts' and c.column_name = 'search') not like '%track_title%' then
    alter table public.posts drop column search;
    alter table public.posts add column search tsvector generated always as (
      to_tsvector('simple', coalesce(body, '') || ' ' || coalesce(track_title, '') || ' ' || coalesce(track_artist, ''))) stored;
  end if;
end $$;
create index if not exists posts_search on public.posts using gin (search);
-- Limits, the 0001 way: bring old rows within them, then drop and add the named constraint.
update public.posts t set youtube_id = null where t.youtube_id !~ '^[A-Za-z0-9_-]{11}$';
update public.posts t set track_title = left(t.track_title, 300), track_artist = left(t.track_artist, 300)
  where char_length(t.track_title) > 300 or char_length(t.track_artist) > 300;
alter table public.posts drop constraint if exists posts_song_ok, add constraint posts_song_ok check (
  (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{11}$')
  and coalesce(char_length(track_title), 0) <= 300 and coalesce(char_length(track_artist), 0) <= 300);
-- 0001's grant plus the song. 0001 revokes this on every run, hence "run 0002 after it".
grant insert (user_id, body, image_paths, youtube_id, track_title, track_artist) on public.posts to authenticated;
-- 0001's posts_check (a body or an image) is unchanged: a song alone is not a post.
