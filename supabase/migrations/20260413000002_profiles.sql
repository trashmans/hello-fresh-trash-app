-- Create the profiles table
-- GDPR deletion strategy:
--   - This table cascades from auth.users (deleting auth record wipes profile)
--   - Future tables referencing profiles(id) should use ON DELETE SET NULL for
--     user-generated content (recipes, reviews) so content is preserved but
--     personal attribution is removed. Use ON DELETE CASCADE for personal data
--     (favourites, shopping lists) that has no value without the user.
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  avatar_url text,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read profiles (needed for recipe attribution)
CREATE POLICY "authenticated users can read profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Users can only update their own profile
CREATE POLICY "users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid());

-- Auto-create a profile row when a new user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
