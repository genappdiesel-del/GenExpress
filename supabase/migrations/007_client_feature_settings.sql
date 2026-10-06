-- ===================================================================
-- Migration 007: Client feature settings
-- ===================================================================
-- Each Supplier decides what each of their Clients may see. A Client who
-- is allowed to see prices sees a price; a Client who is not, sees the
-- product with no number next to it at all.
--
-- -------------------------------------------------------------------
-- WHY COLUMNS AND NOT A JSON BLOB
-- -------------------------------------------------------------------
-- The brief suggests JSON flags. We used real boolean columns instead,
-- on purpose.
--
-- With JSON, a typo in a key name fails SILENTLY. Write
-- "can_view_prices" in the code and "canViewPrices" in the database, and
-- the feature quietly turns itself off. Nobody gets an error. The Client
-- just cannot see prices and nobody can work out why, possibly for months.
--
-- Real columns cannot do that. A misspelled column is caught by the
-- type checker before the code runs, and an unexpected value is caught by
-- the database. The cost is that adding a new switch needs a migration.
-- For nine switches that will change maybe twice in the app's life, that
-- is the right trade.
-- ===================================================================

create table if not exists public.client_feature_settings (
  -- The Client this applies to. Primary key, so exactly one row per
  -- Client and no duplicates.
  client_id    uuid primary key references public.profiles(id) on delete cascade,

  supplier_id  uuid not null references public.profiles(id) on delete cascade,

  -- --- What the Client sees ------------------------------------------
  -- ON by default. These four are what makes the app usable; a Supplier
  -- turning all of them off would be handing a Client a login that shows
  -- an empty screen.
  can_view_stock        boolean not null default true,
  can_view_readiness    boolean not null default true,
  can_view_prices       boolean not null default true,
  can_place_orders      boolean not null default true,

  -- --- Everything else: OFF by default ---------------------------
  -- These reveal business information or add support burden, so a
  -- Supplier must deliberately switch them on for a specific Client.
  can_view_order_history              boolean not null default false,
  can_view_payments                   boolean not null default false,
  can_view_report_sales               boolean not null default false,
  can_view_report_statement           boolean not null default false,
  can_view_report_product_availability boolean not null default false,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- "List my Clients with their settings" is run on every Supplier dashboard.
create index if not exists client_feature_settings_supplier_idx
  on public.client_feature_settings (supplier_id);

-- Keep updated_at honest.
drop trigger if exists client_feature_settings_set_updated_at
  on public.client_feature_settings;
create trigger client_feature_settings_set_updated_at
  before update on public.client_feature_settings
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------
-- Every Client gets a default settings row on creation
-- -------------------------------------------------------------------
-- Same reasoning as supplier_settings: there must always be exactly one
-- row, so no screen has to cope with "no settings found" and fall back to
-- something arbitrary.
create or replace function public.ensure_client_feature_settings()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.role = 'client' then
    insert into public.client_feature_settings (client_id, supplier_id)
    values (new.id, new.supplier_id)
    on conflict (client_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_ensure_client_feature_settings
  on public.profiles;
create trigger profiles_ensure_client_feature_settings
  after insert on public.profiles
  for each row execute function public.ensure_client_feature_settings();

-- Backfill any Client created before this migration.
insert into public.client_feature_settings (client_id, supplier_id)
select id, supplier_id from public.profiles where role = 'client'
on conflict (client_id) do nothing;

-- ===================================================================
-- SECURITY
-- ===================================================================
-- WHO CAN DO WHAT:
--   Super Admin  read and change any row
--   Supplier     read and change rows for their OWN Clients only
--   Client       read their OWN row, and change nothing
--
-- A Client is allowed to read their own switches because the Client
-- portal needs to know what to show. It is their own row and nothing
-- more, so this leaks no other Client's permissions.
--
-- A Client CANNOT update. If they could, they would turn on "see all
-- reports" for themselves, which is a privilege escalation. The row is
-- changed only by the owning Supplier or the platform owner.
-- ===================================================================

alter table public.client_feature_settings enable row level security;

drop policy if exists "client_settings_select" on public.client_feature_settings;
create policy "client_settings_select"
  on public.client_feature_settings
  for select
  to authenticated
  using (
    (select public.current_is_active())
    and (
      client_id = (select auth.uid())
      or (select public.is_super_admin())
      -- The owning Supplier needs to see and edit the switches of their
      -- own Clients. Compare against supplier_id, which holds the
      -- Supplier's own profile id.
      or supplier_id = (select auth.uid())
    )
  );

drop policy if exists "client_settings_update_supplier" on public.client_feature_settings;
create policy "client_settings_update_supplier"
  on public.client_feature_settings
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
    -- The row being saved must still be one of the caller's own Clients.
    -- supplier_id holds the caller's OWN profile id here (a Supplier's
    -- profile row has supplier_id = null), so comparing against auth.uid()
    -- is the correct test. See DECISIONS.md section 5.5 for why the
    -- reversed form silently rejects every Supplier save.
    supplier_id = (select auth.uid())
    or (select public.is_super_admin())
  );

-- No INSERT policy: rows are created by the trigger above.
-- No DELETE policy: a Client's settings belong to the Client's lifetime.
--   If a Client is removed, the row goes with them via on delete cascade.

-- GRANT: required from 2026-10-30 or every query fails with
-- "permission denied". RLS then narrows the rows.
grant select on public.client_feature_settings to authenticated;
grant update on public.client_feature_settings to authenticated;

comment on table public.client_feature_settings is
  'Per-Client switches the Supplier controls. Columns rather than JSON so a misspelled key cannot silently disable a feature.';