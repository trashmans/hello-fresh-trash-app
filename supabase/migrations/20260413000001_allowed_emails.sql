-- RLS audit 2026-04-16: policies reviewed and confirmed correct.
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

-- Enforce allowlist at the database level before any account is created.
-- This prevents ghost accounts from users who are not on the allowlist.
-- A BEFORE INSERT trigger on auth.users rejects the signup entirely if the
-- email is not present — no account is created, no profile is written.
CREATE OR REPLACE FUNCTION public.enforce_email_allowlist()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.allowed_emails WHERE email = NEW.email
  ) THEN
    RAISE EXCEPTION 'Email not on access list';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS enforce_email_allowlist_before_signup ON auth.users;
CREATE TRIGGER enforce_email_allowlist_before_signup
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_email_allowlist();
