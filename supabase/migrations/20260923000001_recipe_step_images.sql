-- Per-step recipe photos, extracted client-side from the PDF's numbered
-- "steps" page (see src/lib/pdfStepImages.js), the same way cover thumbnails
-- are extracted from page 1 (see src/lib/pdfCover.js). One row per matched
-- step photo; a recipe with no reliably-matched photos simply has no rows
-- here (see RecipePreviewPanel: images are only shown when the row count
-- exactly matches the number of parsed steps).
CREATE TABLE public.recipe_step_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id     uuid REFERENCES public.recipes(id) ON DELETE CASCADE NOT NULL,
  step_index    integer NOT NULL,
  storage_path  text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (recipe_id, step_index)
);

ALTER TABLE public.recipe_step_images ENABLE ROW LEVEL SECURITY;

-- Shared catalogue, same as ingredients: any authenticated user can read.
CREATE POLICY "authenticated users can read all recipe step images"
  ON public.recipe_step_images FOR SELECT
  TO authenticated
  USING (true);

-- Unlike ingredients (written server-side by parse-recipe), step images are
-- extracted and uploaded client-side at upload time, same as covers — so
-- this needs a client-writable INSERT policy. There's no user_id column on
-- this table directly; ownership is checked by joining back to the parent
-- recipe, the same way the recipe-pdfs storage delete policy already does.
CREATE POLICY "uploaders can insert step images for their own recipes"
  ON public.recipe_step_images FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.recipes
      WHERE recipes.id = recipe_step_images.recipe_id
      AND recipes.uploaded_by = auth.uid()
    )
  );

-- No UPDATE/DELETE policy needed: rows are cascade-deleted with their recipe
-- (ON DELETE CASCADE above) — that only removes the DB rows, though, not the
-- underlying storage files. See the storage DELETE policy extension below
-- and the corresponding cleanup added to RecipeCatalogue.jsx's delete handler.

-- Storage: extend the recipe-pdfs bucket's "own path" upload policy to also
-- allow steps/<user-id>/%, alongside recipes/<user-id>/% and covers/<user-id>/%.
DROP POLICY IF EXISTS "recipe-pdfs: authenticated users can upload to own path" ON storage.objects;

CREATE POLICY "recipe-pdfs: authenticated users can upload to own path"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'recipe-pdfs'
    AND (
      name LIKE ('recipes/' || auth.uid()::text || '/%')
      OR name LIKE ('covers/' || auth.uid()::text || '/%')
      OR name LIKE ('steps/' || auth.uid()::text || '/%')
    )
  );

-- Extend the delete policy so uploaders (and admins, via the existing
-- admin-delete policy) can also delete a recipe's step image files.
DROP POLICY IF EXISTS "recipe-pdfs: uploaders can delete their own files" ON storage.objects;

CREATE POLICY "recipe-pdfs: uploaders can delete their own files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'recipe-pdfs'
    AND (
      EXISTS (
        SELECT 1 FROM public.recipes
        WHERE (recipes.storage_path = storage.objects.name OR recipes.cover_path = storage.objects.name)
        AND recipes.uploaded_by = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.recipe_step_images
        JOIN public.recipes ON recipes.id = recipe_step_images.recipe_id
        WHERE recipe_step_images.storage_path = storage.objects.name
        AND recipes.uploaded_by = auth.uid()
      )
    )
  );
