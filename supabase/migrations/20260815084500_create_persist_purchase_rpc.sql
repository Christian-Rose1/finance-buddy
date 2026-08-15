-- Atomic Purchase persistence RPC.
--
-- Source of truth:
--   - schema: supabase/migrations/20260814195500_create_purchases.sql
--   - mapping: lib/purchases/repository.ts
--
-- Provides a single Postgres function that inserts a Purchase, its items, and
-- its evidence inside ONE transaction. This is the server-side transaction
-- mechanism referenced by the TODO(transaction) in lib/purchases/repository.ts.
--
-- The function is SECURITY DEFINER so it can write to all three tables while
-- bypassing RLS. Ownership is enforced explicitly: p_user_id MUST equal
-- auth.uid(), otherwise the function raises. Execution is restricted to the
-- authenticated role.

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
    (p_purchase->>'sourceConfidence')::numeric(4, 3),
    nullif(p_purchase->>'cardId', ''),
    (p_purchase->>'discount')::numeric(12, 2),
    (p_purchase->>'tax')::numeric(12, 2),
    (p_purchase->>'tip')::numeric(12, 2),
    (p_purchase->>'fees')::numeric(12, 2),
    coalesce(p_purchase->'provenance', '{}'::jsonb),
    p_purchase->'metadata'
  )
  returning * into v_purchase;

  -- 2. Insert all purchase_items (empty array is a valid state).
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
revoke execute on function public.persist_purchase(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.persist_purchase(uuid, jsonb, jsonb, jsonb) to authenticated;

commit;