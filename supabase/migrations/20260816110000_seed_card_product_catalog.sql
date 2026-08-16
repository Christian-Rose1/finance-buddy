-- Seed Card Product Catalog (MVP)
--
-- This migration seeds a small, verified set of card products and earning rules
-- for MVP testing. All facts were verified against official issuer websites on
-- 2026-08-16. This seed is intentionally minimal: no benefits, offers, caps,
-- activation, geography, or channel-specific rules are included.
--
-- Rules intentionally omitted from this seed:
--   - Chase Freedom Unlimited 5% Chase Travel: requires a channel/booking-source
--     restriction the current evaluator does not support.
--   - Chase Sapphire Preferred 5% Chase Travel, 2% other travel, and 3% online
--     grocery/streaming: require channel, merchant, and conditional exclusions
--     the current evaluator does not support.
--   - American Express Gold 4X U.S. supermarkets: requires merchant-category
--     exclusions the current substring merchant matcher cannot reliably enforce.
--
-- IMPORTANT: This is a seed migration. Apply it only after the catalog schema
-- migration (20260816104000_create_card_product_catalog.sql) has been applied.
-- Do not edit already-applied migrations.

begin;

-- ============================================================
-- Reward programs
-- ============================================================

insert into public.reward_programs (id, name, currency, family, source, last_verified_at, metadata)
values (
  '0eed418a-7352-41a3-bed2-fbde756bc416',
  'Chase Ultimate Rewards',
  'points',
  'bank_points',
  'issuer_website',
  '2026-08-16T10:50:00Z'::timestamptz,
  '{"source_url": "https://creditcards.chase.com/rewards-credit-cards"}'::jsonb
)
on conflict (id) do nothing;

insert into public.reward_programs (id, name, currency, family, source, last_verified_at, metadata)
values (
  'ca119f69-fa6f-4a7a-bf5b-06e12f2d0028',
  'Citi ThankYou Points',
  'points',
  'bank_points',
  'issuer_website',
  '2026-08-16T10:50:00Z'::timestamptz,
  '{"source_url": "https://www.citi.com/credit-cards/citi-double-cash-credit-card"}'::jsonb
)
on conflict (id) do nothing;

insert into public.reward_programs (id, name, currency, family, source, last_verified_at, metadata)
values (
  '4a17567d-f1f1-411c-8d58-626e6128c9d7',
  'American Express Membership Rewards',
  'points',
  'bank_points',
  'issuer_website',
  '2026-08-16T10:50:00Z'::timestamptz,
  '{"source_url": "https://www.americanexpress.com/us/credit-cards/card/gold-card/"}'::jsonb
)
on conflict (id) do nothing;

-- ============================================================
-- Card products
-- ============================================================

insert into public.card_products (
  id, reward_program_id, issuer, name, network, active, annual_fee, source, last_verified_at, metadata
)
values (
  'a47f30bd-a798-4243-b770-18b02bcd4941',
  '0eed418a-7352-41a3-bed2-fbde756bc416',
  'Chase',
  'Chase Freedom Unlimited',
  'visa',
  true,
  0.00,
  'issuer_website',
  '2026-08-16T10:50:00Z'::timestamptz,
  jsonb_build_object(
    'source_url', 'https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited',
    'annual_fee_note', 'No annual fee',
    'verified_by', 'official Chase credit card product page'
  )
)
on conflict (issuer, name) do nothing;

insert into public.card_products (
  id, reward_program_id, issuer, name, network, active, annual_fee, source, last_verified_at, metadata
)
values (
  'e9f7c34f-dec8-4e43-acec-ee8d0b0ed90a',
  '0eed418a-7352-41a3-bed2-fbde756bc416',
  'Chase',
  'Chase Sapphire Preferred',
  'visa',
  true,
  95.00,
  'issuer_website',
  '2026-08-16T11:25:00Z'::timestamptz,
  jsonb_build_object(
    'source_url', 'https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred',
    'annual_fee_note', '$95 annual fee',
    'verified_by', 'official Chase Sapphire Preferred product page'
  )
)
on conflict (issuer, name) do nothing;

insert into public.card_products (
  id, reward_program_id, issuer, name, network, active, annual_fee, source, last_verified_at, metadata
)
values (
  'f2bbdba4-57f2-4841-b3dd-09646376f0ff',
  'ca119f69-fa6f-4a7a-bf5b-06e12f2d0028',
  'Citi',
  'Citi Double Cash Card',
  'mastercard',
  true,
  0.00,
  'issuer_website',
  '2026-08-16T10:50:00Z'::timestamptz,
  jsonb_build_object(
    'source_url', 'https://www.citi.com/credit-cards/citi-double-cash-credit-card',
    'annual_fee_note', 'No annual fee',
    'verified_by', 'official Citi credit card product page'
  )
)
on conflict (issuer, name) do nothing;

insert into public.card_products (
  id, reward_program_id, issuer, name, network, active, annual_fee, source, last_verified_at, metadata
)
values (
  'a0cda9e6-c45d-4926-8ad0-fe5fd18f5dc3',
  '4a17567d-f1f1-411c-8d58-626e6128c9d7',
  'American Express',
  'American Express Gold Card',
  'amex',
  true,
  325.00,
  'issuer_website',
  '2026-08-16T10:50:00Z'::timestamptz,
  jsonb_build_object(
    'source_url', 'https://www.americanexpress.com/us/credit-cards/card/gold-card/',
    'annual_fee_note', '$325 annual fee for a Basic Card',
    'verified_by', 'official American Express Gold Card product page'
  )
)
on conflict (issuer, name) do nothing;

-- ============================================================
-- Earning rules
-- ============================================================

-- Chase Freedom Unlimited
-- Source: https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited
-- Verified: 2026-08-16

insert into public.earning_rules (
  id, card_product_id, type, eligible_category, eligible_merchant, excluded_merchants,
  reward_currency, reward_value, percentage, fixed_value, explanation, source, last_verified_at, metadata
)
values (
  '49b32f63-995f-4427-814a-65d527d5b5ef',
  'a47f30bd-a798-4243-b770-18b02bcd4941',
  'earning_rate',
  'food:dining',
  null,
  '{}',
  'cashback',
  0,
  3.0000,
  null,
  'Earn 3% cash back on dining at restaurants, including takeout and eligible delivery services.',
  'issuer_website',
  '2026-08-16T10:50:00Z'::timestamptz,
  jsonb_build_object(
    'source_url', 'https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited',
    'source_quote', 'Earn 3% on dining at restaurants, including takeout and eligible delivery services.'
  )
)
on conflict (id) do nothing;

insert into public.earning_rules (
  id, card_product_id, type, eligible_category, eligible_merchant, excluded_merchants,
  reward_currency, reward_value, percentage, fixed_value, explanation, source, last_verified_at, metadata
)
values (
  '28e63344-2957-42b0-9657-272a6cd77b23',
  'a47f30bd-a798-4243-b770-18b02bcd4941',
  'earning_rate',
  'health:pharmacy',
  null,
  '{}',
  'cashback',
  0,
  3.0000,
  null,
  'Earn 3% cash back on drugstore purchases.',
  'issuer_website',
  '2026-08-16T10:50:00Z'::timestamptz,
  jsonb_build_object(
    'source_url', 'https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited',
    'source_quote', 'Earn 3% on drugstore purchases.'
  )
)
on conflict (id) do nothing;

insert into public.earning_rules (
  id, card_product_id, type, eligible_category, eligible_merchant, excluded_merchants,
  reward_currency, reward_value, percentage, fixed_value, explanation, source, last_verified_at, metadata
)
values (
  '781f0704-ad25-4366-b509-e5a523b3a949',
  'a47f30bd-a798-4243-b770-18b02bcd4941',
  'earning_rate',
  'other',
  null,
  '{}',
  'cashback',
  0,
  1.5000,
  null,
  'Earn unlimited 1.5% cash back on all other purchases.',
  'issuer_website',
  '2026-08-16T10:50:00Z'::timestamptz,
  jsonb_build_object(
    'source_url', 'https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited',
    'source_quote', 'Earn unlimited 1.5% cash back or more on all purchases... Earn 1.5% on all other purchases.'
  )
)
on conflict (id) do nothing;

-- Chase Sapphire Preferred
-- Source: https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred
-- Verified: 2026-08-16

insert into public.earning_rules (
  id, card_product_id, type, eligible_category, eligible_merchant, excluded_merchants,
  reward_currency, reward_value, percentage, fixed_value, explanation, source, last_verified_at, metadata
)
values (
  'a329939c-3c7d-4438-aca3-2eae3f154a0e',
  'e9f7c34f-dec8-4e43-acec-ee8d0b0ed90a',
  'earning_rate',
  'food:dining',
  null,
  '{}',
  'points',
  3.0000,
  null,
  null,
  'Earn 3 points per $1 on dining at restaurants, including takeout and eligible delivery services.',
  'issuer_website',
  '2026-08-16T11:25:00Z'::timestamptz,
  jsonb_build_object(
    'source_url', 'https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred',
    'source_quote', '3x points on dining at restaurants including takeout and eligible delivery services.'
  )
)
on conflict (id) do nothing;

insert into public.earning_rules (
  id, card_product_id, type, eligible_category, eligible_merchant, excluded_merchants,
  reward_currency, reward_value, percentage, fixed_value, explanation, source, last_verified_at, metadata
)
values (
  '38ba31b6-01a2-4351-b6d2-635ab7db6d1b',
  'e9f7c34f-dec8-4e43-acec-ee8d0b0ed90a',
  'earning_rate',
  'other',
  null,
  '{}',
  'points',
  1.0000,
  null,
  null,
  'Earn 1 point per $1 on all other purchases.',
  'issuer_website',
  '2026-08-16T11:25:00Z'::timestamptz,
  jsonb_build_object(
    'source_url', 'https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred',
    'source_quote', '1X points on all other purchases.'
  )
)
on conflict (id) do nothing;

-- Citi Double Cash Card
-- Source: https://www.citi.com/credit-cards/citi-double-cash-credit-card
-- Verified: 2026-08-16

insert into public.earning_rules (
  id, card_product_id, type, eligible_category, eligible_merchant, excluded_merchants,
  reward_currency, reward_value, percentage, fixed_value, explanation, source, last_verified_at, metadata
)
values (
  '578dd149-671f-4d5a-96e0-429c9f6915fd',
  'f2bbdba4-57f2-4841-b3dd-09646376f0ff',
  'earning_rate',
  'other',
  null,
  '{}',
  'cashback',
  0,
  2.0000,
  null,
  'Earn 2% cash back on purchases: 1% when you buy and an additional 1% as you pay for those purchases.',
  'issuer_website',
  '2026-08-16T10:50:00Z'::timestamptz,
  jsonb_build_object(
    'source_url', 'https://www.citi.com/credit-cards/citi-double-cash-credit-card',
    'source_quote', 'Earn 2% cash back on purchases: 1% when you buy and 1% as you pay.',
    'note', 'Citi awards cash back as ThankYou Points: 1 point per $1 spent when you buy, plus 1 point per $1 paid. The MVP optimizer represents this as 2% cashback because ThankYou Points carry cash-equivalent redemption value; future point-balance accounting should model the underlying 2 ThankYou Points per $1.'
  )
)
on conflict (id) do nothing;

-- American Express Gold Card
-- Source: https://www.americanexpress.com/us/credit-cards/card/gold-card/
-- Verified: 2026-08-16

insert into public.earning_rules (
  id, card_product_id, type, eligible_category, eligible_merchant, excluded_merchants,
  reward_currency, reward_value, percentage, fixed_value, explanation, source, last_verified_at, metadata
)
values (
  'e00ee2f1-cbe8-42b4-927b-1180a87b3f58',
  'a0cda9e6-c45d-4926-8ad0-fe5fd18f5dc3',
  'earning_rate',
  'food:dining',
  null,
  '{}',
  'points',
  4.0000,
  null,
  null,
  'Earn 4X Membership Rewards points on purchases at restaurants worldwide, on up to $50,000 in purchases per calendar year, then 1X points for the rest of the year.',
  'issuer_website',
  '2026-08-16T10:50:00Z'::timestamptz,
  jsonb_build_object(
    'source_url', 'https://www.americanexpress.com/us/credit-cards/card/gold-card/',
    'source_quote', 'Earn 4X Membership Rewards® points per dollar spent on purchases at restaurants worldwide, on up to $50,000 in purchases per calendar year, then 1X points for the rest of the year.'
  )
)
on conflict (id) do nothing;

insert into public.earning_rules (
  id, card_product_id, type, eligible_category, eligible_merchant, excluded_merchants,
  reward_currency, reward_value, percentage, fixed_value, explanation, source, last_verified_at, metadata
)
values (
  'f759d616-aa50-46ad-b96c-eb48af855bd5',
  'a0cda9e6-c45d-4926-8ad0-fe5fd18f5dc3',
  'earning_rate',
  'travel:airfare',
  null,
  '{}',
  'points',
  3.0000,
  null,
  null,
  'Earn 3X Membership Rewards points on flights booked through AmexTravel.com or the Amex Travel App, or purchased directly from airlines.',
  'issuer_website',
  '2026-08-16T10:50:00Z'::timestamptz,
  jsonb_build_object(
    'source_url', 'https://www.americanexpress.com/us/credit-cards/card/gold-card/',
    'source_quote', 'Earn 3X Membership Rewards® points per dollar spent on flights booked through AmexTravel.com or the Amex Travel App or purchased directly from airlines.'
  )
)
on conflict (id) do nothing;

insert into public.earning_rules (
  id, card_product_id, type, eligible_category, eligible_merchant, excluded_merchants,
  reward_currency, reward_value, percentage, fixed_value, explanation, source, last_verified_at, metadata
)
values (
  'a067c89f-0cd6-4926-b353-e24d4a737871',
  'a0cda9e6-c45d-4926-8ad0-fe5fd18f5dc3',
  'earning_rate',
  'other',
  null,
  '{}',
  'points',
  1.0000,
  null,
  null,
  'Earn 1X Membership Rewards point on all other eligible purchases.',
  'issuer_website',
  '2026-08-16T10:50:00Z'::timestamptz,
  jsonb_build_object(
    'source_url', 'https://www.americanexpress.com/us/credit-cards/card/gold-card/',
    'source_quote', 'Earn 1X Membership Rewards® point per dollar spent on all other eligible purchases.'
  )
)
on conflict (id) do nothing;

commit;
