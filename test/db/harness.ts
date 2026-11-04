// A local stand-in for the Supabase database: PGlite plus the parts of Supabase the migration relies on
// (the anon/authenticated roles, auth.users, auth.uid() from the request's JWT setting, and enough of
// storage.buckets/objects to run the storage policies). Then the real migration on top.

import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, created_at timestamptz default now());
-- Supabase's own definition: the JWT's sub claim, set per request by PostgREST.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase's default privileges: new tables and functions in public are open to the API roles (RLS does the work).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key, name text not null, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text,
  owner uuid default auth.uid(), metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (bucket_id, name)
);
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
create function storage.filename(name text) returns text language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end $$;
create function storage.extension(name text) returns text language plpgsql immutable as $$
declare _parts text[]; _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end $$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
`

const DIR = new URL('../../supabase/migrations/', import.meta.url)

/** Every migration, in the order the owner runs them (0001, then 0002, …). */
export const MIGRATIONS = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(f, DIR), 'utf8'))
/** All of them, in order: what a fresh install runs. */
export const MIGRATION = MIGRATIONS.join('\n')
/** 0001 alone: what a lone re-run of it does. */
export const FIRST = MIGRATIONS[0]

export type Who = 'anon' | 'owner' | { id: string }

export interface Db {
  pg: PGlite
  /** Run as a role: 'anon', 'owner' (the SQL Editor's role, here the superuser), or a signed-in user. */
  as<T = Record<string, unknown>>(who: Who, sql: string, params?: unknown[]): Promise<T[]>
  /** A new auth user. */
  user(email?: string): Promise<{ id: string }>
  /** A new user who redeemed an invite and claimed `handle`. */
  member(handle?: string): Promise<{ id: string }>
  admin(): Promise<{ id: string }>
}

let n = 0

/** A database with every migration run on it; `before` runs first (say, an earlier release of them and its data). */
export async function createDb(before?: string): Promise<Db> {
  const pg = new PGlite()
  await pg.exec(STUB)
  if (before) await pg.exec(before)
  await pg.exec(MIGRATION)

  const as = async <T,>(who: Who, sql: string, params: unknown[] = []): Promise<T[]> => {
    const sub = typeof who === 'object' ? who.id : ''
    const role = who === 'owner' ? null : who === 'anon' ? 'anon' : 'authenticated'
    await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub])
    if (role) await pg.exec(`set role ${role}`)
    try {
      return (await pg.query<T>(sql, params)).rows
    } finally {
      await pg.exec('reset role')
    }
  }

  const user = async (email = `user${++n}@example.com`) => {
    const [row] = await as<{ id: string }>('owner', 'insert into auth.users (email) values ($1) returning id', [email])
    return row
  }

  const member = async (handle?: string) => {
    const u = await user()
    const [{ code }] = await as<{ code: string }>('owner', `insert into public.invites (code) values (upper(substr(md5(random()::text), 1, 10))) returning code`)
    const [{ redeem_invite }] = await as<{ redeem_invite: string }>(u, 'select public.redeem_invite($1)', [code])
    if (redeem_invite !== 'ok') throw new Error(redeem_invite)
    if (handle) await as(u, 'update public.profiles set handle = $1 where id = auth.uid()', [handle])
    return u
  }

  const admin = async () => {
    const email = `admin${++n}@example.com`
    const u = await user(email)
    await as('owner', 'select public.make_admin($1)', [email.toUpperCase()]) // any case
    return u
  }

  return { pg, as, user, member, admin }
}
