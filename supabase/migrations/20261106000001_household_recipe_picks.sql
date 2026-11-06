-- Rollout phase 2, step 1 of 3 (docs/adr/0005): shared household shopping list, EXPAND.
--
-- Recipe picks and shopping-list adjustments move from the per-user
-- public.shopping_lists row (JSON lists) to household-owned tables, one row per
-- recipe / per adjusted item (docs/adr/0001). One row per recipe means two members
-- adding or removing different recipes can't overwrite each other, and the AH
-- planner can read picks directly.
--
-- This step only adds and fills the new tables:
--   1. The app keeps READING public.shopping_lists and, after each save, mirrors the
--      list into these tables through public.sync_household_shopping_list().
--   2. Next PR: reads switch to these tables (re-copying from shopping_lists first).
--   3. Later PR: stop writing public.shopping_lists and drop it.
--
-- Access: members of the household can read, add, change and delete its rows, all
-- through private.is_household_member(), the same check as every household table.

CREATE TABLE public.household_recipe_picks (
  household_id uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  recipe_id    uuid        NOT NULL REFERENCES public.recipes(id)    ON DELETE CASCADE,
  servings     numeric     NOT NULL CHECK (servings > 0),  -- fractional allowed (ingredient-based scaling)
  added_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, recipe_id)
);

-- Quantity tweaks and checked-off items on the merged list, keyed by the merged
-- ingredient key from src/lib/ingredientMerge.js (e.g. "olive oil|volume:metric").
-- buy_qty 0 means checked off.
CREATE TABLE public.household_list_adjustments (
  household_id uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  item_key     text        NOT NULL,
  buy_qty      numeric     NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, item_key)
);

ALTER TABLE public.household_recipe_picks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_list_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.household_recipe_picks, public.household_list_adjustments FROM anon;

CREATE POLICY "members can read household recipe picks"
  ON public.household_recipe_picks FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));
CREATE POLICY "members can add household recipe picks"
  ON public.household_recipe_picks FOR INSERT TO authenticated
  WITH CHECK (private.is_household_member(household_id) AND added_by = (SELECT auth.uid()));
CREATE POLICY "members can change household recipe picks"
  ON public.household_recipe_picks FOR UPDATE TO authenticated
  USING (private.is_household_member(household_id))
  WITH CHECK (private.is_household_member(household_id));
CREATE POLICY "members can remove household recipe picks"
  ON public.household_recipe_picks FOR DELETE TO authenticated
  USING (private.is_household_member(household_id));

CREATE POLICY "members can read household list adjustments"
  ON public.household_list_adjustments FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));
CREATE POLICY "members can add household list adjustments"
  ON public.household_list_adjustments FOR INSERT TO authenticated
  WITH CHECK (private.is_household_member(household_id));
CREATE POLICY "members can change household list adjustments"
  ON public.household_list_adjustments FOR UPDATE TO authenticated
  USING (private.is_household_member(household_id))
  WITH CHECK (private.is_household_member(household_id));
CREATE POLICY "members can remove household list adjustments"
  ON public.household_list_adjustments FOR DELETE TO authenticated
  USING (private.is_household_member(household_id));

-- Mirrors the caller's whole list into the household tables in one transaction:
-- rows not in the payload are removed, the rest are added or updated. Replacing the
-- whole set is right while public.shopping_lists is still the source of truth; the
-- read switch (next PR) moves the app to per-change writes.
--
-- SECURITY INVOKER: runs as the caller, so the RLS policies above still apply.
-- Users who signed up after the phase 1 backfill have no household yet (nothing
-- creates one at signup), so one is created here through public.create_household().
--
-- Payloads (built by src/lib/householdSync.js):
--   picks:       [{ "recipe_id": "<uuid>", "servings": 2 }, ...]
--   adjustments: [{ "item_key": "olive oil|volume:metric", "buy_qty": 0 }, ...]
-- Ids are compared as text so malformed input is skipped rather than raising, and
-- picks for recipes that no longer exist are ignored. Returns the household id.
CREATE FUNCTION public.sync_household_shopping_list(picks jsonb, adjustments jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  caller     uuid := (SELECT auth.uid());
  hid        uuid;
  first_name text;
  pick_list  jsonb := CASE WHEN jsonb_typeof(picks) = 'array' THEN picks ELSE '[]'::jsonb END;
  adj_list   jsonb := CASE WHEN jsonb_typeof(adjustments) = 'array' THEN adjustments ELSE '[]'::jsonb END;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to save your shopping list' USING ERRCODE = '42501';
  END IF;

  SELECT m.household_id INTO hid FROM public.household_members m WHERE m.user_id = caller;
  IF hid IS NULL THEN
    SELECT nullif(split_part(btrim(p.display_name), ' ', 1), '') INTO first_name
    FROM public.profiles p WHERE p.id = caller;
    hid := public.create_household(
      CASE WHEN first_name IS NULL THEN 'My household' ELSE left(first_name, 60) || '''s household' END
    );
  END IF;

  DELETE FROM public.household_recipe_picks hp
  WHERE hp.household_id = hid
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(pick_list) e WHERE e->>'recipe_id' = hp.recipe_id::text
    );

  INSERT INTO public.household_recipe_picks (household_id, recipe_id, servings, added_by)
  SELECT DISTINCT ON (r.id) hid, r.id, s.servings, caller
  FROM jsonb_array_elements(pick_list) e
  JOIN public.recipes r ON r.id::text = e->>'recipe_id'
  CROSS JOIN LATERAL (
    SELECT CASE WHEN jsonb_typeof(e->'servings') = 'number' THEN (e->>'servings')::numeric ELSE 2 END AS servings
  ) s
  WHERE s.servings > 0
  ON CONFLICT (household_id, recipe_id) DO UPDATE
    SET servings = EXCLUDED.servings, updated_at = now()
    WHERE public.household_recipe_picks.servings IS DISTINCT FROM EXCLUDED.servings;

  DELETE FROM public.household_list_adjustments ha
  WHERE ha.household_id = hid
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(adj_list) e WHERE e->>'item_key' = ha.item_key
    );

  INSERT INTO public.household_list_adjustments (household_id, item_key, buy_qty)
  SELECT DISTINCT ON (e->>'item_key') hid, e->>'item_key', (e->>'buy_qty')::numeric
  FROM jsonb_array_elements(adj_list) e
  WHERE coalesce(e->>'item_key', '') <> '' AND jsonb_typeof(e->'buy_qty') = 'number'
  ON CONFLICT (household_id, item_key) DO UPDATE
    SET buy_qty = EXCLUDED.buy_qty, updated_at = now()
    WHERE public.household_list_adjustments.buy_qty IS DISTINCT FROM EXCLUDED.buy_qty;

  RETURN hid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_household_shopping_list(jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sync_household_shopping_list(jsonb, jsonb) TO authenticated;

-- Backfill. Give anyone who signed up since phase 1 a household (safe to re-run), then
-- copy every user's current list into their household's tables. Same defensive rules
-- as the sync function, so old or odd JSON can't fail this migration on production.
SELECT private.ensure_households();

INSERT INTO public.household_recipe_picks (household_id, recipe_id, servings, added_by, added_at, updated_at)
SELECT DISTINCT ON (m.household_id, r.id)
       m.household_id, r.id, s.servings, sl.user_id,
       coalesce(sl.updated_at, now()), coalesce(sl.updated_at, now())
FROM public.shopping_lists sl
JOIN public.household_members m ON m.user_id = sl.user_id
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(sl.recipe_selections) = 'array' THEN sl.recipe_selections ELSE '[]'::jsonb END
) e
JOIN public.recipes r ON r.id::text = e->>'recipe_id'
CROSS JOIN LATERAL (
  SELECT CASE WHEN jsonb_typeof(e->'servings') = 'number' THEN (e->>'servings')::numeric ELSE 2 END AS servings
) s
WHERE s.servings > 0
ORDER BY m.household_id, r.id, sl.updated_at DESC NULLS LAST
ON CONFLICT (household_id, recipe_id) DO NOTHING;

INSERT INTO public.household_list_adjustments (household_id, item_key, buy_qty, updated_at)
SELECT DISTINCT ON (m.household_id, e->>'key')
       m.household_id, e->>'key', (e->>'buy_qty')::numeric, coalesce(sl.updated_at, now())
FROM public.shopping_lists sl
JOIN public.household_members m ON m.user_id = sl.user_id
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(sl.adjusted_items) = 'array' THEN sl.adjusted_items ELSE '[]'::jsonb END
) e
WHERE coalesce(e->>'key', '') <> '' AND jsonb_typeof(e->'buy_qty') = 'number'
ORDER BY m.household_id, e->>'key', sl.updated_at DESC NULLS LAST
ON CONFLICT (household_id, item_key) DO NOTHING;

-- Rollback (run manually, then `supabase migration repair --status reverted 20261106000001`).
-- public.shopping_lists is untouched by this migration, so nothing is lost:
-- DROP FUNCTION public.sync_household_shopping_list(jsonb, jsonb);
-- DROP TABLE public.household_list_adjustments;
-- DROP TABLE public.household_recipe_picks;
