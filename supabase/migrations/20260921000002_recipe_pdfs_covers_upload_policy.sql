-- 20260911000001_recipe_cover_path.sql was supposed to extend this INSERT policy
-- to also allow covers/<user-id>/%, but the live database never actually picked
-- that change up (confirmed via `select ... from pg_policies` in the Supabase
-- SQL editor on 2026-09-21 -- the live policy still only allowed recipes/<user-id>/%).
-- Re-asserting it here, unconditionally, so this environment (and any other) is
-- guaranteed to end up with the correct policy regardless of what happened before.
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
