-- Harden ownership, idempotency, timestamps, saved-strategy integrity, and
-- upload limits without rewriting previously applied migrations.

begin;

-- ---------------------------------------------------------------------------
-- Cross-table ownership and duplicate prevention
-- ---------------------------------------------------------------------------

alter table public.goals
  add constraint goals_id_user_id_unique unique (id, user_id);

alter table public.goal_strategies
  add constraint goal_strategies_owned_goal_fkey
  foreign key (goal_id, user_id)
  references public.goals (id, user_id)
  on delete cascade;

alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_owned_goal_fkey
  foreign key (goal_id, user_id)
  references public.goals (id, user_id)
  on delete cascade;

alter table public.wallet_benefits
  add constraint wallet_benefits_card_product_unique
  unique (wallet_card_id, product_benefit_id),
  add constraint wallet_benefits_period_range_check
  check (
    period_start is null
    or period_end is null
    or period_end >= period_start
  );

alter table public.wallet_cards
  add constraint wallet_cards_last_four_digits_check
  check (last_four is null or last_four ~ '^[0-9]{4}$');

alter table public.goals
  add constraint goals_origin_not_empty_check
    check (cardinality(origin) > 0),
  add constraint goals_destinations_not_empty_check
    check (cardinality(destinations) > 0),
  add constraint goals_currency_format_check
    check (currency ~ '^[A-Z]{3}$');

alter table public.purchases
  add constraint purchases_currency_format_check
    check (currency is null or currency ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------
-- Idempotent purchase ingestion
-- ---------------------------------------------------------------------------

alter table public.purchases
  add column source_key text null,
  add constraint purchases_source_key_length_check
    check (
      source_key is null
      or (length(source_key) > 0 and octet_length(source_key) <= 512)
    );

create unique index purchases_user_source_key_unique
  on public.purchases (user_id, source, source_key)
  where source_key is not null;

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

  insert into public.purchases (
    user_id,
    merchant,
    date,
    amount,
    currency,
    category,
    source,
    source_confidence,
    source_key,
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
    v_source_key,
    nullif(p_purchase->>'card_id', ''),
    (p_purchase->>'discount')::numeric(12, 2),
    (p_purchase->>'tax')::numeric(12, 2),
    (p_purchase->>'tip')::numeric(12, 2),
    (p_purchase->>'fees')::numeric(12, 2),
    coalesce(p_purchase->'provenance', '{}'::jsonb),
    p_purchase->'metadata'
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

    return v_purchase;
  end if;

  if jsonb_array_length(p_items) > 0 then
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

  if jsonb_array_length(p_evidence) > 0 then
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

revoke execute on function public.persist_purchase(uuid, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.persist_purchase(uuid, jsonb, jsonb, jsonb)
  to authenticated;

create or replace function public.persist_purchases(
  p_user_id uuid,
  p_purchases jsonb
)
returns setof public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry jsonb;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'persist_purchases: p_user_id does not match the authenticated user';
  end if;

  if jsonb_typeof(p_purchases) is distinct from 'array' then
    raise exception 'persist_purchases: payload must be an array';
  end if;

  if jsonb_array_length(p_purchases) > 500 then
    raise exception 'persist_purchases: at most 500 purchases are allowed';
  end if;

  for v_entry in select value from jsonb_array_elements(p_purchases)
  loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or jsonb_typeof(v_entry->'purchase') is distinct from 'object'
      or jsonb_typeof(v_entry->'items') is distinct from 'array'
      or jsonb_typeof(v_entry->'evidence') is distinct from 'array' then
      raise exception 'persist_purchases: invalid purchase entry';
    end if;

    return query
      select *
      from public.persist_purchase(
        p_user_id,
        v_entry->'purchase',
        v_entry->'items',
        v_entry->'evidence'
      );
  end loop;
end;
$$;

revoke execute on function public.persist_purchases(uuid, jsonb)
  from public, anon;
grant execute on function public.persist_purchases(uuid, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Saved strategy integrity
-- ---------------------------------------------------------------------------

alter table public.goal_strategies
  add column integrity_required boolean not null default false,
  add column signature_version integer null,
  add column strategy_signature text null;

alter table public.goal_strategies
  alter column integrity_required set default true,
  add constraint goal_strategies_integrity_check
    check (
      (
        integrity_required = false
        and signature_version is null
        and strategy_signature is null
      )
      or
      (
        integrity_required = true
        and signature_version = 1
        and strategy_signature ~ '^[0-9a-f]{64}$'
      )
    );

drop policy if exists "goal_strategies_insert_own"
  on public.goal_strategies;
drop policy if exists "goal_strategies_update_own"
  on public.goal_strategies;

create policy "goal_strategies_insert_own" on public.goal_strategies
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and integrity_required = true
    and exists (
      select 1 from public.goals
      where goals.id = goal_strategies.goal_id
        and goals.user_id = auth.uid()
    )
  );

create policy "goal_strategies_update_own" on public.goal_strategies
  for update to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.goals
      where goals.id = goal_strategies.goal_id
        and goals.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and integrity_required = true
    and exists (
      select 1 from public.goals
      where goals.id = goal_strategies.goal_id
        and goals.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Database-owned updated_at values
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger purchases_set_updated_at
  before update on public.purchases
  for each row execute function public.set_updated_at();
create trigger wallet_cards_set_updated_at
  before update on public.wallet_cards
  for each row execute function public.set_updated_at();
create trigger card_products_set_updated_at
  before update on public.card_products
  for each row execute function public.set_updated_at();
create trigger earning_rules_set_updated_at
  before update on public.earning_rules
  for each row execute function public.set_updated_at();
create trigger product_benefits_set_updated_at
  before update on public.product_benefits
  for each row execute function public.set_updated_at();
create trigger wallet_benefits_set_updated_at
  before update on public.wallet_benefits
  for each row execute function public.set_updated_at();
create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();
create trigger reward_accounts_set_updated_at
  before update on public.reward_accounts
  for each row execute function public.set_updated_at();
create trigger goal_strategies_set_updated_at
  before update on public.goal_strategies
  for each row execute function public.set_updated_at();
create trigger goal_strategy_runs_set_updated_at
  before update on public.goal_strategy_runs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Private Storage bounds
-- ---------------------------------------------------------------------------

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  ]::text[]
where id = 'receipts';

update storage.buckets
set
  file_size_limit = 20971520,
  allowed_mime_types = array['application/pdf']::text[]
where id = 'statements';

commit;
