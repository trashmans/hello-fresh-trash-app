-- Social tab, first version (docs/adr/0008): invites, friends and recipe shares.
--
-- The recipe catalogue stays shared: every signed-in user can already read every recipe
-- (20260418000001_recipes.sql). Social adds who your friends are and lets you recommend a
-- recipe to them with a note. Nothing here exposes shopping lists, staples or AH data.
--
-- public.invites          someone invited by email. A valid invite (not used, revoked or
--                         expired, 30 days) lets that email sign in; on first sign-in the
--                         invite is marked accepted, the email joins allowed_emails and the
--                         inviter and new user become friends. 5 invites per inviter per
--                         24 hours. Unused invites are deleted once expired or revoked
--                         (here, whenever anyone sends an invite or signs up; a scheduled
--                         purge comes with rollout phase 8).
-- public.friend_requests  a request to an existing user, pending until answered.
-- public.friendships      one row each way, so each person reads their own rows.
-- public.recipe_shares    a recipe recommended by one friend to another, with an optional
--                         note (280 characters); re-sharing replaces the note.
--
-- Access: every table has RLS. People read only rows they are part of (admins also read
-- invites). All changes go through the SECURITY DEFINER functions below, which check the
-- rules; the only direct write is deleting a share you sent or received. anon gets nothing.
-- Erasure: deleting a user deletes their invites, requests, friendships and shares (CASCADE).

-- Tables ------------------------------------------------------------------------------

CREATE TABLE public.invites (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) <= 254
                                          AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  invited_by  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '30 days',
  accepted_at timestamptz,
  accepted_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at  timestamptz
);
CREATE UNIQUE INDEX invites_one_open_per_inviter ON public.invites (invited_by, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invites_email_idx ON public.invites (email);

CREATE TABLE public.friend_requests (
  from_user  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_user, to_user),
  CHECK (from_user <> to_user)
);
CREATE INDEX friend_requests_to_idx ON public.friend_requests (to_user);

CREATE TABLE public.friendships (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);

CREATE TABLE public.recipe_shares (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id  uuid        NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  from_user  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note       text        CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 280),
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at    timestamptz,
  UNIQUE (recipe_id, from_user, to_user),
  CHECK (from_user <> to_user)
);
CREATE INDEX recipe_shares_to_idx ON public.recipe_shares (to_user, created_at DESC);

-- Row level security ----------------------------------------------------------------------

ALTER TABLE public.invites         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_shares   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invites, public.friend_requests, public.friendships, public.recipe_shares FROM anon;

CREATE POLICY "inviters and admins can read invites"
  ON public.invites FOR SELECT TO authenticated
  USING (invited_by = (SELECT auth.uid())
         OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = (SELECT auth.uid()) AND r.is_admin));

CREATE POLICY "people can read their friend requests"
  ON public.friend_requests FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IN (from_user, to_user));

CREATE POLICY "people can read their friendships"
  ON public.friendships FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "sender and recipient can read a share"
  ON public.recipe_shares FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IN (from_user, to_user));

CREATE POLICY "sender and recipient can delete a share"
  ON public.recipe_shares FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) IN (from_user, to_user));

-- Helpers ---------------------------------------------------------------------------------

CREATE FUNCTION private.purge_unused_invites()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM public.invites
  WHERE accepted_at IS NULL AND (revoked_at IS NOT NULL OR expires_at <= now());
$$;

CREATE FUNCTION private.make_friends(a uuid, b uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.friendships (user_id, friend_id) VALUES (a, b), (b, a) ON CONFLICT DO NOTHING;
  DELETE FROM public.friend_requests WHERE (from_user = a AND to_user = b) OR (from_user = b AND to_user = a);
$$;

-- Functions the app calls ----------------------------------------------------------------
-- Errors are raised with a short code as the message (invalid_email, already_user,
-- invite_limit, not_found, self, not_friends, invalid_note, too_many, not_ready) so the app
-- can show its own wording.

CREATE FUNCTION public.create_invite(p_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me    uuid := auth.uid();
  addr  text := lower(btrim(coalesce(p_email, '')));
  found uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF char_length(addr) > 254 OR addr !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;
  PERFORM private.purge_unused_invites();
  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = addr) THEN
    RAISE EXCEPTION 'already_user';
  END IF;
  SELECT id INTO found FROM public.invites
  WHERE invited_by = me AND email = addr AND accepted_at IS NULL AND revoked_at IS NULL;
  IF found IS NOT NULL THEN RETURN found; END IF;
  IF (SELECT count(*) FROM public.invites WHERE invited_by = me AND created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'invite_limit';
  END IF;
  INSERT INTO public.invites (email, invited_by) VALUES (addr, me) RETURNING id INTO found;
  INSERT INTO private.audit_events (actor_id, action) VALUES (me, 'social.invite_created');
  RETURN found;
END;
$$;

CREATE FUNCTION public.revoke_invite(p_invite uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.invites SET revoked_at = now()
  WHERE id = p_invite AND invited_by = auth.uid() AND accepted_at IS NULL AND revoked_at IS NULL;
$$;

CREATE FUNCTION public.request_friend(p_email text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me    uuid := auth.uid();
  addr  text := lower(btrim(coalesce(p_email, '')));
  other uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT u.id INTO other FROM auth.users u WHERE lower(u.email) = addr;
  IF other IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF other = me THEN RAISE EXCEPTION 'self'; END IF;
  IF EXISTS (SELECT 1 FROM public.friendships WHERE user_id = me AND friend_id = other) THEN
    RETURN 'already_friends';
  END IF;
  -- They asked first: asking back accepts.
  IF EXISTS (SELECT 1 FROM public.friend_requests WHERE from_user = other AND to_user = me) THEN
    PERFORM private.make_friends(me, other);
    RETURN 'friends';
  END IF;
  IF (SELECT count(*) FROM public.friend_requests WHERE from_user = me) >= 20 THEN
    RAISE EXCEPTION 'too_many';
  END IF;
  INSERT INTO public.friend_requests (from_user, to_user) VALUES (me, other) ON CONFLICT DO NOTHING;
  RETURN 'requested';
END;
$$;

CREATE FUNCTION public.answer_friend_request(p_from uuid, p_accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  DELETE FROM public.friend_requests WHERE from_user = p_from AND to_user = me;
  IF FOUND AND p_accept THEN PERFORM private.make_friends(me, p_from); END IF;
END;
$$;

CREATE FUNCTION public.remove_friend(p_friend uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM public.friendships
  WHERE (user_id = auth.uid() AND friend_id = p_friend) OR (user_id = p_friend AND friend_id = auth.uid());
$$;

CREATE FUNCTION public.share_recipe(p_recipe uuid, p_to uuid[], p_note text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me    uuid := auth.uid();
  note  text := nullif(btrim(coalesce(p_note, '')), '');
  n     integer;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF note IS NOT NULL AND char_length(note) > 280 THEN RAISE EXCEPTION 'invalid_note'; END IF;
  IF p_to IS NULL OR cardinality(p_to) = 0 OR cardinality(p_to) > 20 THEN RAISE EXCEPTION 'too_many'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recipes WHERE id = p_recipe AND status = 'ready') THEN
    RAISE EXCEPTION 'not_ready';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_to) AS t(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.friendships f WHERE f.user_id = me AND f.friend_id = t.id)
  ) THEN
    RAISE EXCEPTION 'not_friends';
  END IF;
  INSERT INTO public.recipe_shares (recipe_id, from_user, to_user, note)
  SELECT p_recipe, me, t.id, note FROM (SELECT DISTINCT unnest(p_to) AS id) t
  ON CONFLICT (recipe_id, from_user, to_user)
    DO UPDATE SET note = excluded.note, created_at = now(), seen_at = NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE FUNCTION public.mark_shares_seen(p_shares uuid[])
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.recipe_shares SET seen_at = now()
  WHERE id = ANY (p_shares) AND to_user = auth.uid() AND seen_at IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.create_invite(text), public.revoke_invite(uuid), public.request_friend(text),
  public.answer_friend_request(uuid, boolean), public.remove_friend(uuid), public.share_recipe(uuid, uuid[], text),
  public.mark_shares_seen(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invite(text), public.revoke_invite(uuid), public.request_friend(text),
  public.answer_friend_request(uuid, boolean), public.remove_friend(uuid), public.share_recipe(uuid, uuid[], text),
  public.mark_shares_seen(uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION private.purge_unused_invites(), private.make_friends(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Sign-in with an invite --------------------------------------------------------------------
-- The allowlist check also accepts a valid invite; on first sign-in the invite is used.

CREATE OR REPLACE FUNCTION public.enforce_email_allowlist()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.allowed_emails WHERE email = NEW.email)
     AND NOT EXISTS (
       SELECT 1 FROM public.invites
       WHERE email = lower(NEW.email) AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
     ) THEN
    RAISE EXCEPTION 'Email not on access list';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE FUNCTION private.use_invites_on_signup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  inv record;
BEGIN
  FOR inv IN
    UPDATE public.invites SET accepted_at = now(), accepted_by = NEW.id
    WHERE email = lower(NEW.email) AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
    RETURNING invited_by
  LOOP
    PERFORM private.make_friends(NEW.id, inv.invited_by);
  END LOOP;
  IF FOUND THEN
    INSERT INTO public.allowed_emails (email)
    SELECT NEW.email WHERE NOT EXISTS (SELECT 1 FROM public.allowed_emails WHERE email = NEW.email);
  END IF;
  PERFORM private.purge_unused_invites();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.use_invites_on_signup() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER use_invites_after_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.use_invites_on_signup();

-- Rollback (run manually, then `supabase migration repair --status reverted 20261121000002`).
-- Deletes all invites, friendships and shares; people who signed in through an invite keep
-- access (their email is in allowed_emails):
-- DROP TRIGGER use_invites_after_signup ON auth.users;
-- DROP FUNCTION private.use_invites_on_signup();
-- CREATE OR REPLACE FUNCTION public.enforce_email_allowlist() ... (body from 20260413000001_allowed_emails.sql);
-- DROP FUNCTION public.mark_shares_seen(uuid[]), public.share_recipe(uuid, uuid[], text), public.remove_friend(uuid),
--   public.answer_friend_request(uuid, boolean), public.request_friend(text), public.revoke_invite(uuid),
--   public.create_invite(text), private.make_friends(uuid, uuid), private.purge_unused_invites();
-- DROP TABLE public.recipe_shares, public.friendships, public.friend_requests, public.invites;
