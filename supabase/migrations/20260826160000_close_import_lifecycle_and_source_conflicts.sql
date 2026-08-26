-- Append-only integrity and lifecycle hardening after the import migrations.
-- This migration is intentionally fail-closed for legacy source-key rows whose
-- complete canonical envelope cannot be proven from normalized child tables.

begin;

alter table public.purchases
  add column source_envelope jsonb null,
  add constraint purchases_source_envelope_object_check
    check (source_envelope is null or jsonb_typeof(source_envelope) = 'object');

create or replace function public.persist_purchase(
  p_user_id uuid,
  p_purchase jsonb,
  p_items jsonb,
  p_evidence jsonb
)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase public.purchases;
  v_source_key text;
  v_envelope jsonb;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'persist_purchase: p_user_id does not match the authenticated user';
  end if;
  if jsonb_typeof(p_purchase) is distinct from 'object'
    or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_typeof(p_evidence) is distinct from 'array' then
    raise exception 'persist_purchase: invalid payload shape';
  end if;

  v_source_key := nullif(p_purchase->>'source_key', '');
  v_envelope := jsonb_build_object(
    'purchase', p_purchase,
    'items', p_items,
    'evidence', p_evidence
  );

  insert into public.purchases (
    user_id, merchant, date, amount, currency, category, source,
    source_confidence, source_key, source_envelope, card_id, discount,
    tax, tip, fees, provenance, metadata
  )
  values (
    p_user_id, nullif(p_purchase->>'merchant', ''),
    nullif(p_purchase->>'date', '')::date,
    (p_purchase->>'amount')::numeric(12, 2),
    nullif(p_purchase->>'currency', ''), nullif(p_purchase->>'category', ''),
    p_purchase->>'source', (p_purchase->>'source_confidence')::numeric(4, 3),
    v_source_key, v_envelope, nullif(p_purchase->>'card_id', ''),
    (p_purchase->>'discount')::numeric(12, 2),
    (p_purchase->>'tax')::numeric(12, 2),
    (p_purchase->>'tip')::numeric(12, 2),
    (p_purchase->>'fees')::numeric(12, 2),
    coalesce(p_purchase->'provenance', '{}'::jsonb), p_purchase->'metadata'
  )
  on conflict (user_id, source, source_key)
    where source_key is not null
    do nothing
  returning * into v_purchase;

  if v_purchase.id is null then
    select p.* into strict v_purchase
    from public.purchases p
    where p.user_id = p_user_id
      and p.source = p_purchase->>'source'
      and p.source_key = v_source_key;

    if v_purchase.source_envelope is null
      or v_purchase.source_envelope is distinct from v_envelope then
      raise exception 'persist_purchase: conflicting canonical source envelope';
    end if;
    return v_purchase;
  end if;

  if jsonb_array_length(p_items) > 0 then
    insert into public.purchase_items (
      purchase_id, name, quantity, unit_price, total, discount, category, confidence
    )
    select v_purchase.id, nullif(r.name, ''), r.quantity::numeric(12, 4),
      r.unit_price::numeric(12, 2), r.total::numeric(12, 2),
      r.discount::numeric(12, 2), nullif(r.category, ''), r.confidence::numeric(4, 3)
    from jsonb_to_recordset(p_items) as r(
      name text, quantity numeric, unit_price numeric, total numeric,
      discount numeric, category text, confidence numeric
    );
  end if;

  if jsonb_array_length(p_evidence) > 0 then
    -- The application supplies deterministic UUIDs so provenance.evidenceIds
    -- remains a valid reference to the persisted evidence row.
    insert into public.purchase_evidence (
      id, purchase_id, type, source_id, source_name, confidence, verified, metadata
    )
    select r.id, v_purchase.id, r.type, nullif(r.source_id, ''), nullif(r.source_name, ''),
      r.confidence::numeric(4, 3), coalesce(r.verified, false), r.metadata
    from jsonb_to_recordset(p_evidence) as r(
      id uuid, type text, source_id text, source_name text, confidence numeric,
      verified boolean, metadata jsonb
    );
  end if;
  return v_purchase;
end;
$$;

revoke execute on function public.persist_purchase(uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
-- No role grant: confirm_import_draft invokes this as its security-definer
-- owner, while direct authenticated purchase creation remains unavailable.

-- Remove stale review rows during normal maintenance. Storage objects are
-- removed by the authenticated discard/expiry path because SQL cannot safely
-- call the Storage API.
create or replace function public.cleanup_import_drafts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.import_drafts
  where (expires_at < now() and status in ('pending', 'failed', 'discarded'))
     or (status in ('confirmed', 'discarded') and updated_at < now() - interval '7 days');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_import_drafts() from public, anon, authenticated;
grant execute on function public.cleanup_import_drafts() to service_role;

-- Preserve ownership semantics while making purchase card references real.
do $$
begin
  if exists (
    select 1 from public.purchases
    where card_id is not null
      and card_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'Cannot add purchases.card_id foreign key: invalid legacy card ids exist';
  end if;
end;
$$;

alter table public.purchases
  alter column card_id type uuid using nullif(card_id, '')::uuid;

alter table public.purchases
  add constraint purchases_card_id_fkey
  foreign key (card_id) references public.wallet_cards(id) on delete set null;

commit;
