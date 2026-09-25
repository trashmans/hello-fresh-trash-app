-- Recipe cover thumbnails, rendered client-side from PDF page 1 (see src/lib/pdfCover.js).
-- cleanup-recipes already expects this column (added in the original parsing-pipeline
-- migration but never actually created) — this migration finally adds it for real.
-- IF NOT EXISTS because prod already had the column added by hand before this ran.
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS cover_path text;

-- Covers are stored in the existing recipe-pdfs bucket under covers/<user-id>/<uuid>.jpg,
-- alongside the PDFs under recipes/<user-id>/<uuid>.pdf. Extend the upload policy to
-- allow both prefixes.
DROP POLICY IF EXISTS "recipe-pdfs: authenticated users can upload to own path" ON storage.objects;

CREATE POLICY "recipe-pdfs: authenticated users can upload to own path"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'recipe-pdfs'
    AND (
      name LIKE ('recipes/' || auth.uid()::text || '/%')
      OR name LIKE ('covers/' || auth.uid()::text || '/%')
    )
  );

-- Uploaders (and admins, via the existing admin-delete policy) should be able to
-- delete a recipe's cover file the same way they can delete its PDF.
DROP POLICY IF EXISTS "recipe-pdfs: uploaders can delete their own files" ON storage.objects;

CREATE POLICY "recipe-pdfs: uploaders can delete their own files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'recipe-pdfs'
    AND EXISTS (
      SELECT 1 FROM public.recipes
      WHERE (recipes.storage_path = storage.objects.name OR recipes.cover_path = storage.objects.name)
      AND recipes.uploaded_by = auth.uid()
    )
  );
