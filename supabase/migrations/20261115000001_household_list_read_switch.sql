-- Rollout phase 2, step 2 of 3 (docs/adr/0005): shared household shopping list, READ SWITCH.
--
-- From this release the app reads household_recipe_picks / household_list_adjustments
-- and writes them one row at a time (src/lib/householdList.js), so two members of a
-- household share one list and can't overwrite each other.
--
-- This migration:
--   1. Gives anyone who signed up since step 1 a household (safe to re-run).
--   2. Re-copies every household's list from public.shopping_lists, which was the
--      source of truth until now. Needed because the step 1 sync replaced the whole
--      household list with the caller's own list on every save, so in a household with
--      two members the tables only hold whoever saved last. The re-copy is the UNION
--      of all members' lists; where two members picked the same recipe or adjusted
--      the same item, the most recently saved list wins.
--   3. Adds public.ensure_my_household(), which the app calls on load.
--   4. Turns public.sync_household_shopping_list() into a no-write wrapper, so a
--      device still running the previous app version (cached PWA) can't wipe the
--      shared list with its whole-list replace.
--
-- public.shopping_lists is not changed. The app keeps saving a copy of the list there
-- until step 3 (later PR) drops it, so this step can be rolled back without loss.
-- No new tables: the step 1 RLS policies already cover per-row reads and writes.

SELECT private.ensure_households();

-- Re-copy picks. added_at keeps each list's own order (one millisecond per position),
-- because the app orders picks by added_at.
DELETE FROM public.household_recipe_picks;

INSERT INTO public.household_recipe_picks (household_id, recipe_id, servings, added_by, added_at, updated_at)
SELECT DISTINCT ON (m.household_id, r.id)
       m.household_id, r.id, s.servings, sl.user_id,
       coalesce(sl.updated_at, now()) + e.ord * interval '1 millisecond',
       coalesce(sl.updated_at, now())
FROM public.shopping_lists sl
JOIN public.household_members m ON m.user_id = sl.user_id
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(sl.recipe_selections) = 'array' THEN sl.recipe_selections ELSE '[]'::jsonb END
) WITH ORDINALITY AS e(pick, ord)
JOIN public.recipes r ON r.id::text = e.pick->>'recipe_id'
CROSS JOIN LATERAL (
  SELECT CASE WHEN jsonb_typeof(e.pick->'servings') = 'number' THEN (e.pick->>'servings')::numeric ELSE 2 END AS servings
) s
WHERE s.servings > 0
ORDER BY m.household_id, r.id, sl.updated_at DESC NULLS LAST, e.ord DESC;

-- Re-copy adjustments (quantity tweaks and checked-off items).
DELETE FROM public.household_list_adjustments;

INSERT INTO public.household_list_adjustments (household_id, item_key, buy_qty, updated_at)
SELECT DISTINCT ON (m.household_id, e.item->>'key')
       m.household_id, e.item->>'key', (e.item->>'buy_qty')::numeric, coalesce(sl.updated_at, now())
FROM public.shopping_lists sl
JOIN public.household_members m ON m.user_id = sl.user_id
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(sl.adjusted_items) = 'array' THEN sl.adjusted_items ELSE '[]'::jsonb END
) WITH ORDINALITY AS e(item, ord)
WHERE coalesce(e.item->>'key', '') <> '' AND jsonb_typeof(e.item->'buy_qty') = 'number'
ORDER BY m.household_id, e.item->>'key', sl.updated_at DESC NULLS LAST, e.ord DESC;

-- Returns the caller's household id, creating a household for users who have none
-- (nothing creates one at signup). The app calls this before reading the list.
--
-- SECURITY INVOKER: runs as the caller; creation goes through public.create_household().
-- If two tabs race to create it, the loser gets a unique violation from
-- household_members and reads the winner's household instead.
CREATE FUNCTION public.ensure_my_household()
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  caller     uuid := (SELECT auth.uid());
  hid        uuid;
  first_name text;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to use your shopping list' USING ERRCODE = '42501';
  END IF;

  SELECT m.household_id INTO hid FROM public.household_members m WHERE m.user_id = caller;
  IF hid IS NOT NULL THEN
    RETURN hid;
  END IF;

  SELECT nullif(split_part(btrim(p.display_name), ' ', 1), '') INTO first_name
  FROM public.profiles p WHERE p.id = caller;

  BEGIN
    hid := public.create_household(
      CASE WHEN first_name IS NULL THEN 'My household' ELSE left(first_name, 60) || '''s household' END
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT m.household_id INTO hid FROM public.household_members m WHERE m.user_id = caller;
  END;

  RETURN hid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_my_household() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ensure_my_household() TO authenticated;

-- The previous app version calls this after every save with its whole list. It now
-- writes nothing and only returns the household id; step 3 drops it.
CREATE OR REPLACE FUNCTION public.sync_household_shopping_list(picks jsonb, adjustments jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN public.ensure_my_household();
END;
$$;

-- Rollback (run manually, then `supabase migration repair --status reverted 20261115000001`).
-- Deploy the previous app version first: it reads public.shopping_lists, which this
-- step kept up to date, and its next save refills the household tables.
-- 1. Re-run the CREATE FUNCTION public.sync_household_shopping_list(...) statement from
--    migration 20261106000001 as CREATE OR REPLACE FUNCTION.
-- 2. DROP FUNCTION public.ensure_my_household();
