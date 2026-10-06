-- ===================================================================
-- LOCAL VERIFICATION HARNESS  (developer only -- never run this in
-- your real Supabase project)
-- ===================================================================
-- WHY THIS FILE EXISTS
--
-- Supabase's hosted database is the only place the real migrations are
-- meant to run. But shipping seven untested SQL files to the owner and
-- asking them to report "PASS / FAIL" back to me is a bad way to find
-- out that a policy is wrong: they cannot tell a real hole from a typo,
-- and they will simply tell me something failed.
--
-- So this file builds a small fake Supabase on a local PostgreSQL --
-- just enough for the migrations to run against -- and then the real
-- test suite runs unchanged. If a policy is broken, it shows up here,
-- on my machine, before anybody else has to look at it.
--
-- This is NOT a replacement for running the real tests in Supabase.
-- It proves the SQL is correct and the security rules hold. Only
-- Supabase can prove the real thing works in production.
--
-- HOW TO RUN (from the GenApp folder):
--
--   createdb genapp_verify
--   psql -d genapp_verify -v ON_ERROR_STOP=1 -f supabase/verify/00_stub_supabase.sql
--   psql -d genapp_verify -v ON_ERROR_STOP=1 -f supabase/migrations/001_profiles.sql
--   ... and so on through 011 ...
--   psql -d genapp_verify -v ON_ERROR_STOP=1 -f supabase/tests/rls_tests.sql
--
-- Or just run verify/run_all.ps1
-- ===================================================================

create extension if not exists pgcrypto with schema extensions;

-- Roles that exist in every real Supabase project.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public, extensions to anon, authenticated, service_role;

-- -------------------------------------------------------------------
-- The auth schema, faked
-- -------------------------------------------------------------------
-- Only the pieces the migrations touch. auth.users in real Supabase has
-- 80-odd columns; the tests write to ten of them.
create schema if not exists auth;

create table if not exists auth.users (
  id                    uuid primary key default gen_random_uuid(),
  instance_id           uuid,
  aud                   text,
  role                  text,
  email                 text,
  encrypted_password    text,
  email_confirmed_at    timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  raw_app_meta_data     jsonb,
  raw_user_meta_data    jsonb
);

-- auth.uid() reads the caller id out of the JWT claim, exactly as the
-- real one does. Both the old and new claim names are supported because
-- Supabase moved to claims->>sub in 2025 and both are still in the wild.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')
  )::uuid;
$$;

-- -------------------------------------------------------------------
-- The storage schema, faked
-- -------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name      text not null
);

alter table storage.objects enable row level security;

-- storage.foldername('abc-123/photo.jpg') returns text[] {'abc-123'}.
-- This matches the real Supabase function, which returns every folder
-- segment above the file name.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/')[:array_length(string_to_array(name, '/'), 1) - 1];
$$;

grant usage on schema storage to authenticated, anon, service_role;
grant select, insert, update, delete on storage.objects, storage.buckets to authenticated, service_role;

-- -------------------------------------------------------------------
-- One difference from real Supabase, on purpose
-- -------------------------------------------------------------------
-- Supabase makes a specific database role the owner of everything the
-- SQL editor creates. In real Supabase it is `postgres`, which has
-- BYPASSRLS. This script is normally run BY postgres already, but if you
-- run it as some other superuser the ownership of the views would not
-- bypass RLS and tests 9 to 13 would fail for the wrong reason.
--
-- A superuser bypasses RLS regardless of who owns the row, so this only
-- matters for non-superuser owners. It is noted rather than worked
-- around, because the real behaviour is already correct.
raise notice 'Supabase stub ready. Roles: anon, authenticated, service_role.';