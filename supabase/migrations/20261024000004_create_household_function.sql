-- The only way to create a household: inserts the household and the caller as owner in one
-- transaction, and writes an audit event. Callable by signed-in users (already allowlisted at signup).

CREATE FUNCTION public.create_household(
  household_name      text,
  household_time_zone text DEFAULT 'Europe/Amsterdam'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := (SELECT auth.uid());
  new_id uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to create a household' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.household_members WHERE user_id = caller) THEN
    RAISE EXCEPTION 'You already belong to a household' USING ERRCODE = '23505';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = household_time_zone) THEN
    RAISE EXCEPTION 'Unknown time zone: %', household_time_zone USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.households (name, time_zone, created_by)
  VALUES (btrim(household_name), household_time_zone, caller)
  RETURNING id INTO new_id;

  INSERT INTO public.household_members (household_id, user_id, role)
  VALUES (new_id, caller, 'owner');

  INSERT INTO private.audit_events (household_id, actor_id, action)
  VALUES (new_id, caller, 'household.created');

  RETURN new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_household(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_household(text, text) TO authenticated;

-- Rollback (run manually, then `supabase migration repair --status reverted 20261024000004`):
-- DROP FUNCTION public.create_household(text, text);
