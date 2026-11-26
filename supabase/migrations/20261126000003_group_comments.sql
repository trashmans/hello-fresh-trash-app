-- Social groups, step G5 (docs/adr/0011): comments on recipes, visible to one group only.
--
-- public.recipe_group_comments  a comment (1–500 characters) by a group member on a recipe,
--                               in a group. Members of that group read them; nobody else.
--                               No editing. The author can delete their own (also after
--                               leaving the group); the group's creator can delete any.
--                               At most 30 comments per person per hour.
-- Kept while the group exists: deleting the group, the recipe or the author's account
-- deletes them (CASCADE). A member who leaves keeps their comments in the group.
--
-- Access: RLS, members read; writes only through add_group_comment() and
-- delete_group_comment() (errors as short codes: invalid_comment, comment_limit,
-- not_group_member, not_ready). anon gets nothing.

CREATE TABLE public.recipe_group_comments (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid        NOT NULL REFERENCES public.social_groups(id) ON DELETE CASCADE,
  recipe_id  uuid        NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  author     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body       text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500 AND body = btrim(body)),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recipe_group_comments_recipe_idx ON public.recipe_group_comments (recipe_id, group_id, created_at);
CREATE INDEX recipe_group_comments_group_idx ON public.recipe_group_comments (group_id, created_at DESC);
CREATE INDEX recipe_group_comments_author_idx ON public.recipe_group_comments (author, created_at DESC);

ALTER TABLE public.recipe_group_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recipe_group_comments FROM anon;

CREATE POLICY "group members can read the group's comments"
  ON public.recipe_group_comments FOR SELECT TO authenticated
  USING (private.is_group_member(group_id));

CREATE FUNCTION public.add_group_comment(p_group uuid, p_recipe uuid, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me   uuid := auth.uid();
  body text := btrim(regexp_replace(replace(coalesce(p_body, ''), E'\r', ''), E'\n{3,}', E'\n\n', 'g'));
  cid  uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF char_length(body) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_comment'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.social_group_members WHERE group_id = p_group AND user_id = me) THEN
    RAISE EXCEPTION 'not_group_member';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recipes WHERE id = p_recipe AND status = 'ready') THEN
    RAISE EXCEPTION 'not_ready';
  END IF;
  IF (SELECT count(*) FROM public.recipe_group_comments WHERE author = me AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'comment_limit';
  END IF;
  INSERT INTO public.recipe_group_comments (group_id, recipe_id, author, body)
  VALUES (p_group, p_recipe, me, body) RETURNING id INTO cid;
  RETURN cid;
END;
$$;

-- The author, or the creator of the comment's group.
CREATE FUNCTION public.delete_group_comment(p_comment uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM public.recipe_group_comments c
  WHERE c.id = p_comment
    AND (c.author = auth.uid()
         OR EXISTS (SELECT 1 FROM public.social_groups g WHERE g.id = c.group_id AND g.created_by = auth.uid()));
$$;

REVOKE EXECUTE ON FUNCTION public.add_group_comment(uuid, uuid, text), public.delete_group_comment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_group_comment(uuid, uuid, text), public.delete_group_comment(uuid) TO authenticated;

-- Rollback (run manually, then `supabase migration repair --status reverted 20261126000003`).
-- Deletes every comment:
-- DROP FUNCTION public.delete_group_comment(uuid), public.add_group_comment(uuid, uuid, text);
-- DROP TABLE public.recipe_group_comments;
