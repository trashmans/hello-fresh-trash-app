-- Recipes from a web link (docs/adr/0009).
--
-- public.recipes.source_url — the https page a recipe was imported from. The column already
-- exists (20260419000002, unused until now, always NULL); this adds its rule. A link recipe has
-- no PDF (storage_path is NULL); every recipe has a PDF or a link. The app inserts the row
-- (RLS: own uploads, and the existing 20-per-hour upload limit counts links too); the
-- existing webhook then runs parse-recipe, which fetches the page safely, reads its
-- schema.org Recipe data (or its text) with Gemini and stores the page's main photo as
-- the cover.
--
-- The recipe-pdfs bucket also takes PNG and WebP covers (photos are stored as the site
-- serves them; JPEG was already allowed).

ALTER TABLE public.recipes
  ADD CONSTRAINT recipes_source_url_https
    CHECK (source_url IS NULL OR (char_length(source_url) <= 2048 AND source_url ~ '^https://'));
ALTER TABLE public.recipes ALTER COLUMN storage_path DROP NOT NULL;
ALTER TABLE public.recipes
  ADD CONSTRAINT recipes_pdf_or_link CHECK (storage_path IS NOT NULL OR source_url IS NOT NULL);
CREATE INDEX recipes_source_url_idx ON public.recipes (source_url) WHERE source_url IS NOT NULL;

UPDATE storage.buckets
SET allowed_mime_types = CASE
  WHEN allowed_mime_types IS NULL THEN NULL
  ELSE (SELECT array_agg(DISTINCT t) FROM unnest(allowed_mime_types || ARRAY['image/png', 'image/webp']) AS t)
END
WHERE id = 'recipe-pdfs';

-- Rollback (run manually, then `supabase migration repair --status reverted 20261122000001`).
-- Link recipes must be deleted first (they have no PDF):
-- DELETE FROM public.recipes WHERE storage_path IS NULL;
-- ALTER TABLE public.recipes DROP CONSTRAINT recipes_pdf_or_link;
-- ALTER TABLE public.recipes ALTER COLUMN storage_path SET NOT NULL;
-- DROP INDEX public.recipes_source_url_idx;
-- ALTER TABLE public.recipes DROP CONSTRAINT recipes_source_url_https;
-- (source_url itself stays: it predates this migration)
