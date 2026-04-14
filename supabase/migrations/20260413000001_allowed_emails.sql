-- Create the email allowlist table
CREATE TABLE public.allowed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;

-- Authenticated users can only check their own email (cannot enumerate the list)
CREATE POLICY "users can check own email"
  ON public.allowed_emails
  FOR SELECT
  TO authenticated
  USING (email = auth.email());
