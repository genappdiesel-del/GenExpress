-- ===================================================================
-- Migration 003: Explicit GRANT statements
-- ===================================================================
-- WHY THIS FILE EXISTS (important, and time-sensitive):
--
-- Supabase used to expose every new table in the public schema to the Data
-- API automatically. That has changed. Per the Supabase changelog
-- (2026-04-28): new tables in the public schema are no longer exposed to the
-- Data and GraphQL APIs by default, and this becomes ENFORCED ON ALL PROJECTS
-- on 2026-10-30.
--
-- The failure mode is silent and confusing: your table exists, your RLS is
-- correct, but the frontend gets "permission denied for table X" because the
-- table was never granted to the anon/authenticated roles at all.
--
-- RLS and GRANT are two DIFFERENT gates:
--   GRANT decides WHETHER a role can talk to the table at all.
--   RLS decides WHICH ROWS they may see once they are in.
-- Enabling RLS without a GRANT still produces "permission denied".
--
-- So every table we create gets explicit grants. This is the fix your
-- prompt asked for in Section 3, and it is enforced here in SQL rather than
-- relying on dashboard settings that could change.
-- ===================================================================

-- Give the two roles Supabase uses to reach the Data API the ability to
-- read/insert/update/delete on the tables they need. RLS then narrows
-- WHICH rows, not WHETHER they can ask.
--
-- Note: we deliberately do NOT grant on every table. Each table is granted
-- explicitly so that adding a table later cannot silently expose it.
grant usage on schema public to anon, authenticated;

-- profiles: readable by every logged-in user (RLS limits the rows).
-- Writable by the create-user Edge Function via service_role, which
-- bypasses grants and RLS entirely.
grant select on public.profiles to authenticated;
grant select on public.profiles to anon;

-- Future migrations will add the remaining tables and grant them here.
-- Keeping all grants in one migration file makes the security surface
-- easy to review in one place.

-- ===================================================================
-- Audit log
-- ===================================================================
-- Append-only record of who changed what. There is deliberately NO update
-- and NO delete grant, and the RLS policy allows insert + select only.
-- This is how we can say "price changed from 10 to 12" without lying.
create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  -- Who did it. Null if the action was done by a database trigger.
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  table_name  text not null,
  record_id   uuid,
  -- Stored as text so we can log any field, including numbers, without
  -- needing a separate column per data type.
  old_value   text,
  new_value   text,
  created_at  timestamptz not null default now()
);

-- Audit rows are never edited or deleted. We will revoke those grants below.
create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);

create index if not exists audit_logs_actor_id_idx
  on public.audit_logs (actor_id);

alter table public.audit_logs enable row level security;

-- Super Admin reads all. Suppliers read only their own activity.
drop policy if exists "audit_select" on public.audit_logs;
create policy "audit_select"
  on public.audit_logs
  for select
  to authenticated
  using (
    (select public.current_is_active())
    and (
      (select public.is_super_admin())
      or actor_id = (select auth.uid())
    )
  );

-- Insert is allowed for any active authenticated user so the write path
-- works, but there is no UPDATE or DELETE policy at all -- Postgres refuses
-- those operations outright, which is what "append-only" means in practice.
drop policy if exists "audit_insert" on public.audit_logs;
create policy "audit_insert"
  on public.audit_logs
  for insert
  to authenticated
  with check (
    (select public.current_is_active())
    and actor_id = (select auth.uid())
  );

grant select, insert on public.audit_logs to authenticated;

-- Belt and braces: explicitly deny edit and delete for the Data API roles.
-- The absence of a policy already does this, but stating it makes the
-- intent obvious to anyone reading this file later.
revoke update, delete on public.audit_logs from anon, authenticated;