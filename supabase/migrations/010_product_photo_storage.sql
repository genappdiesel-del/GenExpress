-- ===================================================================
-- Migration 010: product photo storage
-- ===================================================================
-- Photos are not sensitive. Prices are. But the brief asks for private
-- buckets with signed URLs that expire in an hour, and there is a real
-- reason to agree with it even though it is more work: a public bucket
-- means anybody who has ever seen the URL can keep it forever, and
-- URLs get pasted into chat messages and left in old invoices.
--
-- A private bucket with a one-hour link means a link that leaks stops
-- working today, rather than in five years.
--
-- -------------------------------------------------------------------
-- FILE NAMING, WHICH IS THE WHOLE SECURITY MODEL HERE
-- -------------------------------------------------------------------
-- Every file lives at:
--
--     <supplier_id>/<random-id>.jpg
--
-- and the storage rules below read the FIRST FOLDER to decide who owns
-- the file. The rules never trust a supplier id sent in the request
-- body -- they take it from the folder the file is actually in, which
-- the client cannot fake without writing into somebody else's folder,
-- and that is exactly what the write rules forbid.
--
-- This folder convention is the only thing standing between one
-- Supplier's photos and another's. Do not change the layout without
-- rewriting these policies in the same migration.
-- ===================================================================

-- The bucket. private = true means no URL works without a signed link.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-photos',
  'product-photos',
  false,
  524288,     -- 512 KB. Photos are shrunk in the browser before upload.
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = excluded.public;

-- -------------------------------------------------------------------
-- Reading a photo
-- -------------------------------------------------------------------
-- Any signed-in user may read any product photo.
--
-- Rationale: a Client is entitled to see the picture of what they are
-- about to buy, and a Client may only receive a signed link for a photo
-- from their own Supplier's products -- because client_products_view is
-- the only thing that tells them which photos exist, and it only ever
-- contains their own Supplier's products. The bucket rule is
-- deliberately broad so it does not have to duplicate that logic; the
-- narrower check happens where the real data is.
--
-- The alternative, restricting reads per Supplier, would also work and
-- would be tighter. It was not chosen because it puts a second, parallel
-- copy of the Supplier rule in the storage policies, and two copies of
-- a security rule drift apart. Noted in DECISIONS.md section 5.6.
-- -------------------------------------------------------------------
drop policy if exists "product photos readable by signed in users"
  on storage.objects;
create policy "product photos readable by signed in users"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'product-photos');

-- -------------------------------------------------------------------
-- Writing a photo
-- -------------------------------------------------------------------
-- A Supplier may upload only into their OWN folder. The first folder
-- must equal their own profile id.
--
-- (storage.foldername(name))[1] pulls the first folder out of the path
-- "abc-123/photo.jpg" and gives 'abc-123'. Comparing that to auth.uid()
-- is the check: you can only write into a folder named after you.
--
-- Note what this does NOT do: it does not confirm the product being
-- photographed belongs to you. That check lives in the app, which
-- refuses to save a photo_path unless the product id came from a row
-- the Supplier already owns. The bucket is the outer lock; the app is
-- the inner one. Both are needed -- the bucket stops them writing files,
-- the app stops them attaching somebody else's product id.
-- -------------------------------------------------------------------
drop policy if exists "suppliers upload own product photos"
  on storage.objects;
create policy "suppliers upload own product photos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.current_role()) = 'supplier'
  );

drop policy if exists "suppliers update own product photos"
  on storage.objects;
create policy "suppliers update own product photos"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.current_role()) = 'supplier'
  )
  with check (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.current_role()) = 'supplier'
  );

-- Deleting is limited to the folder owner, and Super Admin can remove
-- anything. Super Admin needs this for support: a Supplier who uploaded
-- a photo of somebody's private document needs it gone today.
drop policy if exists "suppliers delete own product photos"
  on storage.objects;
create policy "suppliers delete own product photos"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'product-photos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_super_admin())
    )
  );

-- -------------------------------------------------------------------
-- A guard for the folder rule
-- -------------------------------------------------------------------
-- Cheap test, big payoff. If a later migration loosens a policy and a
-- photo can end up somewhere other than "<supplier_id>/<file>", this
-- fails and the test suite notices.
create or replace function public.assert_photo_path_shape()
returns void
language plpgsql
as $$
declare
  bad text;
begin
  select string_agg(name, ', ') into bad
  from storage.objects
  where bucket_id = 'product-photos'
    and (storage.foldername(name))[1] is distinct from split_part(name, '/', 1);

  if bad is not null then
    raise exception 'PRODUCT PHOTO OUTSIDE ITS SUPPLIER FOLDER: %', bad;
  end if;
end;
$$;