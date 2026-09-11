-- Award Benchmarks Foundation (R2, Route A)
--
-- Creates the shared, non-user-owned catalog tables that support verified
-- award-price planning benchmarks and airline transfer partners:
--
--   airport_region_map     - verified IATA airport -> route-region mapping
--   transfer_partners      - verified issuer transfer programs and ratios
--   award_price_benchmarks - verified published award-chart price rows
--
-- IMPORTANT TRUST RULES:
-- - These tables contain shared catalog data sourced by humans or a
--   documented research process, never user financial data.
-- - No award price rows are seeded here: no row is inserted without a
--   current primary-source verification. The transfer-partner and
--   airport-region seeds below cite their sources inline.
-- - Benchmarks are planning estimates only; they never encode availability.
-- - RLS mirrors the existing catalog idiom: authenticated read-only.

begin;

-- ============================================================
-- airport_region_map
-- ============================================================
create table public.airport_region_map (
  iata_code text primary key,
  region text not null,
  source text not null,
  last_verified_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint airport_region_map_iata_check
    check (iata_code ~ '^[A-Z]{3}$'),
  constraint airport_region_map_region_check
    check (region in (
      'us_domestic',
      'transatlantic_europe',
      'intra_europe',
      'caribbean_central_america',
      'south_america',
      'hawaii_pacific',
      'east_asia',
      'southeast_asia_oceania',
      'south_asia_middle_east',
      'africa',
      'canada',
      'mexico'
    ))
);

-- ============================================================
-- transfer_partners
-- ============================================================
create table public.transfer_partners (
  id uuid primary key default gen_random_uuid(),
  from_program_id uuid not null references public.reward_programs (id),
  to_program_id uuid not null references public.reward_programs (id),
  destination_points_per_source_point numeric(8,4) not null,
  source text not null,
  last_verified_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint transfer_partners_ratio_check
    check (destination_points_per_source_point > 0),
  constraint transfer_partners_no_self_transfer
    check (from_program_id <> to_program_id),
  constraint transfer_partners_pair_unique
    unique (from_program_id, to_program_id)
);

-- ============================================================
-- award_price_benchmarks
-- ============================================================
create table public.award_price_benchmarks (
  id uuid primary key default gen_random_uuid(),
  reward_program_id uuid not null references public.reward_programs (id),
  redemption_type text not null default 'flight',
  origin_region text not null,
  destination_region text not null,
  cabin text not null,
  pricing_basis text not null,
  points_required numeric(12,2) not null,
  cash_fees numeric(12,2) null,
  currency text not null,
  traveler_count_covered integer not null,
  night_count_covered integer null,
  valid_from timestamptz null,
  valid_until timestamptz null,
  source text not null,
  last_verified_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint award_price_benchmarks_type_check
    check (redemption_type in ('flight')),
  constraint award_price_benchmarks_origin_region_check
    check (origin_region in (
      'us_domestic','transatlantic_europe','intra_europe',
      'caribbean_central_america','south_america','hawaii_pacific',
      'east_asia','southeast_asia_oceania','south_asia_middle_east',
      'africa','canada','mexico'
    )),
  constraint award_price_benchmarks_destination_region_check
    check (destination_region in (
      'us_domestic','transatlantic_europe','intra_europe',
      'caribbean_central_america','south_america','hawaii_pacific',
      'east_asia','southeast_asia_oceania','south_asia_middle_east',
      'africa','canada','mexico'
    )),
  constraint award_price_benchmarks_cabin_check
    check (cabin in ('economy', 'premium_economy', 'business', 'first')),
  constraint award_price_benchmarks_basis_check
    check (pricing_basis in ('one_way', 'round_trip')),
  constraint award_price_benchmarks_points_check
    check (points_required > 0),
  constraint award_price_benchmarks_fees_check
    check (cash_fees is null or cash_fees > 0),
  constraint award_price_benchmarks_travelers_check
    check (traveler_count_covered > 0),
  constraint award_price_benchmarks_nights_check
    check (night_count_covered is null or night_count_covered > 0)
);

create index award_price_benchmarks_route_idx
  on public.award_price_benchmarks (origin_region, destination_region, cabin)
  where active;

-- ============================================================
-- Row level security (same idiom as the card-product catalog)
-- ============================================================
alter table public.airport_region_map enable row level security;
alter table public.transfer_partners enable row level security;
alter table public.award_price_benchmarks enable row level security;

create policy "airport_region_map_select_authenticated"
  on public.airport_region_map for select
  to authenticated
  using (true);

create policy "transfer_partners_select_authenticated"
  on public.transfer_partners for select
  to authenticated
  using (true);

create policy "award_price_benchmarks_select_authenticated"
  on public.award_price_benchmarks for select
  to authenticated
  using (true);

-- Restrict all writes on these catalog tables from ordinary authenticated access.
-- Application code must never insert/update/delete catalog rows.
create policy "airport_region_map_no_write"
  on public.airport_region_map
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

create policy "transfer_partners_no_write"
  on public.transfer_partners
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

create policy "award_price_benchmarks_no_write"
  on public.award_price_benchmarks
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

-- ============================================================
-- Seed: airport -> region mapping
-- ============================================================
-- Definitional geography (which region an airport is located in), not
-- pricing. Sourced from public IATA airport location data.
insert into public.airport_region_map (iata_code, region, source, last_verified_at) values
  ('DEN', 'us_domestic', 'IATA airport location registry', now()),
  ('JFK', 'us_domestic', 'IATA airport location registry', now()),
  ('EWR', 'us_domestic', 'IATA airport location registry', now()),
  ('LGA', 'us_domestic', 'IATA airport location registry', now()),
  ('BOS', 'us_domestic', 'IATA airport location registry', now()),
  ('ORD', 'us_domestic', 'IATA airport location registry', now()),
  ('DFW', 'us_domestic', 'IATA airport location registry', now()),
  ('IAH', 'us_domestic', 'IATA airport location registry', now()),
  ('ATL', 'us_domestic', 'IATA airport location registry', now()),
  ('MIA', 'us_domestic', 'IATA airport location registry', now()),
  ('SFO', 'us_domestic', 'IATA airport location registry', now()),
  ('LAX', 'us_domestic', 'IATA airport location registry', now()),
  ('SEA', 'us_domestic', 'IATA airport location registry', now()),
  ('YUL', 'canada', 'IATA airport location registry', now()),
  ('YYZ', 'canada', 'IATA airport location registry', now()),
  ('YVR', 'canada', 'IATA airport location registry', now()),
  ('MEX', 'mexico', 'IATA airport location registry', now()),
  ('CUN', 'mexico', 'IATA airport location registry', now()),
  ('CPH', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('LHR', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('CDG', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('AMS', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('FRA', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('MAD', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('FCO', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('LIS', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('ZRH', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('VIE', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('ARN', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('OSL', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('DUB', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('HND', 'east_asia', 'IATA airport location registry', now()),
  ('NRT', 'east_asia', 'IATA airport location registry', now()),
  ('ICN', 'east_asia', 'IATA airport location registry', now()),
  ('PEK', 'east_asia', 'IATA airport location registry', now()),
  ('PVG', 'east_asia', 'IATA airport location registry', now()),
  ('SIN', 'southeast_asia_oceania', 'IATA airport location registry', now()),
  ('BKK', 'southeast_asia_oceania', 'IATA airport location registry', now()),
  ('SYD', 'southeast_asia_oceania', 'IATA airport location registry', now()),
  ('AKL', 'southeast_asia_oceania', 'IATA airport location registry', now()),
  ('HNL', 'hawaii_pacific', 'IATA airport location registry', now()),
  ('GRU', 'south_america', 'IATA airport location registry', now()),
  ('EZE', 'south_america', 'IATA airport location registry', now()),
  ('BOG', 'south_america', 'IATA airport location registry', now()),
  ('SJO', 'caribbean_central_america', 'IATA airport location registry', now()),
  ('PTY', 'caribbean_central_america', 'IATA airport location registry', now()),
  ('JNB', 'africa', 'IATA airport location registry', now()),
  ('CAI', 'africa', 'IATA airport location registry', now()),
  ('DEL', 'south_asia_middle_east', 'IATA airport location registry', now()),
  ('BOM', 'south_asia_middle_east', 'IATA airport location registry', now()),
  ('DXB', 'south_asia_middle_east', 'IATA airport location registry', now()),
  ('TLV', 'south_asia_middle_east', 'IATA airport location registry', now())
on conflict (iata_code) do nothing;

-- ============================================================
-- Seed: Chase Ultimate Rewards transfer partners
-- ============================================================
-- Ratios verified against primary/issuer sources on 2026-09-09:
-- - Air Canada Aeroplan: "full 1:1 value" (official conversion-programs page)
-- - United MileagePlus and Air France-KLM Flying Blue: 1:1 per the issuer's
--   own transfer documentation (Chase education page) and the partner's
--   official Chase co-brand page.
-- No availability, capacity, or pricing claims are made here.
insert into public.transfer_partners
  (from_program_id, to_program_id, destination_points_per_source_point, source, last_verified_at)
select
  '0eed418a-7352-41a3-bed2-fbde756bc416', -- Chase Ultimate Rewards (fixed seed id)
  rp.id,
  1.0,
  v.source_url,
  now()
from (
  values
    (
      'Air Canada Aeroplan',
      'https://www.aircanada.com/ca/en/aco/home/aeroplan/your-aeroplan/conversion-programs.html'
    ),
    (
      'United MileagePlus',
      'https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points'
    ),
    (
      'Air France-KLM Flying Blue',
      'https://www.flyingblue.us/en/earn/partners/financial-services-chase-ultimate-rewards'
    )
) as v(program_name, source_url)
join public.reward_programs rp
  on lower(rp.name) = lower(v.program_name)
where not exists (
  select 1
  from public.transfer_partners tp
  where tp.from_program_id = '0eed418a-7352-41a3-bed2-fbde756bc416'
    and tp.to_program_id = rp.id
);

-- ============================================================
-- award_price_benchmarks: intentionally NO seed rows.
-- ============================================================
-- Published award-chart prices must be inserted only with a current
-- primary-source verification (the follow-up weekly research lane does this
-- with per-row citations). Inventing or transcribing unverified numbers here
-- would violate the repository's financial-trust rules.

commit;
