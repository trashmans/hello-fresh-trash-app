-- Social groups, step G1 (docs/adr/0011): named groups of friends.
--
-- public.social_groups         a group: name (1–40 characters, spaces squeezed) and who made it.
--                              One person can make 10 groups.
-- public.social_group_members  who is in it, creator included (one row each), at most 30.
--                              seen_at: when the member saw "you were added" (the creator's
--                              own row starts seen).
--
-- Rules: only the creator renames, deletes, adds or removes people; only the creator's
-- friends can be added; anyone but the creator can leave. Members see the group's name and
-- every member (names come from profiles, whose email column stays hidden). Someone who stops
-- being the creator's friend stays in the group until removed. Later steps use groups for
-- sharing, a Recipes filter, a feed and comments.
--
-- Access: RLS on both tables; members read their groups' rows. All changes go through the
-- SECURITY DEFINER functions below (errors are short codes, as in 20261121000002_social.sql).
-- anon gets nothing. Erasure: deleting a user deletes the groups they made and their
-- memberships (CASCADE).

CREATE TABLE public.social_groups (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40
                                         AND name = btrim(regexp_replace(name, '\s+', ' ', 'g'))),
  created_by uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX social_groups_created_by_idx ON public.social_groups (created_by);

CREATE TABLE public.social_group_members (
  group_id uuid        NOT NULL REFERENCES public.social_groups(id) ON DELETE CASCADE,
  user_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  seen_at  timestamptz,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX social_group_members_user_idx ON public.social_group_members (user_id);

-- Row level security ----------------------------------------------------------------------

ALTER TABLE public.social_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_group_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_groups, public.social_group_members FROM anon;

-- Membership check outside RLS, so the members policy doesn't look up itself.
CREATE FUNCTION private.is_group_member(p_group uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.social_group_members WHERE group_id = p_group AND user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION private.is_group_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_group_member(uuid) TO authenticated;

CREATE POLICY "members can read their groups"
  ON public.social_groups FOR SELECT TO authenticated
  USING (private.is_group_member(id));

CREATE POLICY "members can read who is in their groups"
  ON public.social_group_members FOR SELECT TO authenticated
  USING (private.is_group_member(group_id));

-- Helpers ---------------------------------------------------------------------------------

CREATE FUNCTION private.clean_group_name(p_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
BEGIN
  IF char_length(n) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'invalid_group_name'; END IF;
  RETURN n;
END;
$$;

CREATE FUNCTION private.require_group_owner(p_group uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.social_groups WHERE id = p_group AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'not_group_owner';
  END IF;
END;
$$;

-- Functions the app calls ----------------------------------------------------------------

CREATE FUNCTION public.create_group(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me  uuid := auth.uid();
  n   text := private.clean_group_name(p_name);
  gid uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF (SELECT count(*) FROM public.social_groups WHERE created_by = me) >= 10 THEN
    RAISE EXCEPTION 'group_limit';
  END IF;
  INSERT INTO public.social_groups (name, created_by) VALUES (n, me) RETURNING id INTO gid;
  INSERT INTO public.social_group_members (group_id, user_id, seen_at) VALUES (gid, me, now());
  RETURN gid;
END;
$$;

CREATE FUNCTION public.rename_group(p_group uuid, p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_group_owner(p_group);
  UPDATE public.social_groups SET name = private.clean_group_name(p_name) WHERE id = p_group;
END;
$$;

CREATE FUNCTION public.delete_group(p_group uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_group_owner(p_group);
  DELETE FROM public.social_groups WHERE id = p_group;
END;
$$;

CREATE FUNCTION public.add_group_members(p_group uuid, p_users uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me uuid := auth.uid();
  n  integer;
BEGIN
  PERFORM private.require_group_owner(p_group);
  IF p_users IS NULL OR cardinality(p_users) = 0 THEN RETURN 0; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_users) AS t(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.friendships f WHERE f.user_id = me AND f.friend_id = t.id)
  ) THEN
    RAISE EXCEPTION 'not_friends';
  END IF;
  -- Lock the group so two adds at once can't pass the size check together.
  PERFORM 1 FROM public.social_groups WHERE id = p_group FOR UPDATE;
  INSERT INTO public.social_group_members (group_id, user_id)
  SELECT p_group, t.id FROM (SELECT DISTINCT unnest(p_users) AS id) t
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF (SELECT count(*) FROM public.social_group_members WHERE group_id = p_group) > 30 THEN
    RAISE EXCEPTION 'group_full';
  END IF;
  RETURN n;
END;
$$;

CREATE FUNCTION public.remove_group_member(p_group uuid, p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.require_group_owner(p_group);
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'self'; END IF;
  DELETE FROM public.social_group_members WHERE group_id = p_group AND user_id = p_user;
END;
$$;

-- Anyone but the creator can leave (the creator deletes the group instead).
CREATE FUNCTION public.leave_group(p_group uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM public.social_group_members m
  WHERE m.group_id = p_group AND m.user_id = auth.uid()
    AND NOT EXISTS (SELECT 1 FROM public.social_groups g WHERE g.id = p_group AND g.created_by = auth.uid());
$$;

CREATE FUNCTION public.mark_groups_seen(p_groups uuid[])
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.social_group_members SET seen_at = now()
  WHERE group_id = ANY (p_groups) AND user_id = auth.uid() AND seen_at IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.create_group(text), public.rename_group(uuid, text), public.delete_group(uuid),
  public.add_group_members(uuid, uuid[]), public.remove_group_member(uuid, uuid), public.leave_group(uuid),
  public.mark_groups_seen(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group(text), public.rename_group(uuid, text), public.delete_group(uuid),
  public.add_group_members(uuid, uuid[]), public.remove_group_member(uuid, uuid), public.leave_group(uuid),
  public.mark_groups_seen(uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION private.clean_group_name(text), private.require_group_owner(uuid) FROM PUBLIC, anon, authenticated;

-- Rollback (run manually, then `supabase migration repair --status reverted 20261126000001`).
-- Deletes every group and membership:
-- DROP FUNCTION public.mark_groups_seen(uuid[]), public.leave_group(uuid), public.remove_group_member(uuid, uuid),
--   public.add_group_members(uuid, uuid[]), public.delete_group(uuid), public.rename_group(uuid, text),
--   public.create_group(text), private.require_group_owner(uuid), private.clean_group_name(text);
-- DROP TABLE public.social_group_members, public.social_groups;
-- DROP FUNCTION private.is_group_member(uuid);
