-- Private schema for data the browser must never reach (docs/adr/0002-private-schema.md):
-- retailer accounts, audit log, data-request log, run internals.
--
-- `private` is NOT added to the API's exposed schemas, so PostgREST cannot serve it.
-- `authenticated` gets USAGE only so RLS policies can call private.is_household_member();
-- it gets no privileges on any table here, and EXECUTE only on functions granted explicitly.
-- Edge Functions reach private tables through a direct Postgres connection
-- (SUPABASE_DB_URL), which also allows the row locks ADR 0003 needs.

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Nothing created here later is reachable by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT ALL ON SEQUENCES TO service_role;

-- Rollback (run manually, then `supabase migration repair --status reverted 20261024000001`):
-- DROP SCHEMA private;   -- fails while later migrations' objects exist; roll those back first
