-- Add parsing columns to recipes table and update status machine.

-- Expand status CHECK constraint to include processing and failed states.
ALTER TABLE public.recipes
  DROP CONSTRAINT recipes_status_check,
  ADD CONSTRAINT recipes_status_check
    CHECK (status IN ('pending', 'processing', 'ready', 'rejected', 'failed'));

-- New columns for the parsing pipeline
ALTER TABLE public.recipes
  ADD COLUMN content_hash         text,
  ADD COLUMN ingredient_fingerprint text,
  ADD COLUMN cook_time_minutes    integer,
  ADD COLUMN prep_time_minutes    integer,
  ADD COLUMN servings             integer,
  ADD COLUMN difficulty           text,
  ADD COLUMN cuisine              text,
  ADD COLUMN tags                 text[]   DEFAULT '{}',
  ADD COLUMN steps                jsonb    DEFAULT '[]',
  ADD COLUMN source_name          text,
  ADD COLUMN source_url           text,
  ADD COLUMN rejection_reason     text,
  ADD COLUMN retry_count          integer  NOT NULL DEFAULT 0,
  ADD COLUMN processing_started_at   timestamptz,
  ADD COLUMN processing_completed_at timestamptz;
