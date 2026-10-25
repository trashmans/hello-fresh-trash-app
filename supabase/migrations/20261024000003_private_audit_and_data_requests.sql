-- Audit log and data-request log, both in the private schema (docs/adr/0002-private-schema.md,
-- docs/privacy/data-requests.md). RLS on, no policies: only the service role and
-- SECURITY DEFINER functions write here.

-- Append-only record of security-relevant actions (account linked, token refreshed, run failed…).
-- Holds no shopping contents and no tokens. When a user or household is deleted, the FK
-- clears the identifier and keeps the event, which is the erasure behaviour the procedure describes.
CREATE TABLE private.audit_events (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  household_id uuid        REFERENCES public.households(id) ON DELETE SET NULL,
  actor_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  action       text        NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),   -- e.g. household.created
  detail       jsonb       NOT NULL DEFAULT '{}' CHECK (pg_column_size(detail) <= 2048),
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.audit_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX audit_events_household_occurred_idx ON private.audit_events (household_id, occurred_at);
CREATE INDEX audit_events_occurred_idx           ON private.audit_events (occurred_at);  -- retention purge

-- Rows can never be edited, except for the FK nulling an identifier on erasure.
CREATE FUNCTION private.audit_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id = OLD.id
     AND NEW.action = OLD.action
     AND NEW.detail = OLD.detail
     AND NEW.occurred_at = OLD.occurred_at
     AND (NEW.actor_id     IS NOT DISTINCT FROM OLD.actor_id     OR NEW.actor_id IS NULL)
     AND (NEW.household_id IS NOT DISTINCT FROM OLD.household_id OR NEW.household_id IS NULL)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'private.audit_events is append-only' USING ERRCODE = '42501';
END;
$$;

REVOKE EXECUTE ON FUNCTION private.audit_events_append_only() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE ON private.audit_events
  FOR EACH ROW EXECUTE FUNCTION private.audit_events_append_only();

-- Log of GDPR data requests. Deliberately holds no request contents and no link to the
-- requester: only enough to show each request was handled on time. Kept 3 years.
CREATE TABLE private.data_requests (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_type text        NOT NULL CHECK (request_type IN
                             ('access', 'portability', 'rectification', 'erasure', 'restriction', 'objection')),
  received_on  date        NOT NULL,
  due_on       date        GENERATED ALWAYS AS ((received_on + interval '1 month')::date) STORED,
  extended_to  date        CHECK (extended_to IS NULL OR extended_to <= received_on + interval '3 months'),
  verified_on  date,
  completed_on date,
  outcome      text        CHECK (outcome IN ('completed', 'refused', 'withdrawn', 'unverified')),
  handled_by   text        NOT NULL CHECK (char_length(handled_by) BETWEEN 1 AND 40),  -- first name only
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_requests_completed_has_outcome CHECK (completed_on IS NULL OR outcome IS NOT NULL)
);

ALTER TABLE private.data_requests ENABLE ROW LEVEL SECURITY;

-- Rollback (run manually, then `supabase migration repair --status reverted 20261024000003`):
-- DROP TABLE private.data_requests;
-- DROP TRIGGER audit_events_append_only ON private.audit_events;
-- DROP FUNCTION private.audit_events_append_only();
-- DROP TABLE private.audit_events;
