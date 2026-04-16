-- Enforce email allowlist at the database level, before a user account is created.
--
-- Problem this solves:
--   The client-side allowlist check in AuthContext signs out unauthorized users,
--   but Supabase still creates the auth.users record and fires the handle_new_user
--   trigger before the app gets a chance to check. This leaves ghost accounts in
--   the database for anyone who attempts to sign in without being on the allowlist.
--
-- Solution:
--   A BEFORE INSERT trigger on auth.users raises an exception if the email is not
--   in allowed_emails. This rolls back the entire signup transaction — no account
--   is created, no profile is written. The client-side check in AuthContext remains
--   as a second layer of defence.

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
