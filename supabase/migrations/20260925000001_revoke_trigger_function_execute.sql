-- These SECURITY DEFINER functions are only ever invoked by triggers, which
-- don't check EXECUTE privilege when they fire. Revoking the default grant
-- keeps them off the PostgREST RPC surface and clears the Security Advisor
-- "Public / Signed-In Users Can Execute SECURITY DEFINER Function" warnings.
REVOKE EXECUTE ON FUNCTION public.enforce_email_allowlist() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_upload_rate_limit() FROM PUBLIC, anon, authenticated;

-- Rollback (run manually, then `supabase migration repair --status reverted 20260925000001`):
-- GRANT EXECUTE ON FUNCTION public.enforce_email_allowlist() TO PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.handle_new_user()         TO PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.check_upload_rate_limit() TO PUBLIC, anon, authenticated;
