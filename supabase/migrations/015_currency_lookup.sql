-- ===================================================================
-- Migration 015: telling the Client and Agent screens which currency
-- ===================================================================
-- The problem this fixes
-- --------------------
-- Each Supplier has a currency in supplier_settings (migration 005). A
-- Supplier's own screens read it. A Client's and an Agent's screens did
-- NOT, because they have no policy on supplier_settings -- and giving
-- them one would leak the backorder setting, which is business
-- information.
--
-- So the frontend was hardcoding 'IDR' for those two roles. That works
-- right up until somebody trades in Ringgit, and then every price on a
-- Client's screen is labelled with the wrong symbol. A wrong currency
-- symbol is a money bug, not a formatting one: it turns 100 into
-- 100 ringgit.
--
-- Why a function and not a view
-- -----------------------------
-- A view cannot take an argument, so a "one row per Supplier" view
-- would hand back EVERY Supplier's currency in one request. That is
-- exactly the kind of harmless-looking leak this app is built to avoid.
--
-- The function takes no caller identity as an argument -- it reads
-- auth.uid(), which Supabase sets from the login token and which the
-- browser cannot forge. So it can only ever answer for the person
-- making the request.
--
-- The client has confirmed Rupiah (IDR) as the currency, so this returns
-- 'IDR' for every real account today. That is not the point. The point
-- is that the app now READS the currency instead of ASSUMING it, so the
-- day a second Supplier trades in another currency there is nothing to
-- change but the one row in supplier_settings.
--
-- The comment below is plain English on purpose. It is the kind of note
-- that stops a future reader "simplifying" the function into a view.
-- ===================================================================

create or replace function public.my_currency()
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (
      select s.currency
        from public.profiles p
        join public.supplier_settings s
          on s.supplier_id = coalesce(p.supplier_id, p.id)
       where p.id = auth.uid()
    ),
    'IDR'
  );
$$;

comment on function public.my_currency() is
  'The currency of the caller''s own Supplier. Returns IDR for a Super
   Admin, who belongs to no Supplier, and for anyone signed out. Never
   accepts a supplier id as an argument.';

-- One value, the caller's own. Granting execute is all that is needed:
-- the function reads the settings table as its owner, so a caller does
-- not need read access to supplier_settings itself. That is the whole
-- point -- it is how the value gets out without the backorder setting
-- getting out with it.
grant execute on function public.my_currency() to authenticated;

-- -------------------------------------------------------------------
-- A tripwire, so the leak cannot creep back in
-- -------------------------------------------------------------------
-- This exists because the failure it guards against is invisible. If
-- somebody later decides the Client screens need one more setting and
-- widens this function to return a table, or switches it to accept a
-- supplier id, the app still works and still looks right -- and every
-- price is now in the wrong currency. Only a test notices.
--
-- Same shape as the tripwires in migrations 008, 012 and 013.
create or replace function public.assert_currency_function_is_narrow()
returns void
language plpgsql
as $$
declare
  v_shape text;
begin
  -- Two properties, and both matter.
  --
  --   pronargs = 0        it takes no supplier id from the browser.
  --                       An argument here would mean trusting a client
  --                       about whose currency to hand back, which is the
  --                       exact mistake this function was written to
  --                       avoid.
  --
  --   returns 'text'      it hands back one currency code and nothing
  --                       else. If it ever returns a row, that row is a
  --                       settings row, and the backorder setting leaves
  --                       with it.
  select 'takes ' || p.pronargs::text || ' argument(s), returns '
         || pg_get_function_result(p.oid)
    into v_shape
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'my_currency';

  if v_shape is null then
    raise exception 'my_currency() is missing. Migration 015 did not run.';
  end if;

  if v_shape is distinct from 'takes 0 argument(s), returns text' then
    raise exception
      'my_currency() has changed shape: %. It must take no argument and return one text value.',
      v_shape;
  end if;
end;
$$;

comment on function public.assert_currency_function_is_narrow() is
  'Test tripwire. Fails if my_currency() ever grows an argument or stops
   returning a single text value. Called by supabase/tests/rls_tests.sql.';

-- Not for the browser, same as the other three tripwires. It is a
-- checking tool, and handing it to signed-in users would let anybody
-- probe it.
revoke all on function public.assert_currency_function_is_narrow() from public, anon, authenticated;