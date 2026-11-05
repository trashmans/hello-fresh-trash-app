-- Records which nutrition values on a recipe are AI estimates rather than
-- values printed on the recipe card.
--
-- Most HelloFresh cards print only calories, so parse-recipe now asks
-- Gemini to estimate any missing nutrition value from the ingredient list
-- (printed values are still copied exactly). The names of the estimated
-- fields (e.g. {protein_g,fat_g,fibre_g}) are stored here so the list view
-- can mark them as estimates. Per field, not per recipe, because a single
-- recipe is often mixed: printed calories plus estimated grams.
--
-- Empty array = everything shown was printed on the card (or nothing was
-- extracted). Like the nutrition columns themselves, written only by
-- parse-recipe with the service role key, so no new RLS policy is needed,
-- and existing recipes keep an empty list until they are re-parsed.
ALTER TABLE public.recipes
  ADD COLUMN nutrition_estimated text[] NOT NULL DEFAULT '{}';
