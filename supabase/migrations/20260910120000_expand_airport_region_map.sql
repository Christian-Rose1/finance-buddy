-- Expands the airport -> region catalog used by deterministic award-benchmark
-- selection. Definitional geography only (which region an airport is located
-- in), not pricing. Same source convention as the original seed migration:
-- public IATA airport location data.
--
-- Motivation: the original ~50-row seed omitted several common US origins,
-- including Raleigh-Durham (RDU). Benchmark selection fails closed when an
-- airport is unmapped, so a real customer origin could never match a
-- benchmark row. This migration adds the missing airports; no pricing or
-- availability claims are made.
--
-- Idempotent: existing rows are untouched (on conflict do nothing).

insert into public.airport_region_map (iata_code, region, source, last_verified_at) values
  -- US domestic additions (common origin/destination airports absent from the
  -- original seed)
  ('RDU', 'us_domestic', 'IATA airport location registry', now()),
  ('CLT', 'us_domestic', 'IATA airport location registry', now()),
  ('PHL', 'us_domestic', 'IATA airport location registry', now()),
  ('DCA', 'us_domestic', 'IATA airport location registry', now()),
  ('IAD', 'us_domestic', 'IATA airport location registry', now()),
  ('BWI', 'us_domestic', 'IATA airport location registry', now()),
  ('MSP', 'us_domestic', 'IATA airport location registry', now()),
  ('DTW', 'us_domestic', 'IATA airport location registry', now()),
  ('SLC', 'us_domestic', 'IATA airport location registry', now()),
  ('PHX', 'us_domestic', 'IATA airport location registry', now()),
  ('LAS', 'us_domestic', 'IATA airport location registry', now()),
  ('PDX', 'us_domestic', 'IATA airport location registry', now()),
  ('SAN', 'us_domestic', 'IATA airport location registry', now()),
  ('TPA', 'us_domestic', 'IATA airport location registry', now()),
  ('MCO', 'us_domestic', 'IATA airport location registry', now()),
  ('AUS', 'us_domestic', 'IATA airport location registry', now()),
  ('BNA', 'us_domestic', 'IATA airport location registry', now()),
  ('STL', 'us_domestic', 'IATA airport location registry', now()),
  ('MCI', 'us_domestic', 'IATA airport location registry', now()),
  ('CLE', 'us_domestic', 'IATA airport location registry', now()),
  ('CMH', 'us_domestic', 'IATA airport location registry', now()),
  ('PIT', 'us_domestic', 'IATA airport location registry', now()),
  ('IND', 'us_domestic', 'IATA airport location registry', now()),
  ('MSY', 'us_domestic', 'IATA airport location registry', now()),
  ('SJU', 'caribbean_central_america', 'IATA airport location registry', now()),
  -- Transatlantic Europe additions
  ('BRU', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('MUC', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('MAN', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('EDI', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('GOT', 'transatlantic_europe', 'IATA airport location registry', now()),
  ('BGO', 'transatlantic_europe', 'IATA airport location registry', now())
on conflict (iata_code) do nothing;
