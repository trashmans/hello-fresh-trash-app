-- Hide email addresses in public.profiles from other users.
--
-- The "authenticated users can read profiles" policy (20260413000001/2) lets every signed-in
-- user read every profile row, which is needed to show uploader names and pictures on
-- recipes and, with Social, friends' names. But the row also holds the user's email, so
-- anyone could list everyone's address. RLS works per row, not per column, so this uses
-- column privileges instead: signed-in users may read every column EXCEPT email.
--
-- The app never reads profiles.email (your own address comes from your sign-in session).
-- Server-side code (SECURITY DEFINER functions, Edge Functions, triggers) is unaffected.
-- Updates are narrowed the same way: you can change your own unit preferences, nothing
-- else (the "users can update own profile" policy still limits it to your own row).
--
-- Note for later migrations: a new profiles column is NOT readable by signed-in users until
-- it is added to the GRANT SELECT list below (and to GRANT UPDATE if users may change it).

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.profiles FROM anon;
REVOKE SELECT, UPDATE ON public.profiles FROM authenticated;
GRANT SELECT (id, display_name, avatar_url, created_at, temperature_unit, volume_unit, mass_unit)
  ON public.profiles TO authenticated;
GRANT UPDATE (temperature_unit, volume_unit, mass_unit) ON public.profiles TO authenticated;

-- Rollback (run manually, then `supabase migration repair --status reverted 20261121000003`):
-- GRANT SELECT, UPDATE ON public.profiles TO authenticated;
