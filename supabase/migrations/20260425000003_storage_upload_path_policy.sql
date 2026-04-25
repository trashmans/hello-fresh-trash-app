-- Tighten storage upload policy to restrict each user to their own path prefix.
-- Storage paths are now recipes/<user-id>/<uuid>.pdf — enforced here at the DB level.
DROP POLICY IF EXISTS "recipe-pdfs: authenticated users can upload" ON storage.objects;

CREATE POLICY "recipe-pdfs: authenticated users can upload to own path"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'recipe-pdfs'
    AND name LIKE ('recipes/' || auth.uid()::text || '/%')
  );
