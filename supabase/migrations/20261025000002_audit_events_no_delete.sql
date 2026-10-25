-- Review follow-up to 20261024000003 (PR #104). A new migration because that file is
-- already applied on preview and production and must never be edited.
--
-- 1. Rewrites the append-only check to say what it allows: an identifier may stay the
--    same, or be cleared (NULL) when a user or household is erased. Same behaviour
--    as before, clearer wording.
-- 2. Blocks deleting audit events until they are past the 12-month retention period
--    (docs/privacy/record-of-processing.md). The retention purge can still delete old
--    rows; nothing newer can be removed. Erasure requests clear identifiers instead.

CREATE OR REPLACE FUNCTION private.audit_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id = OLD.id
     AND NEW.action = OLD.action
     AND NEW.detail = OLD.detail
     AND NEW.occurred_at = OLD.occurred_at
     AND (
       NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id
       OR (NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL)          -- cleared on erasure
     )
     AND (
       NEW.household_id IS NOT DISTINCT FROM OLD.household_id
       OR (NEW.household_id IS NULL AND OLD.household_id IS NOT NULL)  -- cleared on erasure
     )
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'private.audit_events is append-only' USING ERRCODE = '42501';
END;
$$;

CREATE FUNCTION private.audit_events_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.occurred_at < now() - interval '12 months' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'private.audit_events rows can only be deleted after 12 months' USING ERRCODE = '42501';
END;
$$;

REVOKE EXECUTE ON FUNCTION private.audit_events_append_only() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.audit_events_no_delete()   FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON private.audit_events
  FOR EACH ROW EXECUTE FUNCTION private.audit_events_no_delete();

-- Rollback (run manually, then `supabase migration repair --status reverted 20261025000002`):
-- DROP TRIGGER audit_events_no_delete ON private.audit_events;
-- DROP FUNCTION private.audit_events_no_delete();
-- (the rewritten append-only check behaves identically to the original, so it can stay)
