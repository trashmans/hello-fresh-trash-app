CREATE TABLE public.shopping_lists (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id) NOT NULL UNIQUE,
  recipe_selections jsonb NOT NULL DEFAULT '[]',
  adjusted_items    jsonb NOT NULL DEFAULT '[]',
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own shopping_list"
  ON public.shopping_lists FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "users can insert own shopping_list"
  ON public.shopping_lists FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can update own shopping_list"
  ON public.shopping_lists FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);
