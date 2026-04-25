-- Add canonical_name for ingredient search normalization.
-- Nullable: existing rows stay null until re-parsed via admin-reparse.
ALTER TABLE public.ingredients ADD COLUMN canonical_name text;
