-- Food map, phase F1c (docs/adr/0012): what the place-search Edge Function needs to use
-- OpenStreetMap's Nominatim within its usage policy (https://operations.osmfoundation.org/policies/nominatim/):
--
-- private.nominatim_throttle  one row: when we last called Nominatim. The policy allows at most
--                             one request a second for the whole app, so every call first takes
--                             the slot (public.take_nominatim_slot); no slot means wait or "busy".
-- private.place_cache         reverse lookups only: coarse cell (1 decimal, ~11 km) → nearest
--                             city. No user, no photo, no exact location; reused for 30 days, so
--                             the same city is asked for once. Typed searches are not cached.
-- private.place_search_usage  per-user count in the current hour (300), so one person can't use
--                             up the app's share.
--
-- All three are in the private schema (not exposed by the API) with RLS on and no policies:
-- nobody reads or writes them directly. The functions below are for the Edge Function only
-- (service_role). A nightly job deletes cache rows older than 30 days and usage rows older
-- than a day.

CREATE TABLE private.nominatim_throttle (
  id      integer     PRIMARY KEY CHECK (id = 1),
  last_at timestamptz NOT NULL
);
INSERT INTO private.nominatim_throttle VALUES (1, '-infinity');

CREATE TABLE private.place_cache (
  key        text        PRIMARY KEY CHECK (char_length(key) <= 60),
  result     jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE private.place_search_usage (
  user_id      uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  uses         integer     NOT NULL
);

ALTER TABLE private.nominatim_throttle ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.place_cache        ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.place_search_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.nominatim_throttle, private.place_cache, private.place_search_usage FROM PUBLIC, anon, authenticated;

-- True when this call may go to Nominatim now (at least 1.1 s after the last one).
CREATE FUNCTION public.take_nominatim_slot()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE private.nominatim_throttle SET last_at = clock_timestamp()
  WHERE id = 1 AND last_at <= clock_timestamp() - interval '1100 milliseconds';
  RETURN FOUND;
END;
$$;

-- Counts one place search for a user; false when they are over p_limit this hour.
CREATE FUNCTION public.use_place_search(p_user uuid, p_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  INSERT INTO private.place_search_usage AS u (user_id, window_start, uses) VALUES (p_user, now(), 1)
  ON CONFLICT (user_id) DO UPDATE SET
    window_start = CASE WHEN u.window_start < now() - interval '1 hour' THEN now() ELSE u.window_start END,
    uses         = CASE WHEN u.window_start < now() - interval '1 hour' THEN 1 ELSE least(u.uses + 1, p_limit + 1) END
  RETURNING uses INTO n;
  RETURN n <= p_limit;
END;
$$;

-- A cached reverse lookup less than 30 days old: {"result": …} (result may be null: no city
-- there), or NULL when there is none.
CREATE FUNCTION public.place_cache_get(p_key text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('result', result) FROM private.place_cache
  WHERE key = p_key AND fetched_at > now() - interval '30 days';
$$;

CREATE FUNCTION public.place_cache_put(p_key text, p_result jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO private.place_cache (key, result, fetched_at) VALUES (p_key, p_result, now())
  ON CONFLICT (key) DO UPDATE SET result = excluded.result, fetched_at = excluded.fetched_at;
$$;

REVOKE EXECUTE ON FUNCTION public.take_nominatim_slot(), public.use_place_search(uuid, integer),
  public.place_cache_get(text), public.place_cache_put(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_nominatim_slot(), public.use_place_search(uuid, integer),
  public.place_cache_get(text), public.place_cache_put(text, jsonb) TO service_role;

CREATE FUNCTION private.purge_place_search()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM private.place_cache WHERE fetched_at < now() - interval '30 days';
  DELETE FROM private.place_search_usage WHERE window_start < now() - interval '1 day';
$$;
REVOKE EXECUTE ON FUNCTION private.purge_place_search() FROM PUBLIC, anon, authenticated;

-- Every night at 03:41 UTC (after hft-retention at 03:17).
SELECT cron.schedule('hft-place-search-purge', '41 3 * * *', 'SELECT private.purge_place_search()');

-- Rollback (run manually, then `supabase migration repair --status reverted 20261127000002`):
-- SELECT cron.unschedule('hft-place-search-purge');
-- DROP FUNCTION private.purge_place_search();
-- DROP FUNCTION public.place_cache_put(text, jsonb), public.place_cache_get(text),
--   public.use_place_search(uuid, integer), public.take_nominatim_slot();
-- DROP TABLE private.place_search_usage, private.place_cache, private.nominatim_throttle;
