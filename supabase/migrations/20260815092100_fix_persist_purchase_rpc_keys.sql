-- Fix persist_purchase RPC to expect the repository's snake_case JSON keys.
--
-- lib/purchases/repository.ts intentionally sends snake_case keys in the
-- p_purchase payload (source_confidence, card_id, ...). The original RPC
-- (20260815084500) read camelCase keys (sourceConfidence, cardId), which
-- caused source_confidence to be NULL and violate the NOT NULL constraint.
--
-- This migration recreates the function to read snake_case keys. All other
-- behavior is preserved:
--   - atomic transaction (single function body)
--   - p_user_id must equal auth.uid()
--   - SECURITY DEFINER
--   - search_path = public
--   - authenticated-only execute (anon/public remain blocked)
--   - empty item/evidence arrays supported
--   - same return type (public.purchases)

begin;

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
begin
  -- Enforce ownership: the caller may only persist a Purchase for themselves.
  -- auth.uid() is NULL for unauthenticated/service-role callers, so this also
  -- blocks unauthenticated invocation.
  if p_user_id is distinct from auth.uid() then
    raise exception 'persist_purchase: p_user_id does not match the authenticated user';
  end if;

  -- 1. Insert the parent Purchase. user_id comes ONLY from p_user_id.
  --    Keys are snake_case, matching lib/purchases/repository.ts.
  insert into public.purchases (
    user_id,
    merchant,
    date,
    amount,
    currency,
    category,
    source,
    source_confidence,
    card_id,
    discount,
    tax,
    tip,
    fees,
    provenance,
    metadata
  )
  values (
    p_user_id,
    nullif(p_purchase->>'merchant', ''),
    nullif(p_purchase->>'date', '')::date,
    (p_purchase->>'amount')::numeric(12, 2),
    nullif(p_purchase->>'currency', ''),
    nullif(p_purchase->>'category', ''),
    p_purchase->>'source',
    (p_purchase->>'source_confidence')::numeric(4, 3),
    nullif(p_purchase->>'card_id', ''),
    (p_purchase->>'discount')::numeric(12, 2),
    (p_purchase->>'tax')::numeric(12, 2),
    (p_purchase->>'tip')::numeric(12, 2),
    (p_purchase->>'fees')::numeric(12, 2),
    coalesce(p_purchase->'provenance', '{}'::jsonb),
    p_purchase->'metadata'
  )
  returning * into v_purchase;

  -- 2. Insert all purchase_items (empty array is a valid state).
  --    Keys are snake_case, matching lib/purchases/repository.ts.
  if jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    insert into public.purchase_items (
      purchase_id,
      name,
      quantity,
      unit_price,
      total,
      discount,
      category,
      confidence
    )
    select
      v_purchase.id,
      nullif(r.name, ''),
      r.quantity::numeric(12, 4),
      r.unit_price::numeric(12, 2),
      r.total::numeric(12, 2),
      r.discount::numeric(12, 2),
      nullif(r.category, ''),
      r.confidence::numeric(4, 3)
    from jsonb_to_recordset(p_items) as r(
      name text,
      quantity numeric,
      unit_price numeric,
      total numeric,
      discount numeric,
      category text,
      confidence numeric
    );
  end if;

  -- 3. Insert all purchase_evidence (empty array is a valid state).
  --    Keys are snake_case, matching lib/purchases/repository.ts.
  if jsonb_typeof(p_evidence) = 'array' and jsonb_array_length(p_evidence) > 0 then
    insert into public.purchase_evidence (
      purchase_id,
      type,
      source_id,
      source_name,
      confidence,
      verified,
      metadata
    )
    select
      v_purchase.id,
      r.type,
      nullif(r.source_id, ''),
      nullif(r.source_name, ''),
      r.confidence::numeric(4, 3),
      coalesce(r.verified, false),
      r.metadata
    from jsonb_to_recordset(p_evidence) as r(
      type text,
      source_id text,
      source_name text,
      confidence numeric,
      verified boolean,
      metadata jsonb
    );
  end if;

  return v_purchase;
end;
$$;

-- Restrict execution to authenticated users only.
-- anon and public remain blocked (the earlier revoke from anon/public is
-- preserved because CREATE OR REPLACE FUNCTION does not reset ACLs).
revoke execute on function public.persist_purchase(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.persist_purchase(uuid, jsonb, jsonb, jsonb) to authenticated;

commit;