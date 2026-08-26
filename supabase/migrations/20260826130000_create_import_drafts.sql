-- Store short-lived, signed receipt and statement review drafts. Parsed
-- purchases are written only after the customer explicitly confirms a draft.
-- HMAC verification in application code is the payload-integrity boundary;
-- ownership RLS alone does not make browser-writable data trustworthy.

begin;

create table public.import_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  signature_version integer not null default 1,
  kind text not null,
  status text not null default 'pending',
  payload text not null,
  payload_signature text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint import_drafts_signature_version_check
    check (signature_version = 1),
  constraint import_drafts_kind_check
    check (kind in ('receipt', 'statement')),
  constraint import_drafts_status_check
    check (status in ('pending', 'confirmed', 'discarded')),
  constraint import_drafts_payload_length_check
    check (length(payload) > 0 and octet_length(payload) <= 1000000),
  constraint import_drafts_payload_signature_hex_check
    check (payload_signature ~ '^[0-9a-f]{64}$'),
  constraint import_drafts_expires_after_created_check
    check (expires_at > created_at)
);

create index import_drafts_user_created_idx
  on public.import_drafts (user_id, created_at desc);

create index import_drafts_expires_at_idx
  on public.import_drafts (expires_at);

create trigger import_drafts_set_updated_at
  before update on public.import_drafts
  for each row execute function public.set_updated_at();

alter table public.import_drafts enable row level security;

create policy "import_drafts_select_own" on public.import_drafts
  for select to authenticated
  using (user_id = auth.uid());

create policy "import_drafts_insert_own" on public.import_drafts
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "import_drafts_update_own" on public.import_drafts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "import_drafts_delete_own" on public.import_drafts
  for delete to authenticated
  using (user_id = auth.uid());

commit;
