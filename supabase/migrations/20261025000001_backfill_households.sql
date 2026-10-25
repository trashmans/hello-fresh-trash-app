-- Gives every existing user a household of their own (docs/adr/0005, phase 1).
--
-- private.ensure_households() creates a household, owner membership and audit event for
-- each user who has none, and returns how many it created. It is safe to run again:
-- users who already belong to a household are skipped. Phase 2 runs it again for anyone
-- who signed up in between, before the shared shopping list switches over.
--
-- Household name: "<first word of display name>'s household", or "My household" when
-- there is no display name. Members can rename it once the settings screen exists.

CREATE FUNCTION private.ensure_households()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  u        record;
  new_id   uuid;
  created  integer := 0;
BEGIN
  FOR u IN
    SELECT au.id AS user_id, nullif(split_part(btrim(p.display_name), ' ', 1), '') AS first_name
    FROM auth.users au
    LEFT JOIN public.profiles p ON p.id = au.id
    WHERE NOT EXISTS (SELECT 1 FROM public.household_members m WHERE m.user_id = au.id)
    ORDER BY au.id
  LOOP
    INSERT INTO public.households (name, created_by)
    VALUES (
      CASE WHEN u.first_name IS NULL THEN 'My household'
           ELSE left(u.first_name, 60) || '''s household' END,
      u.user_id
    )
    RETURNING id INTO new_id;

    INSERT INTO public.household_members (household_id, user_id, role)
    VALUES (new_id, u.user_id, 'owner');

    INSERT INTO private.audit_events (household_id, actor_id, action)
    VALUES (new_id, u.user_id, 'household.backfilled');

    created := created + 1;
  END LOOP;

  RETURN created;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.ensure_households() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION private.ensure_households() TO service_role;

SELECT private.ensure_households();

-- Rollback (run manually, then `supabase migration repair --status reverted 20261025000001`):
-- DELETE FROM public.households h
--   WHERE EXISTS (SELECT 1 FROM private.audit_events e
--                 WHERE e.household_id = h.id AND e.action = 'household.backfilled');
-- DROP FUNCTION private.ensure_households();
