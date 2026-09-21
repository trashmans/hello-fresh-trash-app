-- The recipe-pdfs bucket was created by hand in the Supabase dashboard, restricted
-- to PDF uploads only (see the note at the top of 20260418000001_recipes.sql).
-- Since 20260911000001_recipe_cover_path.sql, client-generated JPEG cover
-- thumbnails are also uploaded into this same bucket, under covers/<user-id>/<uuid>.jpg.
-- Without this, those uploads fail with "mime type image/jpeg is not supported".
UPDATE storage.buckets
SET allowed_mime_types = CASE
  WHEN allowed_mime_types IS NULL THEN NULL -- NULL means "no restriction" already; nothing to do
  WHEN 'image/jpeg' = ANY(allowed_mime_types) THEN allowed_mime_types
  ELSE array_append(allowed_mime_types, 'image/jpeg')
END
WHERE id = 'recipe-pdfs';
