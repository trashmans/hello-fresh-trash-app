-- Social groups, step G2 (docs/adr/0011): share a recipe with groups as well as friends.
--
-- public.recipe_shares.group_id — the group a share came through, shown as "via Family".
-- Still one row per recipient (so each person can delete their own copy, and a share
-- outlives the group: ON DELETE SET NULL). A person reached both as a friend and through a
-- group gets one share, marked with the group.
--
-- public.share_recipe_to(recipe, friends[], groups[], note): friends must be the sender's
-- friends (as share_recipe() checks); for a group the sender must be a member, and every
-- other member gets it, friend or not (members already see each other). At most 60 people
-- per share. share_recipe() stays for older app versions. Errors as in
-- 20261121000002_social.sql (not_friends, too_many, invalid_note, not_ready), plus
-- not_group_member.

ALTER TABLE public.recipe_shares
  ADD COLUMN group_id uuid REFERENCES public.social_groups(id) ON DELETE SET NULL;

CREATE FUNCTION public.share_recipe_to(p_recipe uuid, p_to uuid[], p_groups uuid[], p_note text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me   uuid := auth.uid();
  note text := nullif(btrim(coalesce(p_note, '')), '');
  n    integer;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF note IS NOT NULL AND char_length(note) > 280 THEN RAISE EXCEPTION 'invalid_note'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recipes WHERE id = p_recipe AND status = 'ready') THEN
    RAISE EXCEPTION 'not_ready';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(p_to, '{}')) AS t(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.friendships f WHERE f.user_id = me AND f.friend_id = t.id)
  ) THEN
    RAISE EXCEPTION 'not_friends';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(p_groups, '{}')) AS g(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.social_group_members m WHERE m.group_id = g.id AND m.user_id = me)
  ) THEN
    RAISE EXCEPTION 'not_group_member';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS share_targets (user_id uuid PRIMARY KEY, group_id uuid) ON COMMIT DROP;
  TRUNCATE share_targets;
  -- Through a group first (marked with the first group picked), then friends not yet in.
  INSERT INTO share_targets (user_id, group_id)
  SELECT DISTINCT ON (m.user_id) m.user_id, m.group_id
  FROM unnest(coalesce(p_groups, '{}')) WITH ORDINALITY AS g(id, pos)
  JOIN public.social_group_members m ON m.group_id = g.id
  WHERE m.user_id <> me
  ORDER BY m.user_id, g.pos;
  INSERT INTO share_targets (user_id, group_id)
  SELECT DISTINCT t.id, NULL::uuid FROM unnest(coalesce(p_to, '{}')) AS t(id) WHERE t.id <> me
  ON CONFLICT (user_id) DO NOTHING;

  n := (SELECT count(*) FROM share_targets);
  IF n = 0 OR n > 60 THEN RAISE EXCEPTION 'too_many'; END IF;

  INSERT INTO public.recipe_shares (recipe_id, from_user, to_user, note, group_id)
  SELECT p_recipe, me, t.user_id, note, t.group_id FROM share_targets t
  ON CONFLICT (recipe_id, from_user, to_user)
    DO UPDATE SET note = excluded.note, group_id = excluded.group_id, created_at = now(), seen_at = NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.share_recipe_to(uuid, uuid[], uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_recipe_to(uuid, uuid[], uuid[], text) TO authenticated;

-- Rollback (run manually, then `supabase migration repair --status reverted 20261126000002`).
-- Shares made through groups stay, without their group:
-- DROP FUNCTION public.share_recipe_to(uuid, uuid[], uuid[], text);
-- ALTER TABLE public.recipe_shares DROP COLUMN group_id;
