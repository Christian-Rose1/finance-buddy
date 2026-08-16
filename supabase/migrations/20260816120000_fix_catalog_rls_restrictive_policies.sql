-- Fix catalog RLS: remove restrictive ALL policies that block SELECT
--
-- The catalog foundation migration created permissive SELECT policies for
-- authenticated users, but also created restrictive ALL policies with
-- USING (false). In PostgreSQL RLS, restrictive policies apply to every
-- command they cover, including SELECT. The restrictive USING (false)
-- therefore overrode the permissive SELECT policies and caused all
-- authenticated catalog queries to return zero rows.
--
-- This migration drops only the three restrictive no-write policies.
-- The permissive SELECT policies remain, so authenticated users can still
-- read the shared catalog. With no INSERT/UPDATE/DELETE policies defined,
-- ordinary authenticated users remain denied for those commands by RLS.
--
-- No tables, columns, seed data, wallet RLS, or application code are changed.

begin;

drop policy if exists "reward_programs_no_write"
  on public.reward_programs;

drop policy if exists "card_products_no_write"
  on public.card_products;

drop policy if exists "earning_rules_no_write"
  on public.earning_rules;

commit;
