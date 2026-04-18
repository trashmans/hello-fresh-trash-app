-- Roles table — separates identity (profiles) from permissions.
-- is_admin is only settable via the Supabase dashboard (no client-writable policy).
-- Scales to additional roles (moderator, editor, etc.) by adding columns.
CREATE TABLE public.user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Users can only read their own role — cannot enumerate who else is admin
CREATE POLICY "users can read own role"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
