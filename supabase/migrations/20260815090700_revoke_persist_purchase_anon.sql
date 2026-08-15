-- Revoke EXECUTE on persist_purchase from the anon role.
--
-- The RPC migration (20260815084500) correctly revoked EXECUTE from PUBLIC and
-- granted it only to authenticated, but the anon role retained an explicit
-- EXECUTE grant. This migration removes that grant so the function is only
-- executable by authenticated users (and the owning postgres/service_role
-- roles). The function body is unchanged.

begin;

revoke execute
  on function public.persist_purchase(uuid, jsonb, jsonb, jsonb)
  from anon;

commit;