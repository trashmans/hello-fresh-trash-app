-- Retention jobs (rollout phase 8; docs/privacy/record-of-processing.md).
--
-- Until now nothing deleted old data on a schedule. private.run_retention() deletes what is
-- past its promised retention, and pg_cron (Supabase Cron) runs it every night:
--   household_weekly_runs (+ household_run_lines, CASCADE)  12 weeks after the send started
--   private.audit_events                                    12 months (the no-delete trigger
--                                                           allows exactly these rows)
--   private.data_requests                                   3 years after completion, or after
--                                                           receipt if never completed
--   public.invites (unused: expired or revoked)             once expired or revoked
-- Each run records one audit event, retention.purged, with the counts only (no contents).
-- Erasure requests still clear identifiers straight away; this only handles time limits.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

CREATE FUNCTION private.run_retention()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  runs     integer;
  audit    integer;
  requests integer;
  invites  integer;
BEGIN
  DELETE FROM public.household_weekly_runs WHERE started_at < now() - interval '12 weeks';
  GET DIAGNOSTICS runs = ROW_COUNT;

  DELETE FROM private.audit_events WHERE occurred_at < now() - interval '12 months';
  GET DIAGNOSTICS audit = ROW_COUNT;

  DELETE FROM private.data_requests
  WHERE coalesce(completed_on, received_on) < (now() - interval '3 years')::date;
  GET DIAGNOSTICS requests = ROW_COUNT;

  DELETE FROM public.invites
  WHERE accepted_at IS NULL AND (revoked_at IS NOT NULL OR expires_at <= now());
  GET DIAGNOSTICS invites = ROW_COUNT;

  INSERT INTO private.audit_events (action, detail)
  VALUES ('retention.purged', jsonb_build_object('runs', runs, 'audit_events', audit, 'data_requests', requests, 'invites', invites));

  RETURN jsonb_build_object('runs', runs, 'audit_events', audit, 'data_requests', requests, 'invites', invites);
END;
$$;
REVOKE EXECUTE ON FUNCTION private.run_retention() FROM PUBLIC, anon, authenticated;

-- Every night at 03:17 UTC (quiet time, not on the hour).
SELECT cron.schedule('hft-retention', '17 3 * * *', 'SELECT private.run_retention()');

-- Rollback (run manually, then `supabase migration repair --status reverted 20261121000004`).
-- Stops the nightly job; nothing already deleted comes back:
-- SELECT cron.unschedule('hft-retention');
-- DROP FUNCTION private.run_retention();
-- (pg_cron can stay enabled; DROP EXTENSION pg_cron would delete every scheduled job)
