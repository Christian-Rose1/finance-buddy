-- Migration: create private user-isolated Storage buckets for raw receipts and statements.
--
-- Buckets are private (not public). Files are stored under a user-id prefix so
-- RLS policies can enforce per-user isolation on storage.objects.
--
-- Expected object path format after application changes:
--   <user_id>/<timestamp-uuid>-<filename>
--
-- e.g. receipts/  a1b2c3d4-.../1723700000000-uuid-receipt.jpg
--      statements/ a1b2c3d4-.../1723700000000-uuid-statement.pdf

-- Private bucket for raw receipt images and PDFs.
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

-- Private bucket for raw statement PDFs.
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
create policy "receipts_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Receipts: authenticated users may insert only into their own folder.
create policy "receipts_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Receipts: authenticated users may update only their own objects.
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
create policy "receipts_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Statements: authenticated users may select only their own objects.
create policy "statements_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Statements: authenticated users may insert only into their own folder.
create policy "statements_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Statements: authenticated users may update only their own objects.
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
create policy "statements_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'statements'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
