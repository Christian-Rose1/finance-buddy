-- Seed award-price benchmark rows produced by the Route B research lane
-- (`npm run research:award-benchmarks`, run 2026-09-10T14:54:00.449Z) and
-- ACCEPTED by human review of each row's quoted source:
--   1. Air Canada Aeroplan 60,000 business one-way
--      https://frequentmiler.com/best-uses-of-air-canada-aeroplan-points
--   2. Virgin Atlantic Flying Club 30,000 economy one-way (on Delta metal)
--      https://thepointsguy.com/loyalty-programs/points-lab-booking-delta-awards-with-virgin-atlantic
--   3. Air France-KLM Flying Blue 50,000 business one-way (floor)
--      https://thepointsguy.com/news/virgin-atlantic-flying-club-good-bad-changes
-- A fourth emitted candidate (57,500 Flying Blue business) was REJECTED in
-- review — the figure belongs to American AAdvantage — and is deliberately
-- absent. These are planning benchmarks from cited sources, not live
-- availability; rows carry no award-availability claims.
-- Idempotent: existing rows are skipped (not-exists guard), matching the
-- emitted seed-SQL contract reviewed by the human reviewer.

begin;

insert into public.award_price_benchmarks
  (reward_program_id, redemption_type, origin_region, destination_region, cabin,
   pricing_basis, points_required, cash_fees, currency, traveler_count_covered,
   night_count_covered, valid_from, valid_until, source, last_verified_at, active)
select
  rp.id, 'flight', v.origin_region, v.destination_region, v.cabin,
  v.pricing_basis, v.points_required, v.cash_fees, v.currency, v.traveler_count_covered,
  null, now(), null, v.source, v.last_verified_at::timestamptz, true
from (
  values
    (
      'Air Canada Aeroplan', -- [...] While Air Canada Aeroplan awards to Europe can get pricey from the west coast, they can be a solid deal from the east coast given that routes like New York or Boston to Frankfurt, London, Paris, Zurich, Geneva, and Barcelona all cost just 60K miles one-way in business class.
      'us_domestic', 'transatlantic_europe', 'business',
      'one_way', 60000, null::numeric, 'USD',
      1, 'https://frequentmiler.com/best-uses-of-air-canada-aeroplan-points',
      '2026-09-10T14:54:00.449Z'
    ),
    (
      'Virgin Atlantic Flying Club', -- Virgin Atlantic will charge 30,000 miles for one-way nonstop economy awards from the US to Europe on Delta, and that number doesn''t change.
      'us_domestic', 'transatlantic_europe', 'economy',
      'one_way', 30000, null::numeric, 'USD',
      1, 'https://thepointsguy.com/loyalty-programs/points-lab-booking-delta-awards-with-virgin-atlantic',
      '2026-09-10T14:54:00.449Z'
    ),
    (
      'Air France-KLM Flying Blue', -- This is an astonishing price point as even popular programs like Air France-KLM''s Flying Blue start from 50,000 miles when booking a one-way business-class seat from the U.S. to Europe.
      'us_domestic', 'transatlantic_europe', 'business',
      'one_way', 50000, null::numeric, 'USD',
      1, 'https://thepointsguy.com/news/virgin-atlantic-flying-club-good-bad-changes',
      '2026-09-10T14:54:00.449Z'
    )
) as v(program_name, origin_region, destination_region, cabin, pricing_basis, points_required, cash_fees, currency, traveler_count_covered, source, last_verified_at)
join public.reward_programs rp on lower(rp.name) = lower(v.program_name)
where not exists (
  select 1 from public.award_price_benchmarks b
  where b.reward_program_id = rp.id
    and b.origin_region = v.origin_region
    and b.destination_region = v.destination_region
    and b.cabin = v.cabin
    and b.pricing_basis = v.pricing_basis
    and b.points_required = v.points_required
);

commit;
