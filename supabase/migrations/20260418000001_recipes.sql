-- recipes table
CREATE TABLE public.recipes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  filename     text NOT NULL,
  storage_path text NOT NULL,
  name         text,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'ready', 'rejected')),
  created_at   timestamptz DEFAULT now()
);

-- With RLS on and no policy, nobody can access the table.
-- Policies below define exactly what each role is allowed to do.
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all recipes (crowd-sourced catalogue)
CREATE POLICY "authenticated users can read all recipes"
  ON public.recipes FOR SELECT
  TO authenticated
  USING (true);

-- Any authenticated user can upload a recipe
CREATE POLICY "authenticated users can insert recipes"
  ON public.recipes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = uploaded_by);

-- Uploaders can delete their own recipes
-- uploaded_by is nullable (preserved on user deletion), so orphaned recipes
-- cannot be deleted by anyone through the client.
CREATE POLICY "uploaders can delete their own recipes"
  ON public.recipes FOR DELETE
  TO authenticated
  USING (auth.uid() = uploaded_by);

-- No UPDATE policy — reserved for the parse-recipe edge function (service role)

-- Storage policies for the recipe-pdfs bucket.
-- Run AFTER creating the recipe-pdfs bucket in the Supabase dashboard.

-- Allow authenticated users to upload files
CREATE POLICY "recipe-pdfs: authenticated users can upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'recipe-pdfs');

-- Allow authenticated users to read files (required for createSignedUrl)
CREATE POLICY "recipe-pdfs: authenticated users can read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'recipe-pdfs');

-- Only the uploader can delete their own files.
-- Joins back to the recipes table on storage_path to verify ownership.
CREATE POLICY "recipe-pdfs: uploaders can delete their own files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'recipe-pdfs'
    AND EXISTS (
      SELECT 1 FROM public.recipes
      WHERE recipes.storage_path = storage.objects.name
      AND recipes.uploaded_by = auth.uid()
    )
  );
