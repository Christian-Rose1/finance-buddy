-- Restrict direct purchase mutations while preserving the two narrow,
-- authenticated server workflows used for customer confirmations.

begin;

revoke update, delete on table public.purchases
  from public, anon, authenticated;
revoke update, delete on table public.purchase_items
  from public, anon, authenticated;
revoke update, delete on table public.purchase_evidence
  from public, anon, authenticated;

create or replace function public.confirm_purchase_card(
  p_purchase_id uuid,
  p_card_id uuid
)
returns public.purchases
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_purchase public.purchases;
  v_provenance jsonb;
begin
  if auth.uid() is null then
    raise exception 'confirm_purchase_card: authentication required';
  end if;

  select purchase.*
    into v_purchase
  from public.purchases purchase
  where purchase.id = p_purchase_id
    and purchase.user_id = auth.uid()
  for update;

  if not found then
    raise exception 'confirm_purchase_card: purchase not found';
  end if;

  if p_card_id is not null and not exists (
    select 1
    from public.wallet_cards card
    where card.id = p_card_id
      and card.user_id = auth.uid()
      and card.active = true
  ) then
    raise exception 'confirm_purchase_card: wallet card is not active or not owned';
  end if;

  v_provenance := coalesce(v_purchase.provenance, '{}'::jsonb) - 'cardId';
  if p_card_id is not null then
    v_provenance := v_provenance || jsonb_build_object(
      'cardId', jsonb_build_object(
        'field', 'cardId',
        'origin', 'manual',
        'verificationStatus', 'verified',
        'method', 'user-card-confirmation',
        'evidenceIds', '[]'::jsonb,
        'confidence', null
      )
    );
  end if;

  update public.purchases
  set card_id = p_card_id,
      provenance = v_provenance
  where id = p_purchase_id
    and user_id = auth.uid()
  returning * into v_purchase;

  return v_purchase;
end;
$$;

revoke execute on function public.confirm_purchase_card(uuid, uuid)
  from public, anon;
grant execute on function public.confirm_purchase_card(uuid, uuid)
  to authenticated;

create or replace function public.confirm_purchase_booking_channel(
  p_purchase_id uuid,
  p_channel text
)
returns public.purchases
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_purchase public.purchases;
  v_metadata jsonb;
  v_provenance jsonb;
begin
  if auth.uid() is null then
    raise exception 'confirm_purchase_booking_channel: authentication required';
  end if;
  if p_channel is not null and p_channel <> 'chase_travel' then
    raise exception 'confirm_purchase_booking_channel: unsupported channel';
  end if;

  select purchase.*
    into v_purchase
  from public.purchases purchase
  where purchase.id = p_purchase_id
    and purchase.user_id = auth.uid()
  for update;

  if not found then
    raise exception 'confirm_purchase_booking_channel: purchase not found';
  end if;

  v_metadata := coalesce(v_purchase.metadata, '{}'::jsonb) - 'bookingChannel';
  v_provenance := coalesce(v_purchase.provenance, '{}'::jsonb) - 'bookingChannel';
  if p_channel is not null then
    v_metadata := v_metadata || jsonb_build_object(
      'bookingChannel', 'chase_travel'
    );
    v_provenance := v_provenance || jsonb_build_object(
      'bookingChannel', jsonb_build_object(
        'field', 'bookingChannel',
        'origin', 'manual',
        'verificationStatus', 'verified',
        'method', 'user-booking-channel-confirmation',
        'evidenceIds', '[]'::jsonb,
        'confidence', null
      )
    );
  end if;

  update public.purchases
  set metadata = v_metadata,
      provenance = v_provenance
  where id = p_purchase_id
    and user_id = auth.uid()
  returning * into v_purchase;

  return v_purchase;
end;
$$;

revoke execute on function public.confirm_purchase_booking_channel(uuid, text)
  from public, anon;
grant execute on function public.confirm_purchase_booking_channel(uuid, text)
  to authenticated;

commit;
