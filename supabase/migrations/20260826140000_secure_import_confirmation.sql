-- Make signed import drafts the only authenticated purchase-creation path.
--
-- Before this migration, an authenticated browser could bypass review through
-- direct INSERT policies or the JSON-taking persist_purchase(s) functions.
-- This migration moves import persistence behind confirm_import_draft, which
-- accepts only a claimed draft identity and writes the exact signed persistence
-- payload stored with that draft.
--
-- Deployment prerequisite: after applying this migration, a database owner
-- must place the same >=32-character IMPORT_DRAFT_SIGNING_SECRET used by the
-- application into finance_buddy_private.import_draft_signing_config. The
-- table and helper
-- functions are inaccessible to anon/authenticated roles. Until configured,
-- draft inserts and confirmations fail closed.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists finance_buddy_private;
revoke all on schema finance_buddy_private from public, anon, authenticated;

create table finance_buddy_private.import_draft_signing_config (
  singleton boolean primary key default true check (singleton),
  signing_secret text not null check (char_length(signing_secret) >= 32),
  created_at timestamptz not null default now()
);

revoke all on table finance_buddy_private.import_draft_signing_config
  from public, anon, authenticated;

comment on table finance_buddy_private.import_draft_signing_config is
  'One database-owner-provisioned import signing secret; must match the application IMPORT_DRAFT_SIGNING_SECRET.';

alter table public.import_drafts
  add column persistence_payload text null,
  add column claim_token uuid null,
  add column claim_expires_at timestamptz null;

alter table public.import_drafts
  drop constraint import_drafts_status_check,
  add constraint import_drafts_status_check
    check (status in ('pending', 'confirming', 'failed', 'confirmed', 'discarded')),
  add constraint import_drafts_persistence_payload_length_check
    check (
      persistence_payload is null
      or (
        length(persistence_payload) > 0
        and octet_length(persistence_payload) <= 1000000
      )
    ),
  add constraint import_drafts_claim_pairing_check
    check (
      (
        status = 'confirming'
        and claim_token is not null
        and claim_expires_at is not null
      )
      or
      (
        status <> 'confirming'
        and claim_token is null
        and claim_expires_at is null
      )
    );

create or replace function finance_buddy_private.import_draft_encoded_field(p_value text)
returns bytea
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select int4send(octet_length(convert_to(p_value, 'UTF8')))
    || convert_to(p_value, 'UTF8');
$$;

create or replace function finance_buddy_private.import_draft_timestamp(p_value timestamptz)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select to_char(
    p_value at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
$$;

create or replace function finance_buddy_private.import_draft_signature(
  p_id uuid,
  p_user_id uuid,
  p_kind text,
  p_status text,
  p_expires_at timestamptz,
  p_payload text,
  p_persistence_payload text,
  p_claim_token uuid,
  p_claim_expires_at timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, finance_buddy_private
as $$
declare
  v_secret text;
  v_message bytea;
begin
  select config.signing_secret
  into v_secret
  from finance_buddy_private.import_draft_signing_config config
  where config.singleton = true;

  if v_secret is null or char_length(v_secret) < 32 then
    raise exception 'Import draft signing is not configured.';
  end if;

  v_message :=
    finance_buddy_private.import_draft_encoded_field('finance-buddy/import-draft')
    || finance_buddy_private.import_draft_encoded_field('1')
    || finance_buddy_private.import_draft_encoded_field(p_id::text)
    || finance_buddy_private.import_draft_encoded_field(p_user_id::text)
    || finance_buddy_private.import_draft_encoded_field(p_kind)
    || finance_buddy_private.import_draft_encoded_field(p_status)
    || finance_buddy_private.import_draft_encoded_field(
      finance_buddy_private.import_draft_timestamp(p_expires_at)
    )
    || finance_buddy_private.import_draft_encoded_field(p_payload)
    || finance_buddy_private.import_draft_encoded_field(p_persistence_payload)
    || finance_buddy_private.import_draft_encoded_field(
      coalesce(p_claim_token::text, '')
    )
    || finance_buddy_private.import_draft_encoded_field(
      coalesce(
        finance_buddy_private.import_draft_timestamp(p_claim_expires_at),
        ''
      )
    );

  return encode(
    hmac(v_message, convert_to(v_secret, 'UTF8'), 'sha256'),
    'hex'
  );
end;
$$;

revoke all on function finance_buddy_private.import_draft_encoded_field(text)
  from public, anon, authenticated;
revoke all on function finance_buddy_private.import_draft_timestamp(timestamptz)
  from public, anon, authenticated;
revoke all on function finance_buddy_private.import_draft_signature(
  uuid, uuid, text, text, timestamptz, text, text, uuid, timestamptz
) from public, anon, authenticated;

create or replace function finance_buddy_private.verify_import_draft_signature()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, finance_buddy_private
as $$
begin
  if new.persistence_payload is null then
    raise exception 'Import draft persistence payload is required.';
  end if;

  if new.payload_signature is distinct from finance_buddy_private.import_draft_signature(
    new.id,
    new.user_id,
    new.kind,
    new.status,
    new.expires_at,
    new.payload,
    new.persistence_payload,
    new.claim_token,
    new.claim_expires_at
  ) then
    raise exception 'Import draft signature is invalid.';
  end if;

  return new;
end;
$$;

revoke all on function finance_buddy_private.verify_import_draft_signature()
  from public, anon, authenticated;

create trigger import_drafts_verify_signature
  before insert or update on public.import_drafts
  for each row execute function finance_buddy_private.verify_import_draft_signature();

drop policy if exists "purchases_insert_own" on public.purchases;
drop policy if exists "purchase_items_insert_own" on public.purchase_items;
drop policy if exists "purchase_evidence_insert_own" on public.purchase_evidence;

revoke insert on table public.purchases
  from public, anon, authenticated;
revoke insert on table public.purchase_items
  from public, anon, authenticated;
revoke insert on table public.purchase_evidence
  from public, anon, authenticated;

revoke execute on function public.persist_purchase(uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public.persist_purchases(uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.confirm_import_draft(
  p_draft_id uuid,
  p_claim_token uuid,
  p_payload_signature text
)
returns setof public.purchases
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, finance_buddy_private
as $$
declare
  v_draft public.import_drafts%rowtype;
  v_payload jsonb;
  v_entry jsonb;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'confirm_import_draft: authentication required';
  end if;

  select draft.*
  into v_draft
  from public.import_drafts draft
  where draft.id = p_draft_id
    and draft.user_id = auth.uid()
  for update;

  if not found then
    raise exception 'confirm_import_draft: draft not found';
  end if;

  if v_draft.status <> 'confirming'
    or v_draft.claim_token is distinct from p_claim_token
    or v_draft.claim_expires_at <= now()
    or v_draft.expires_at <= now()
    or v_draft.payload_signature is distinct from p_payload_signature
    or v_draft.persistence_payload is null
    or v_draft.payload_signature is distinct from finance_buddy_private.import_draft_signature(
      v_draft.id,
      v_draft.user_id,
      v_draft.kind,
      v_draft.status,
      v_draft.expires_at,
      v_draft.payload,
      v_draft.persistence_payload,
      v_draft.claim_token,
      v_draft.claim_expires_at
    ) then
    raise exception 'confirm_import_draft: draft is not valid for confirmation';
  end if;

  begin
    v_payload := v_draft.persistence_payload::jsonb;
  exception when others then
    raise exception 'confirm_import_draft: invalid stored payload';
  end;

  if jsonb_typeof(v_payload) is distinct from 'array' then
    raise exception 'confirm_import_draft: invalid stored payload';
  end if;

  v_count := jsonb_array_length(v_payload);
  if (v_draft.kind = 'receipt' and v_count <> 1)
    or (v_draft.kind = 'statement' and (v_count < 1 or v_count > 500)) then
    raise exception 'confirm_import_draft: invalid stored payload';
  end if;

  for v_entry in select value from jsonb_array_elements(v_payload)
  loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or jsonb_typeof(v_entry->'purchase') is distinct from 'object'
      or jsonb_typeof(v_entry->'items') is distinct from 'array'
      or jsonb_typeof(v_entry->'evidence') is distinct from 'array'
      or v_entry->'purchase'->>'source' is distinct from v_draft.kind then
      raise exception 'confirm_import_draft: invalid stored purchase';
    end if;

    return query
      select *
      from public.persist_purchase(
        v_draft.user_id,
        v_entry->'purchase',
        v_entry->'items',
        v_entry->'evidence'
      );
  end loop;

  update public.import_drafts
  set
    status = 'confirmed',
    claim_token = null,
    claim_expires_at = null,
    payload_signature = finance_buddy_private.import_draft_signature(
      v_draft.id,
      v_draft.user_id,
      v_draft.kind,
      'confirmed',
      v_draft.expires_at,
      v_draft.payload,
      v_draft.persistence_payload,
      null,
      null
    )
  where id = v_draft.id
    and user_id = v_draft.user_id
    and status = 'confirming'
    and claim_token = v_draft.claim_token;

  if not found then
    raise exception 'confirm_import_draft: confirmation state changed';
  end if;
end;
$$;

revoke execute on function public.confirm_import_draft(uuid, uuid, text)
  from public, anon;
grant execute on function public.confirm_import_draft(uuid, uuid, text)
  to authenticated;

commit;
