-- Adds per-serving nutrition facts to recipes, so the catalogue's list
-- view can show and sort by calories, protein, fat, and fibre alongside
-- cook time, prep time, difficulty, cuisine, and protein source.
--
-- All eight values are numeric and nullable, with NO CHECK constraint:
-- unlike difficulty/cuisine/protein_source these aren't a fixed category
-- set, so there's no "unusual-but-harmless string" failure mode to guard
-- against — a malformed numeric value from Gemini would fail JSON
-- parsing before it ever reaches the database. Stored as numeric rather
-- than integer since nutrition labels commonly show fractional grams
-- (e.g. 2.5 g fibre).
--
-- Only four of the eight (calories, fat, fibre, protein) are surfaced as
-- sortable table columns for now (see RecipeTable.jsx) — saturated fat,
-- carbs, sugar, and salt are extracted and stored but not shown as
-- columns, to keep the list view from getting too wide.
--
-- No RLS policy needed: these are only ever written by parse-recipe using
-- the service role key (which bypasses RLS), the same as
-- difficulty/cuisine/protein_source — there's no client INSERT/UPDATE
-- path for them.
--
-- Existing recipes will show blank nutrition values until they're
-- re-parsed (same fail-safe-blank pattern as protein_source) — there's no
-- backfill here.
ALTER TABLE public.recipes
  ADD COLUMN calories_kcal numeric,
  ADD COLUMN fat_g numeric,
  ADD COLUMN saturated_fat_g numeric,
  ADD COLUMN carbs_g numeric,
  ADD COLUMN sugar_g numeric,
  ADD COLUMN fibre_g numeric,
  ADD COLUMN protein_g numeric,
  ADD COLUMN salt_g numeric;
