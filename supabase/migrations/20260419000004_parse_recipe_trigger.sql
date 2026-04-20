-- Config table for environment-specific settings that can't be stored in git.
-- Values are inserted manually per environment — see README > Supabase Environment Setup.
-- The webhook that fires parse-recipe is configured via the Supabase Dashboard (Database → Webhooks),
-- not via a SQL trigger — pg_net named parameter syntax is incompatible with Supabase's pg_net version.
CREATE TABLE IF NOT EXISTS public.app_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- Only the service role can read or write app_config (no client access)
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
