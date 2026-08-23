-- Seed Chase transfer-partner reward programs.
-- Source: issuer documentation (Chase Ultimate Rewards transfer partners).
-- Inserts only when a case-insensitive exact program name does not already exist.
-- Does not create transfer ratios or claim live availability.

begin;

insert into public.reward_programs (name, currency, family, source, last_verified_at, metadata)
select
  v.name,
  v.currency,
  v.family,
  'issuer_documentation',
  now(),
  jsonb_build_object(
    'officialSourceUrl',
    'https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points'
  )
from (
  values
    ('Aer Lingus AerClub', 'points', 'airline_miles'),
    ('The British Airways Club', 'points', 'airline_miles'),
    ('Air France-KLM Flying Blue', 'miles', 'airline_miles'),
    ('Iberia Club', 'points', 'airline_miles'),
    ('JetBlue TrueBlue', 'points', 'airline_miles'),
    ('Singapore Airlines KrisFlyer', 'miles', 'airline_miles'),
    ('Southwest Rapid Rewards', 'points', 'airline_miles'),
    ('United MileagePlus', 'miles', 'airline_miles'),
    ('Virgin Atlantic Flying Club', 'points', 'airline_miles'),
    ('Air Canada Aeroplan', 'points', 'airline_miles'),
    ('IHG One Rewards', 'points', 'hotel_points'),
    ('Marriott Bonvoy', 'points', 'hotel_points'),
    ('World of Hyatt', 'points', 'hotel_points'),
    ('Wyndham Rewards', 'points', 'hotel_points')
) as v(name, currency, family)
where not exists (
  select 1
  from public.reward_programs rp
  where lower(rp.name) = lower(v.name)
);

commit;