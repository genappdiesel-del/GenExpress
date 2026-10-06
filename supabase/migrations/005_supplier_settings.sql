-- ===================================================================
-- Migration 005: Supplier settings
-- ===================================================================
-- A short table that holds per-Supplier switches. It exists now because
-- two Phase 2 rules depend on it:
--
--   1. The currency a Supplier trades in (default Rupiah).
--   2. "Allow backorder" -- whether a Client may order more than the
--      Supplier currently has in stock.
--
-- It is a one-row-per-Supplier table rather than columns on profiles,
-- because profiles is the identity table. Settings will keep growing
-- (receipt prefix, default low-stock level, and so on) and none of that
-- belongs in a table about who somebody is.
-- ===================================================================

create table if not exists public.supplier_settings (
  -- The Supplier this belongs to. Using the profile id as the key means
  -- there is exactly one settings row per Supplier, and deleting the
  -- Supplier removes the settings with it.
  supplier_id    uuid primary key references public.profiles(id) on delete cascade,

  -- Currency for this Supplier's money. IDR is the default because that is
  -- where this app is used. 'Rp' is written with no decimals; the others
  -- use two.
  currency       text not null default 'IDR'
                 check (currency in ('IDR', 'USD', 'MYR', 'SGD')),

  -- When true, a Client may order more than the Supplier has in stock.
  -- The stock then goes negative and the Supplier owes goods.
  -- Default false: refusing to oversell is the safer default, and a
  -- Supplier must deliberately choose to allow it.
  allow_backorder boolean not null default false,

  -- How many rows a list shows before asking for the next page.
  -- 20 is the value the project brief asks for, and it keeps every list
  -- small enough to load instantly on a slow phone connection.
  page_size       integer not null default 20
                 check (page_size between 5 and 200),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- -------------------------------------------------------------------
-- Keep updated_at honest
-- -------------------------------------------------------------------
drop trigger if exists supplier_settings_set_updated_at on public.supplier_settings;
create trigger supplier_settings_set_updated_at
  before update on public.supplier_settings
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------
-- Every Supplier gets a settings row the moment they are created
-- -------------------------------------------------------------------
-- If a Supplier had no settings row, the app would have to cope with a
-- missing row everywhere -- and a missing row would quietly mean "IDR,
-- no backorder" by accident rather than by decision. Creating it
-- automatically means there is always exactly one row, and the defaults
-- are chosen in one place instead of scattered through the screens.
create or replace function public.ensure_supplier_settings()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.role = 'supplier' then
    insert into public.supplier_settings (supplier_id)
    values (new.id)
    on conflict (supplier_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_ensure_supplier_settings on public.profiles;
create trigger profiles_ensure_supplier_settings
  after insert on public.profiles
  for each row execute function public.ensure_supplier_settings();

-- Backfill in case a Supplier already existed before this migration.
insert into public.supplier_settings (supplier_id)
select id from public.profiles where role = 'supplier'
on conflict (supplier_id) do nothing;

-- ===================================================================
-- SECURITY
-- ===================================================================
-- Only the owning Supplier may read or change their own settings.
-- Super Admin reads them too, so the platform owner can see what a
-- Supplier has configured.
--
-- Clients and Agents get NO policy. A Client must never learn their
-- Supplier's backorder setting, because it reveals how close the
-- Supplier is to running out of stock -- which is business information.
-- ===================================================================

alter table public.supplier_settings enable row level security;

drop policy if exists "supplier_settings_select_own" on public.supplier_settings;
create policy "supplier_settings_select_own"
  on public.supplier_settings
  for select
  to authenticated
  using (
    (select public.current_is_active())
    and (
      supplier_id = (select auth.uid())
      or (select public.is_super_admin())
    )
  );

-- Changing settings affects stock rules and money display, so only the
-- owning Supplier or the platform owner may do it.
drop policy if exists "supplier_settings_update_own" on public.supplier_settings;
create policy "supplier_settings_update_own"
  on public.supplier_settings
  for update
  to authenticated
  using (
    (select public.current_is_active())
    and (
      supplier_id = (select auth.uid())
      or (select public.is_super_admin())
    )
  )
  with check (
    -- The row being saved must still belong to the person saving it.
    --
    -- This compares supplier_id against the caller's OWN profile id, which
    -- is correct: a Supplier's profile row has supplier_id = null, so the
    -- rule is simply "this row is mine". Written the other way round --
    -- asking for the caller's supplier_id -- it would compare against null
    -- and reject every Supplier save, which is a fault found and fixed
    -- before Phase 2 shipped. See DECISIONS.md section 5.5.
    supplier_id = (select auth.uid())
    or (select public.is_super_admin())
  );

-- INSERT and DELETE policies are deliberately absent. The row is created
-- by the trigger above when the Supplier is created, and removed when the
-- Supplier is deleted. Nobody needs to add or remove these by hand.

-- -------------------------------------------------------------------
-- GRANT
-- -------------------------------------------------------------------
-- Needed because Supabase stops exposing new public-schema tables to the
-- Data API by default from 2026-10-30. Without this grant, every query
-- fails with "permission denied" even though the RLS rules are correct.
--
-- RLS and GRANT are two separate gates. GRANT says "you may ask about
-- this table at all". RLS says "of the rows in it, which ones you get".
-- Both are needed.
-- -------------------------------------------------------------------
grant select on public.supplier_settings to authenticated;
grant update on public.supplier_settings to authenticated;