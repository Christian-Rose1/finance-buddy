-- Migration: recreate user Storage buckets and RLS policies (idempotent repair).
--
-- Background: on the project the app currently uses, the original bucket
-- migration (20260815031500_create_user_storage_buckets.sql) was never
-- applied — storage.buckets had no rows and uploads failed with
-- "Bucket not found" / RLS violations while every public-schema migration
-- was present. The buckets themselves were recreated via the Storage API on
-- 2026-08-25; this migration (re)establishes the full expected state:
--
--   - bucket rows: ON CONFLICT DO NOTHING, safe whether or not they exist
--   - policies: dropped before being recreated, safe against partial state
--
-- It is therefore safe to apply on ANY project regardless of whether the
-- original migration ran, and regardless of whether it is recorded in
-- supabase_migrations.schema_migrations.
--
-- Buckets are private (not public). Files are stored under a user-id prefix
-- so the RLS policies below enforce per-user isolation on storage.objects:
--   <bucket>/<user_id>/<timestamp-uuid>-<filename>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values (
  'receipts',
  'receipts',
  false,
  null,
  null,
  false
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
values (
  'statements',
  'statements',
  false,
  null,
  null,
  false
)
on conflict (id) do nothing;

-- Receipts: authenticated users may select only their own objects.
drop policy if exists "receipts_select_own" on storage.objects;
create policy "receipts_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Receipts: authenticated users may insert only into their own folder.
drop policy if exists "receipts_insert_own" on storage.objects;
create policy "receipts_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Receipts: authenticated users may update only their own objects.
drop policy if exists "receipts_update_own" on storage.objects;
create policy "receipts_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Receipts: authenticated users may delete only their own objects.
drop policy if exists "receipts_delete_own" on storage.objects;
create policy "receipts_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Statements: authenticated users may select only their own objects.
drop policy if exists "statements_select_own" on storage.objects;
create policy "statements_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Statements: authenticated users may insert only into their own folder.
drop policy if exists "statements_insert_own" on storage.objects;
create policy "statements_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Statements: authenticated users may update only their own objects.
drop policy if exists "statements_update_own" on storage.objects;
create policy "statements_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Statements: authenticated users may delete only their own objects.
drop policy if exists "statements_delete_own" on storage.objects;
create policy "statements_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
