-- ===================================================================
-- Migration 011: automatic audit records
-- ===================================================================
-- The brief lists the changes that must be recorded automatically
-- rather than trusted to whoever presses the button. Two of them happen
-- in Phase 2: a price change, and a product being created or removed.
--
-- Why a database trigger instead of writing the audit row in the app:
-- the app can be bypassed, or simply contain a bug that forgets to log.
-- A trigger cannot be bypassed by any route into the database, including
-- a future one nobody has written yet. If it happened, it was written
-- down.
--
-- The trade-off, stated plainly: a trigger is invisible when reading the
-- app code. That is why each one below is commented, and why
-- DECISIONS.md records which tables are audited, so the next person
-- knows where to look.
-- ===================================================================

-- -------------------------------------------------------------------
-- The audit log itself
-- -------------------------------------------------------------------
-- Created in migration 003 with the other grants. This migration only
-- adds the automatic writers. The table shape, and the fact that only
-- service_role may write it directly, are unchanged.
-- -------------------------------------------------------------------

-- -------------------------------------------------------------------
-- Price changes
-- -------------------------------------------------------------------
-- A price change is the single most sensitive event in this app. It is
-- how a Supplier's margin moves, and a price changed quietly on one
-- product and not the other is how an account becomes impossible to
-- explain to an auditor.
--
-- We record: which product, whose, which of the two prices moved, the
-- old value, the new value, and who did it.
create or replace function public.audit_price_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- Only fire when a price actually changed. Without this, every save
  -- of an unrelated field -- a typo fix in the description -- would
  -- produce an audit entry claiming a price changed, and the log would
  -- become noise nobody reads.
  if new.agent_price is distinct from old.agent_price then
    insert into public.audit_logs
      (actor_id, action, entity_type, entity_id, supplier_id,
       old_values, new_values)
    values
      (auth.uid(), 'product.agent_price_changed', 'product', new.id,
       new.supplier_id,
       jsonb_build_object('agent_price', old.agent_price),
       jsonb_build_object('agent_price', new.agent_price));
  end if;

  if new.client_price is distinct from old.client_price then
    insert into public.audit_logs
      (actor_id, action, entity_type, entity_id, supplier_id,
       old_values, new_values)
    values
      (auth.uid(), 'product.client_price_changed', 'product', new.id,
       new.supplier_id,
       jsonb_build_object('client_price', old.client_price),
       jsonb_build_object('client_price', new.client_price));
  end if;

  return new;
end;
$$;

drop trigger if exists products_audit_price_change on public.products;
create trigger products_audit_price_change
  after update on public.products
  for each row execute function public.audit_price_change();

-- -------------------------------------------------------------------
-- Products created, removed, or switched on and off
-- -------------------------------------------------------------------
-- "Is active" is not cosmetic. Switching it off hides a product from
-- every Client and Agent immediately. Somebody must be able to answer
-- "who took this off the shelf, and when", so the change is recorded.
create or replace function public.audit_product_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs
      (actor_id, action, entity_type, entity_id, supplier_id, new_values)
    values
      (auth.uid(), 'product.created', 'product', new.id, new.supplier_id,
       jsonb_build_object(
         'name', new.name,
         'agent_price', new.agent_price,
         'client_price', new.client_price));

  elsif tg_op = 'UPDATE' and new.is_active is distinct from old.is_active then
    insert into public.audit_logs
      (actor_id, action, entity_type, entity_id, supplier_id,
       old_values, new_values)
    values
      (auth.uid(),
       case when new.is_active then 'product.activated'
            else 'product.deactivated' end,
       'product', new.id, new.supplier_id,
       jsonb_build_object('is_active', old.is_active),
       jsonb_build_object('is_active', new.is_active));

  elsif tg_op = 'DELETE' then
    insert into public.audit_logs
      (actor_id, action, entity_type, entity_id, supplier_id, old_values)
    values
      (auth.uid(), 'product.deleted', 'product', old.id, old.supplier_id,
       jsonb_build_object('name', old.name));
  end if;

  -- An AFTER trigger's return value is ignored, but the function must
  -- still return the right row type or Postgres rejects it at runtime.
  -- NEW does not exist on DELETE and OLD does not exist on INSERT, so
  -- they are returned separately rather than combined.
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists products_audit_lifecycle on public.products;
create trigger products_audit_lifecycle
  after insert or update or delete on public.products
  for each row execute function public.audit_product_lifecycle();

-- -------------------------------------------------------------------
-- Client permission changes
-- -------------------------------------------------------------------
-- When a Supplier switches on "this Client may see all reports" for one
-- Client, that is a change in what a real person is allowed to know, and
-- it happens with a single tap. Recorded for the same reason.
create or replace function public.audit_client_permission_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- Every switch that exists, as text, so we can report only the ones
  -- that genuinely flipped rather than writing 9 near-identical blocks.
  flag text;
  old_v boolean;
  new_v boolean;
begin
  foreach flag in array array[
    'can_view_stock', 'can_view_readiness', 'can_view_prices',
    'can_place_orders', 'can_view_order_history', 'can_view_payments',
    'can_view_report_sales', 'can_view_report_statement',
    'can_view_report_product_availability'
  ]
  loop
    -- Reading the values as jsonb avoids naming nine variables and
    -- keeps the list of switches in exactly one place.
    old_v := (to_jsonb(old) ->> flag)::boolean;
    new_v := (to_jsonb(new) ->> flag)::boolean;

    if old_v is distinct from new_v then
      insert into public.audit_logs
        (actor_id, action, entity_type, entity_id, supplier_id,
         old_values, new_values)
      values
        (auth.uid(), 'client_permission.changed', 'client_feature_settings',
         new.client_id, new.supplier_id,
         jsonb_build_object(flag, old_v),
         jsonb_build_object(flag, new_v));
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists client_settings_audit on public.client_feature_settings;
create trigger client_settings_audit
  after update on public.client_feature_settings
  for each row execute function public.audit_client_permission_change();

-- -------------------------------------------------------------------
-- Account access changes
-- -------------------------------------------------------------------
-- Switching somebody off, or forcing a password change, is the sort of
-- thing that is quietly un-done later. The brief asks for it, and it is
-- cheap to record.
create or replace function public.audit_account_access_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.is_active is distinct from old.is_active then
    insert into public.audit_logs
      (actor_id, action, entity_type, entity_id, supplier_id,
       old_values, new_values)
    values
      (auth.uid(),
       case when new.is_active then 'account.activated'
            else 'account.deactivated' end,
       'profile', new.id, new.supplier_id,
       jsonb_build_object('is_active', old.is_active),
       jsonb_build_object('is_active', new.is_active));
  end if;

  if new.must_change_password is distinct from old.must_change_password
     and new.must_change_password then
    insert into public.audit_logs
      (actor_id, action, entity_type, entity_id, supplier_id, new_values)
    values
      (auth.uid(), 'account.password_change_required', 'profile',
       new.id, new.supplier_id,
       jsonb_build_object('must_change_password', true));
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_audit_access on public.profiles;
create trigger profiles_audit_access
  after update on public.profiles
  for each row execute function public.audit_account_access_change();

comment on function public.audit_price_change() is
  'Trigger on products. Writes an audit_logs row whenever agent_price or client_price moves. Fires only on a real change, so unrelated edits do not pollute the log.';