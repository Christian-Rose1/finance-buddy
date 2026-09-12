-- Fix award-benchmark catalog RLS: remove restrictive ALL policies that block SELECT.
--
-- 20260909120000_create_award_benchmarks.sql recreated the same defective
-- policy idiom that 20260816120000_fix_catalog_rls_restrictive_policies.sql
-- already fixed for the card-product catalog: a restrictive `FOR ALL ...
-- USING (false)` policy intended to block writes also applies to SELECT
-- (PostgreSQL ANDs restrictive policies with permissive ones for every
-- command they cover). The result was that authenticated users could not
-- read any row from these three catalog tables, so every benchmark,
-- airport-region, and transfer-partner lookup failed closed with zero rows.
-- Diagnosed live via the [award-benchmarks] catalog_unavailable diagnostic.

begin;

-- Drop only the three restrictive no-write policies. The permissive SELECT
-- policies for authenticated from the original migration remain in place,
-- and RLS stays enabled.

drop policy if exists "airport_region_map_no_write" on public.airport_region_map;
drop policy if exists "transfer_partners_no_write" on public.transfer_partners;
drop policy if exists "award_price_benchmarks_no_write" on public.award_price_benchmarks;

-- Write protection is re-created as command-specific restrictive policies
-- that do not cover SELECT. `anon` retains default-deny (no policy grants it
-- anything), and service_role bypasses RLS for catalog seeding.

create policy "airport_region_map_no_insert"
  on public.airport_region_map as restrictive for insert to authenticated
  with check (false);
create policy "airport_region_map_no_update"
  on public.airport_region_map as restrictive for update to authenticated
  using (false)
  with check (false);
create policy "airport_region_map_no_delete"
  on public.airport_region_map as restrictive for delete to authenticated
  using (false);

create policy "transfer_partners_no_insert"
  on public.transfer_partners as restrictive for insert to authenticated
  with check (false);
create policy "transfer_partners_no_update"
  on public.transfer_partners as restrictive for update to authenticated
  using (false)
  with check (false);
create policy "transfer_partners_no_delete"
  on public.transfer_partners as restrictive for delete to authenticated
  using (false);

create policy "award_price_benchmarks_no_insert"
  on public.award_price_benchmarks as restrictive for insert to authenticated
  with check (false);
create policy "award_price_benchmarks_no_update"
  on public.award_price_benchmarks as restrictive for update to authenticated
  using (false)
  with check (false);
create policy "award_price_benchmarks_no_delete"
  on public.award_price_benchmarks as restrictive for delete to authenticated
  using (false);

commit;
