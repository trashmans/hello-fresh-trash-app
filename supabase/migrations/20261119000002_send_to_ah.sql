-- Rollout phase 6 (docs/adr/0005): Send to AH — the switch and the run log.
--
-- public.households.send_enabled — admin-only switch, off by default. With it off, the
--   retailer-send Edge Function refuses to write to the household's AH list, so the code can
--   ship while the dry run (phase 5) runs its two weeks. Like ah_enabled it is set in the
--   dashboard / SQL Editor; households has no UPDATE policy, so members can't change it.
--
-- public.household_weekly_runs — one row per send (mode 'manual' now; 'scheduled' for the
--   automatic weekly run in phase 7): week, who started it, when, status, counts and an error
--   code. A partial unique index allows only one running send per household at a time; a
--   run left 'running' by a crashed function is closed as failed by the next send after
--   10 minutes (in retailer-send).
--
-- public.household_run_lines — what each send did per line: product or free text, the
--   action (add / increase / untick, or none when the list already had enough), the
--   quantities, where it came from and the outcome with an error code. Never AH's own error
--   text. This is shopping content, so it is kept 12 weeks (record of processing); the purge
--   job comes with rollout phase 8.
--
-- Access: household members can read their household's runs and lines (for the screen and
-- for checking what was sent). Nobody can write them through the API: only retailer-send,
-- which connects as the database owner, does. anon gets nothing.
-- Erasure: deleting the household deletes its runs and their lines (CASCADE); started_by is
-- cleared when that user is deleted.

ALTER TABLE public.households
  ADD COLUMN send_enabled boolean NOT NULL DEFAULT false;  -- admin-only (docs/adr/0005): lets retailer-send write to AH

CREATE TABLE public.household_weekly_runs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  week_start    date        NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  mode          text        NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'scheduled')),
  status        text        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'partial', 'failed')),
  started_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  lines_written smallint    NOT NULL DEFAULT 0 CHECK (lines_written >= 0),
  lines_failed  smallint    NOT NULL DEFAULT 0 CHECK (lines_failed >= 0),
  error_code    text        CHECK (error_code IS NULL OR error_code ~ '^[a-z_]{1,40}$'),
  CONSTRAINT household_weekly_runs_finished CHECK ((status = 'running') = (finished_at IS NULL))
);

CREATE UNIQUE INDEX household_weekly_runs_one_running
  ON public.household_weekly_runs (household_id) WHERE status = 'running';
CREATE INDEX household_weekly_runs_household_started_idx
  ON public.household_weekly_runs (household_id, started_at DESC);
CREATE INDEX household_weekly_runs_started_idx
  ON public.household_weekly_runs (started_at);  -- retention purge

CREATE TABLE public.household_run_lines (
  run_id              uuid     NOT NULL REFERENCES public.household_weekly_runs(id) ON DELETE CASCADE,
  line_no             smallint NOT NULL CHECK (line_no >= 0),
  product_external_id bigint   CHECK (product_external_id IS NULL OR product_external_id > 0),
  text                text     NOT NULL CHECK (char_length(text) BETWEEN 1 AND 120),
  action              text     CHECK (action IS NULL OR action IN ('add', 'increase', 'untick')),
  from_qty            smallint NOT NULL CHECK (from_qty >= 0),
  to_qty              smallint NOT NULL CHECK (to_qty >= 0),
  sources             text[]   NOT NULL CHECK (sources <@ ARRAY['staple', 'stockup', 'recipe']::text[] AND cardinality(sources) >= 1),
  outcome             text     NOT NULL CHECK (outcome IN ('written', 'already_enough', 'failed')),
  error_code          text     CHECK (error_code IS NULL OR error_code ~ '^[a-z_]{1,40}$'),
  PRIMARY KEY (run_id, line_no)
);

ALTER TABLE public.household_weekly_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_run_lines   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.household_weekly_runs, public.household_run_lines FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.household_weekly_runs, public.household_run_lines FROM authenticated;

CREATE POLICY "members can read household runs"
  ON public.household_weekly_runs FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));

CREATE POLICY "members can read household run lines"
  ON public.household_run_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.household_weekly_runs r
    WHERE r.id = run_id AND private.is_household_member(r.household_id)
  ));

-- Rollback (run manually, then `supabase migration repair --status reverted 20261119000002`).
-- Deletes the run log; the AH lists themselves are not touched:
-- DROP TABLE public.household_run_lines;
-- DROP TABLE public.household_weekly_runs;
-- ALTER TABLE public.households DROP COLUMN send_enabled;
