-- ===================================================================
-- Migration 001: Extensions, types, helper functions, and the profiles table
-- ===================================================================
-- This is the foundation of the whole app. Everything else hangs off it.
--
-- IMPORTANT CONCEPT (the single most important idea in this app):
-- Supabase has "Row Level Security" (RLS). It means the DATABASE decides
-- which rows a logged-in person is allowed to see. Not the screen, not the
-- code. The database itself. So even if someone hacks the frontend code,
-- the database still refuses to show them another Supplier's data.
-- ===================================================================

-- pgcrypto gives us gen_random_uuid(). Supabase already enables this by
-- default, but naming it explicitly makes the migration self-contained.
-- NOTE: Supabase deprecated pinning extension VERSIONS (from 2026-08-05 the
-- version clause is ignored), so we never write "version = ...".
create extension if not exists pgcrypto with schema extensions;

-- -------------------------------------------------------------------
-- The user_role type
-- -------------------------------------------------------------------
-- Using a fixed list of roles (instead of free text) means the database
-- physically cannot hold a role name that we did not expect.
-- This MUST come before any function that returns this type.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role' and typnamespace = 'public'::regnamespace) then
    create type public.user_role as enum ('super_admin', 'supplier', 'client', 'agent');
  end if;
end
$$;

-- -------------------------------------------------------------------
-- profiles
-- -------------------------------------------------------------------
-- One row per person who can log in. The id here is deliberately the
-- SAME value as the Supabase Auth user id. That is the link between
-- "this person logged in" and "this person's data".
create table if not exists public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  role                  public.user_role not null,
  -- Only used for client and agent. Points at the supplier that owns them.
  -- Suppliers and super admins have null here.
  supplier_id           uuid references public.profiles(id) on delete restrict,
  full_name             text not null,
  -- The name the person types to log in. Must be unique across the app.
  username              text not null,
  phone                 text,
  address               text,
  is_active             boolean not null default true,
  -- Forces a password change the first time someone logs in.
  must_change_password  boolean not null default false,
  -- Which user created this account. Null for the first Super Admin.
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Username must be unique. This is what stops two people having the same
-- login name. We store usernames in lowercase so "Ali" and "ali" are
-- the same person.
create unique index if not exists profiles_username_key
  on public.profiles (lower(username));

-- Fast lookups: "show me all the clients of supplier X"
create index if not exists profiles_supplier_id_idx
  on public.profiles (supplier_id);

create index if not exists profiles_role_idx
  on public.profiles (role);

-- -------------------------------------------------------------------
-- Helper functions used by every RLS policy
-- -------------------------------------------------------------------
-- These read the CURRENT logged-in user's id out of the JWT that
-- Supabase attaches to every request. We use them constantly in policies.
--
-- All of them are SECURITY DEFINER because they read the profiles table,
-- and during policy evaluation a normal function would be caught by the
-- profiles policy, creating a circular dependency. Running them as the
-- table owner breaks the loop.
--
-- This is safe because each one returns information about the CALLER
-- ONLY -- never anybody else's row.

-- Returns the id of the person making this request.
-- SECURITY DEFINER is safe here because the function only reads auth.uid(),
-- which is set by Supabase and cannot be forged by the caller.
create or replace function public.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select auth.uid();
$$;

-- Returns the role of the person making this request, or null if they
-- have no profile row yet.
create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, extensions
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Returns the supplier_id of the person making this request.
-- For super_admin this is null (they are not attached to one supplier).
-- For client and agent this is the supplier that owns them.
create or replace function public.current_supplier_id()
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select supplier_id from public.profiles where id = auth.uid();
$$;

-- True only for the active platform owner.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin' and is_active
  );
$$;

-- True only when the signed-in person exists AND is_active.
--
-- Deactivating an account has to actually cut off access, not merely make
-- the app show an empty screen. Without this, a deactivated Client would
-- keep reading their own profile and their Supplier's row, because every
-- other rule only asks "who are you", never "are you still allowed in".
create or replace function public.current_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;

-- -------------------------------------------------------------------
-- Keep updated_at honest
-- -------------------------------------------------------------------
-- Without this, updated_at would freeze at the moment the row was created
-- and we could never tell when something last changed.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();