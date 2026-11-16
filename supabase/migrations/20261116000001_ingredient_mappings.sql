-- Rollout phase 4, step 2 (docs/adr/0005): ingredient mappings.
--
-- public.household_ingredient_mappings — what a household buys for a recipe ingredient.
--   One row per household and ingredient, owned by the household (docs/adr/0001). A row
--   either maps the ingredient to one retailer product (product_external_id, from the
--   product cache) or marks it as always at home (pantry), never both and never neither.
--   This week's preview (src/lib/weekPreview.js) turns mapped ingredients into product
--   lines in whole packs and leaves pantry ingredients off the list; ingredients without
--   a row stay free-text lines.
--
--   ingredient_key is the name part of the shopping list's merged line key
--   (ingredientKey() in src/lib/ingredientMerge.js): lower case, single spaces, plural
--   last word read as singular. "Olive Oil" and "olive oils" share a row; "chicken breast"
--   and "chicken thighs" do not. label keeps the name as the household saw it, for display.
--
-- Access: household members can read, add, change and delete their household's mappings,
-- through private.is_household_member() like the other household tables. anon gets nothing.
-- Erasure: deleting the household deletes its mappings (CASCADE). No personal data beyond
-- who added a row (created_by, cleared when that user is deleted).

CREATE TABLE public.household_ingredient_mappings (
  household_id        uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  ingredient_key      text        NOT NULL CHECK (char_length(ingredient_key) BETWEEN 1 AND 120
                                                  AND ingredient_key = lower(btrim(ingredient_key))),
  label               text        NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  retailer            text        NOT NULL DEFAULT 'ah' CHECK (retailer ~ '^[a-z][a-z0-9_]{1,19}$'),
  product_external_id bigint,
  pantry              boolean     NOT NULL DEFAULT false,
  created_by          uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, ingredient_key),
  CONSTRAINT household_ingredient_mappings_product_or_pantry
    CHECK (pantry <> (product_external_id IS NOT NULL)),
  CONSTRAINT household_ingredient_mappings_product_fk
    FOREIGN KEY (retailer, product_external_id) REFERENCES public.retailer_products (retailer, external_id)
);

ALTER TABLE public.household_ingredient_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.household_ingredient_mappings FROM anon;

CREATE POLICY "members can read household ingredient mappings"
  ON public.household_ingredient_mappings FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));
CREATE POLICY "members can add household ingredient mappings"
  ON public.household_ingredient_mappings FOR INSERT TO authenticated
  WITH CHECK (private.is_household_member(household_id) AND created_by = (SELECT auth.uid()));
CREATE POLICY "members can change household ingredient mappings"
  ON public.household_ingredient_mappings FOR UPDATE TO authenticated
  USING (private.is_household_member(household_id))
  WITH CHECK (private.is_household_member(household_id));
CREATE POLICY "members can remove household ingredient mappings"
  ON public.household_ingredient_mappings FOR DELETE TO authenticated
  USING (private.is_household_member(household_id));

-- Rollback (run manually, then `supabase migration repair --status reverted 20261116000001`).
-- Deletes every household's mappings; the preview then shows those ingredients as free text again:
-- DROP TABLE public.household_ingredient_mappings;
