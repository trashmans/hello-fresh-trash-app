-- ingredients table: one row per ingredient per recipe.
-- Enables ingredient search and serving-size scaling.
CREATE TABLE public.ingredients (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id     uuid        REFERENCES public.recipes(id) ON DELETE CASCADE NOT NULL,
  name          text        NOT NULL,
  quantity      numeric,
  unit          text,
  preparation   text,
  display_order integer     NOT NULL
);

ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read ingredients (shared catalogue)
CREATE POLICY "authenticated users can read all ingredients"
  ON public.ingredients FOR SELECT
  TO authenticated
  USING (true);

-- Service role only for insert/update (done by edge function)
-- No client-writable INSERT policy: only the parse-recipe edge function
-- writes ingredients using the service role key, which bypasses RLS.

-- Indexes for duplicate detection lookups on recipes
CREATE INDEX idx_recipes_content_hash
  ON public.recipes (content_hash);

CREATE INDEX idx_recipes_ingredient_fingerprint
  ON public.recipes (ingredient_fingerprint);

-- Enforce uniqueness: two ready recipes cannot share a name (case-insensitive)
CREATE UNIQUE INDEX uniq_ready_recipe_name
  ON public.recipes (LOWER(name))
  WHERE status = 'ready';
