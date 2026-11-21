-- Ingredient mappings: how much to buy (rollout phase 5/6 follow-up).
--
-- public.household_ingredient_mappings.amount_rule — for a mapping to a product, how the
-- week's preview works out the number of packs (src/lib/planWeek.js):
--   auto        compare the recipes' amount with the pack size (as before; the default)
--   per_recipe  one pack for each recipe that uses the ingredient (a can of coconut milk,
--               a pack of feta), for kit amounts like "1 packet" that can't be compared
--   per_week    one pack whatever the recipes need (a bag of rice, a root of ginger)
-- Always-at-home rows (pantry) ignore it. Existing rows become 'auto', so nothing changes
-- until a household picks a rule. The table's RLS policies already cover the column:
-- members can read and change their household's mappings, nobody else.

ALTER TABLE public.household_ingredient_mappings
  ADD COLUMN amount_rule text NOT NULL DEFAULT 'auto'
    CONSTRAINT household_ingredient_mappings_amount_rule
    CHECK (amount_rule IN ('auto', 'per_recipe', 'per_week'));

-- Rollback (run manually, then `supabase migration repair --status reverted 20261121000001`).
-- Mappings keep their product; the preview goes back to comparing amounts for all of them:
-- ALTER TABLE public.household_ingredient_mappings DROP COLUMN amount_rule;
