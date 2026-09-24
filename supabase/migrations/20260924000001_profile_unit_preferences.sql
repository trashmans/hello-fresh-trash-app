-- Per-user display preferences for how measurements are shown: oven
-- temperature (Fahrenheit/Celsius) and, independently, the ingredient
-- measurement system for volume and for mass (US customary or metric).
-- This is purely a display preference — stored ingredient quantities and
-- units are never rewritten; conversion happens client-side at render time
-- (see src/lib/units.js).
--
-- No new RLS policy is needed: the existing "users can update own profile"
-- UPDATE policy on public.profiles (id = auth.uid()) already covers these
-- new columns on the same row, and the existing "authenticated users can
-- read profiles" SELECT policy already covers reading them back.
ALTER TABLE public.profiles
  ADD COLUMN temperature_unit text NOT NULL DEFAULT 'F' CHECK (temperature_unit IN ('F', 'C')),
  ADD COLUMN volume_unit      text NOT NULL DEFAULT 'us' CHECK (volume_unit IN ('us', 'metric')),
  ADD COLUMN mass_unit        text NOT NULL DEFAULT 'us' CHECK (mass_unit IN ('us', 'metric'));
