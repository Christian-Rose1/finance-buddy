-- Seed Chase Sapphire Preferred Product Benefit (MVP)
--
-- This migration seeds exactly ONE verified product benefit for the Chase
-- Sapphire Preferred card product:
--
--   $100 Annual Chase Travel Hotel Credit
--
-- Verified against official Chase sources on 2026-08-17.
--
-- Official source:
--   https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred
--
-- Qualifying condition (NOT simplified to a generic "travel credit"):
--   A statement credit for qualifying hotel stays purchased through Chase
--   Travel. The credit applies specifically to hotel accommodation booked via
--   Chase Travel, not to other travel purchases. It is automatically applied
--   as a statement credit, requires no activation, and renews on the account
--   anniversary each year.
--
-- Source quote (paraphrased from official Chase page):
--   "Up to $100 in statement credits for qualifying hotel stays purchased
--   through Chase Travel each account anniversary year."
--
-- NOTE: This seeds the shared product-level definition ONLY. No user-specific
-- (wallet_benefits) rows are created here. User benefit state is created
-- separately per user.
--
-- IMPORTANT: This is a seed migration. Apply it only after the product_benefits
-- schema migration (20260817160000_create_wallet_benefits.sql) has been
-- applied. Do not edit already-applied migrations.

begin;

-- ============================================================
-- Chase Sapphire Preferred — $100 Annual Chase Travel Hotel Credit
-- ============================================================

-- card_product_id 'e9f7c34f-dec8-4e43-acec-ee8d0b0ed90a' is the Chase Sapphire
-- Preferred product seeded in 20260816110000_seed_card_product_catalog.sql.
--
-- Qualifying condition: hotel accommodation purchased through Chase Travel.
-- Credit application: automatically applied as a statement credit.
-- Annual cycle: account-anniversary year.

insert into public.product_benefits (
  id,
  card_product_id,
  type,
  title,
  description,
  eligible_category,
  eligible_merchant,
  fixed_value,
  annual_limit,
  requires_activation,
  source,
  last_verified_at,
  active
)
values (
  '5e19b3d1-8a7c-4b2e-9d3a-4f5c6d7e8f90',
  'e9f7c34f-dec8-4e43-acec-ee8d0b0ed90a',
  'statement_credit',
  '$100 Annual Chase Travel Hotel Credit',
  'Earn up to $100 in statement credits each account anniversary year for qualifying hotel stays purchased through Chase Travel. The credit applies specifically to hotel accommodation booked through Chase Travel, and is automatically applied as a statement credit — no activation required.',
  'travel:hotels',
  null,
  100.00,
  100.00,
  false,
  'issuer_website',
  '2026-08-17T14:00:00Z'::timestamptz,
  true
)
on conflict (id) do nothing;

commit;