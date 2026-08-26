-- Allow issuer-neutral CSV statement exports in the existing private bucket.
-- Existing ownership policies and the 20 MiB bucket limit remain unchanged.

begin;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'text/csv',
  'application/csv',
  'text/comma-separated-values',
  'application/vnd.ms-excel'
]::text[]
where id = 'statements';

commit;
