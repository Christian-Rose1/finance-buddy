-- Seed the missing Virgin Atlantic Flying Club Chase transfer partner row.
--
-- The 2026-09-09 benchmark seed created the Chase Ultimate Rewards ->
-- transfer-partner rows for Aeroplan, United, and Flying Blue, but Virgin
-- Atlantic Flying Club was omitted even though it is a Chase partner at 1:1.
-- The live product therefore showed a Virgin Atlantic benchmark option with
-- no eligible funding path. This row was verified 2026-09-12 against:
-- - Virgin Atlantic's official Chase transfer page (partner source):
--   "1,000 Chase Ultimate Rewards points equals 1,000 Virgin Points"
--   (https://www.virginatlantic.com/en-US/flying-club/earn-points/chase-ultimate-rewards)
-- - Virgin's official group page stating the "full 1:1 ratio"
--   (https://virgin.com/en-us/virgin-red/earn-virgin-points/transfer-your-chase-ultimate-rewards-points-into-virgin-points-530469)
-- Only the base ratio is recorded; promotional transfer bonuses are never
-- encoded (the funding disclosure makes no timing or promotion claims).
-- Idempotent: the row is inserted only when no Chase -> Virgin Atlantic
-- partner row exists yet.

begin;

insert into public.transfer_partners
  (from_program_id, to_program_id, destination_points_per_source_point, source, last_verified_at)
select
  '0eed418a-7352-41a3-bed2-fbde756bc416', -- Chase Ultimate Rewards (fixed seed id)
  rp.id,
  1.0,
  'https://www.virginatlantic.com/en-US/flying-club/earn-points/chase-ultimate-rewards',
  now()
from public.reward_programs rp
where lower(rp.name) = lower('Virgin Atlantic Flying Club')
  and not exists (
    select 1
    from public.transfer_partners tp
    where tp.from_program_id = '0eed418a-7352-41a3-bed2-fbde756bc416'
      and tp.to_program_id = rp.id
  );

commit;
