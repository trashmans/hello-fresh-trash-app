-- Seed file: run this after migrations to populate initial data on a new environment.
--
-- Setup order for a new Supabase project:
--   1. Run migrations in order via SQL Editor:
--      - supabase/migrations/20260413000001_allowed_emails.sql
--      - supabase/migrations/20260413000002_profiles.sql
--      - supabase/migrations/20260416000001_enforce_allowlist_on_signup.sql
--   2. Run this seed file with real emails substituted in
--   3. Configure Google OAuth provider in Authentication → Providers
--   4. Set URL Configuration in Authentication → URL Configuration
--
-- DO NOT commit real email addresses here — this repo is public.
-- Swap in real emails locally before running.

-- Allowlisted users — replace before running
INSERT INTO public.allowed_emails (email) VALUES
  ('your-email@example.com'),
  ('collaborator-email@example.com');
