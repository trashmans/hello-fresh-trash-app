-- "Photos from the page" for link recipes (docs/adr/0009, amended 25 Nov 2026).
--
-- public.recipes.page_images — storage paths (recipe-pdfs bucket, steps/<uploader>/…) of up
-- to 6 photos from the post a link recipe came from, for sites whose step photos are not
-- tied to steps. Written only by parse-recipe (service role); read with the recipe (the
-- existing SELECT policies). Link recipes whose steps have photos (HelloFresh.com, or
-- schema.org HowToStep images) get recipe_step_images rows instead, also from parse-recipe.
--
-- The uploader's storage DELETE policy also covers these files, so deleting a recipe in the
-- app removes them, like its PDF, cover and step photos.

ALTER TABLE public.recipes
  ADD COLUMN page_images text[] NOT NULL DEFAULT '{}'
    CONSTRAINT recipes_page_images_max CHECK (cardinality(page_images) <= 6);

DROP POLICY IF EXISTS "recipe-pdfs: uploaders can delete their own files" ON storage.objects;

CREATE POLICY "recipe-pdfs: uploaders can delete their own files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'recipe-pdfs'
    AND (
      EXISTS (
        SELECT 1 FROM public.recipes
        WHERE (recipes.storage_path = storage.objects.name
               OR recipes.cover_path = storage.objects.name
               OR storage.objects.name = ANY (recipes.page_images))
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

-- Rollback (run manually, then `supabase migration repair --status reverted 20261125000001`).
-- Remove the files first (they are listed in page_images), then:
-- DROP POLICY "recipe-pdfs: uploaders can delete their own files" ON storage.objects;
-- CREATE POLICY "recipe-pdfs: uploaders can delete their own files" ON storage.objects FOR DELETE TO authenticated
--   USING (bucket_id = 'recipe-pdfs' AND (
--     EXISTS (SELECT 1 FROM public.recipes WHERE (recipes.storage_path = storage.objects.name OR recipes.cover_path = storage.objects.name) AND recipes.uploaded_by = auth.uid())
--     OR EXISTS (SELECT 1 FROM public.recipe_step_images JOIN public.recipes ON recipes.id = recipe_step_images.recipe_id
--                WHERE recipe_step_images.storage_path = storage.objects.name AND recipes.uploaded_by = auth.uid())));
-- ALTER TABLE public.recipes DROP COLUMN page_images;
