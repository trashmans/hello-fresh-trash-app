-- Food map, phase F1d (docs/adr/0012): who sees a person's new food photos, set once in
-- Settings instead of on every upload; and leaving a group takes your photos out of it.
-- Visibility: 'friends' (the default) or 'only_me'; a single photo
-- can still be changed later (including to a group).
--
-- Stored on the person's profile row but, unlike the unit preferences, NOT added to the
-- column grants for signed-in users (20261121000003): others can't read it. The person reads
-- and changes it only through the two functions below.

ALTER TABLE public.profiles
  ADD COLUMN food_photo_visibility text NOT NULL DEFAULT 'friends' CHECK (food_photo_visibility IN ('friends', 'only_me'));

CREATE FUNCTION public.food_photo_default()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT food_photo_visibility FROM public.profiles WHERE id = auth.uid()), 'friends');
$$;

-- Sets the default; with p_apply_existing also changes the person's existing photos:
-- 'only_me' hides every photo (group ones too); 'friends' shows the only-me ones to friends
-- (group photos stay with their group). Returns how many photos changed.
CREATE FUNCTION public.set_food_photo_default(p_visibility text, p_apply_existing boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me uuid := auth.uid();
  n  integer := 0;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF p_visibility IS NULL OR p_visibility NOT IN ('friends', 'only_me') THEN RAISE EXCEPTION 'invalid_visibility'; END IF;
  UPDATE public.profiles SET food_photo_visibility = p_visibility WHERE id = me;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF coalesce(p_apply_existing, false) THEN
    IF p_visibility = 'only_me' THEN
      UPDATE public.food_photos SET visibility = 'only_me', group_id = NULL WHERE owner_id = me AND visibility <> 'only_me';
    ELSE
      UPDATE public.food_photos SET visibility = 'friends' WHERE owner_id = me AND visibility = 'only_me';
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  RETURN n;
END;
$$;

-- When someone leaves a group or is removed from it, their photos shared with that group
-- become only_me (F1b checked membership only when adding; this closes the gap).
CREATE FUNCTION private.food_photos_member_left()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.food_photos SET visibility = 'only_me', group_id = NULL
  WHERE owner_id = OLD.user_id AND group_id = OLD.group_id;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.food_photos_member_left() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER food_photos_after_member_left
  AFTER DELETE ON public.social_group_members
  FOR EACH ROW EXECUTE FUNCTION private.food_photos_member_left();

REVOKE EXECUTE ON FUNCTION public.food_photo_default(), public.set_food_photo_default(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.food_photo_default(), public.set_food_photo_default(text, boolean) TO authenticated;

-- Rollback (run manually, then `supabase migration repair --status reverted 20261127000003`):
-- DROP TRIGGER food_photos_after_member_left ON public.social_group_members;
-- DROP FUNCTION private.food_photos_member_left();
-- DROP FUNCTION public.set_food_photo_default(text, boolean), public.food_photo_default();
-- ALTER TABLE public.profiles DROP COLUMN food_photo_visibility;
