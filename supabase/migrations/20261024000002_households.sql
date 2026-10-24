-- Households own all shopping data (docs/adr/0001-household-ownership.md).
-- A user belongs to at most one household for now (UNIQUE user_id). Dropping that
-- constraint later is cheap; adding it to live data would not be.
--
-- Access rules:
--   households         SELECT for members. Created only through public.create_household().
--   household_members  SELECT for members of the same household. No direct writes yet;
--                      invites and leaving get their own functions when the UI needs them.

CREATE TABLE public.households (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  time_zone          text        NOT NULL DEFAULT 'Europe/Amsterdam',  -- validated in create_household()
  run_weekday        smallint    NOT NULL DEFAULT 1 CHECK (run_weekday BETWEEN 0 AND 6),  -- Postgres DOW: 0 = Sunday, 1 = Monday
  run_hour           smallint    NOT NULL DEFAULT 5 CHECK (run_hour BETWEEN 0 AND 23),   -- local hour in time_zone
  automation_enabled boolean     NOT NULL DEFAULT false,               -- off until AH is linked and the user opts in
  created_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.household_members (
  household_id uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text        NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id),
  CONSTRAINT household_members_one_household_per_user UNIQUE (user_id)
);

ALTER TABLE public.households        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.households, public.household_members FROM anon;

-- Membership checks used by every household-owned table's RLS policies.
-- SECURITY DEFINER so the lookup on household_members does not recurse into its own RLS.
CREATE FUNCTION private.is_household_member(target_household uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members m
    WHERE m.household_id = target_household
      AND m.user_id = (SELECT auth.uid())
  );
$$;

CREATE FUNCTION private.is_household_owner(target_household uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members m
    WHERE m.household_id = target_household
      AND m.user_id = (SELECT auth.uid())
      AND m.role = 'owner'
  );
$$;

REVOKE EXECUTE ON FUNCTION private.is_household_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.is_household_owner(uuid)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION private.is_household_member(uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION private.is_household_owner(uuid)  TO authenticated, service_role;

CREATE POLICY "members can read own household"
  ON public.households FOR SELECT
  TO authenticated
  USING (private.is_household_member(id));

CREATE POLICY "members can read own household's members"
  ON public.household_members FOR SELECT
  TO authenticated
  USING (private.is_household_member(household_id));

-- When the last member leaves or their account is deleted, delete the household too, so its
-- data (and later its AH token) goes with it. This is the erasure rule in docs/privacy/data-requests.md.
CREATE FUNCTION private.delete_household_without_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.household_members WHERE household_id = OLD.household_id) THEN
    DELETE FROM public.households WHERE id = OLD.household_id;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.delete_household_without_members() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER household_members_delete_empty_household
  AFTER DELETE ON public.household_members
  FOR EACH ROW EXECUTE FUNCTION private.delete_household_without_members();

-- No INSERT / UPDATE / DELETE policies yet. Creating a household goes through
-- public.create_household() (migration 20261024000004). Settings, invites and
-- leaving are added with the features that need them.

-- Rollback (run manually, then `supabase migration repair --status reverted 20261024000002`):
-- DROP TRIGGER household_members_delete_empty_household ON public.household_members;
-- DROP FUNCTION private.delete_household_without_members();
-- DROP FUNCTION private.is_household_owner(uuid);
-- DROP FUNCTION private.is_household_member(uuid);
-- DROP TABLE public.household_members;
-- DROP TABLE public.households;
