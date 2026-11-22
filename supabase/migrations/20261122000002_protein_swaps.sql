-- Protein swaps (docs/adr/0010): vegetarian / meat / half-and-half versions of a recipe.
--
-- public.recipe_swaps — the options Gemini suggested for a recipe in one direction
--   (to_vegetarian or to_meat), saved so they are generated once and shared by everyone,
--   like the recipe itself (the catalogue is shared, docs/adr/0008). "Suggest other options"
--   adds a new batch. Each row: title, short summary, changes (jsonb array of
--   { kind: portion | shared, replaces: [ingredient names], add: ingredient | null }) and the
--   recipe's steps rewritten for All (steps_all) and Half & half (steps_half).
--   Written only by the suggest-swaps Edge Function (service role); signed-in users read.
--
-- public.household_recipe_picks.swap_id / swap_mode — the swap chosen for a recipe in this
--   week's list ('all' or 'half'), shared within the household. The foreign key includes the
--   recipe, so a pick can only use a swap of its own recipe; if the swap is deleted, the pick
--   goes back to the original (swap_id becomes NULL; a swap_mode without a swap_id means
--   original). Members already read and change their household's picks (RLS).
--
-- No personal data beyond who asked for a batch (created_by, cleared when that user is deleted).

CREATE TABLE public.recipe_swaps (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id   uuid        NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  direction   text        NOT NULL CHECK (direction IN ('to_vegetarian', 'to_meat')),
  batch       smallint    NOT NULL CHECK (batch BETWEEN 1 AND 20),
  position    smallint    NOT NULL CHECK (position BETWEEN 1 AND 6),
  title       text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  summary     text        CHECK (summary IS NULL OR char_length(summary) <= 300),
  changes     jsonb       NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
  steps_all   jsonb       CHECK (steps_all IS NULL OR jsonb_typeof(steps_all) = 'array'),
  steps_half  jsonb       CHECK (steps_half IS NULL OR jsonb_typeof(steps_half) = 'array'),
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, recipe_id),
  UNIQUE (recipe_id, direction, batch, position)
);
CREATE INDEX recipe_swaps_created_by_idx ON public.recipe_swaps (created_by, created_at);

ALTER TABLE public.recipe_swaps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recipe_swaps FROM anon;
CREATE POLICY "signed-in users can read recipe swaps"
  ON public.recipe_swaps FOR SELECT TO authenticated
  USING (true);
-- No INSERT / UPDATE / DELETE policies: only suggest-swaps (service role) writes.

ALTER TABLE public.household_recipe_picks
  ADD COLUMN swap_id   uuid,
  ADD COLUMN swap_mode text CHECK (swap_mode IN ('all', 'half')),
  ADD CONSTRAINT household_recipe_picks_swap_fk
    FOREIGN KEY (swap_id, recipe_id) REFERENCES public.recipe_swaps (id, recipe_id) ON DELETE SET NULL (swap_id);

-- Rollback (run manually, then `supabase migration repair --status reverted 20261122000002`):
-- ALTER TABLE public.household_recipe_picks DROP CONSTRAINT household_recipe_picks_swap_fk,
--   DROP COLUMN swap_mode, DROP COLUMN swap_id;
-- DROP TABLE public.recipe_swaps;
