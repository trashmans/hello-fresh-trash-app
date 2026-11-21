-- Shared household list, step 3 (contract; plan in 20261106000001_household_recipe_picks.sql).
--
-- Since 15 Nov (20261115000001) the app reads and writes the household tables
-- (household_recipe_picks, household_list_adjustments) and only kept copying each list into
-- the caller's public.shopping_lists row as a rollback net. That copy stops in the same
-- release, so the old per-user table and the no-op sync_household_shopping_list() go.
-- An app version still running during the deploy only logs a warning when its copy fails.

DROP FUNCTION IF EXISTS public.sync_household_shopping_list(jsonb, jsonb);
DROP TABLE IF EXISTS public.shopping_lists;

-- Rollback: not possible without data loss (the per-user copies are gone). The household
-- tables hold every list; to restore the old table, re-run 20260425000001_shopping_lists.sql
-- (and its later policy migrations) and deploy an app version that writes it.
