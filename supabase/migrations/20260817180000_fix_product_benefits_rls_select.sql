-- Fix product_benefits RLS: allow authenticated SELECT while blocking writes
--
-- The wallet_benefits foundation migration created a permissive authenticated
-- SELECT policy on product_benefits, but also a restrictive ALL policy with
-- USING (false). In PostgreSQL RLS, a restrictive policy applies to every
-- command it covers, including SELECT. The restrictive USING (false) therefore
-- overrode the permissive SELECT policy and caused all authenticated
-- product_benefits queries to return zero rows.
--
-- This migration:
--   1. Drops only the restrictive ALL no-write policy on product_benefits.
--   2. Adds three restrictive write-only policies (INSERT/UPDATE/DELETE) so
--      ordinary authenticated users remain denied for writes, while the
--      permissive authenticated SELECT policy is preserved and now effective.
--
-- The permissive `product_benefits_select_authenticated` policy is preserved
-- unchanged. No other table, policy, seed data, or application code is changed.
--
-- NOTE: This intentionally differs from the earlier catalog RLS fix
-- (20260816120000) which dropped the no-write policies entirely. Here we add
-- explicit restrictive write-only policies to keep the no-write intent
-- explicit while unblocking SELECT.

begin;

-- ============================================================
-- Drop the restrictive ALL no-write policy that blocks SELECT
-- ============================================================
drop policy if exists "product_benefits_no_write"
  on public.product_benefits;

-- ============================================================
-- Add restrictive write-only policies (do not affect SELECT)
-- ============================================================
create policy "product_benefits_no_write_insert"
  on public.product_benefits
  as restrictive
  for insert
  to authenticated
  with check (false);

create policy "product_benefits_no_write_update"
  on public.product_benefits
  as restrictive
  for update
  to authenticated
  using (false)
  with check (false);

create policy "product_benefits_no_write_delete"
  on public.product_benefits
  as restrictive
  for delete
  to authenticated
  using (false);

commit;