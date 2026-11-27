-- Food map, phase F1b (docs/adr/0012, DPIA docs/privacy/dpia-food-map.md): food photos and
-- where they were eaten.
--
-- public.food_photos   one row per photo. Files are the shrunk copies made in the browser
--                      (no metadata, docs F1a): photo_path (1600 px) and thumb_path (400 px) in
--                      the private food-photos bucket under <owner id>/. Location: a place name
--                      with coordinates, either the nearest city (precision 'city', the default
--                      in the app) or a spot the owner chose ('exact'); no location means the
--                      photo stays off the map. taken_on is a date only. visibility: 'friends'
--                      (the owner's friends), 'group' (members of one group the owner is in) or
--                      'only_me'. Dish fields come with phase F3.
--
-- Access: RLS. The owner reads all their photos; friends read 'friends' photos; members read
-- that group's 'group' photos; nobody else, and anon nothing. Adding and changing go through
-- add_food_photo() / update_food_photo(), which check the 300-photo limit, the group and the
-- location; the owner deletes rows directly. Unfriending or leaving a group ends access at once.
-- Deleting a group turns its photos to 'only_me'. Erasure: deleting the account deletes the
-- rows (CASCADE); the files are removed by the app (F1d) or the account clean-up (Phase 8).
--
-- Storage: a private bucket (JPEG only, 2 MB a file). Upload and delete only in your own
-- folder; read a file when you may read the photo row it belongs to (the subquery runs under
-- the table's RLS).

CREATE TABLE public.food_photos (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_path  text        NOT NULL,
  thumb_path  text        NOT NULL,
  place_name  text        CHECK (place_name IS NULL OR char_length(place_name) BETWEEN 1 AND 200),
  lat         double precision CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lon         double precision CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
  precision   text        CHECK (precision IN ('city', 'exact')),
  taken_on    date        CHECK (taken_on IS NULL OR taken_on BETWEEN DATE '1990-01-01' AND DATE '2100-01-01'),
  visibility  text        NOT NULL DEFAULT 'friends' CHECK (visibility IN ('friends', 'group', 'only_me')),
  group_id    uuid        REFERENCES public.social_groups(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- A location is all four fields or none.
  CHECK ((lat IS NULL) = (lon IS NULL) AND (lat IS NULL) = (precision IS NULL) AND (lat IS NULL) = (place_name IS NULL)),
  CHECK ((visibility = 'group') = (group_id IS NOT NULL)),
  -- Files live in the owner's folder, one level deep: <owner id>/<name>.jpg (no '..' or subfolders).
  CHECK (photo_path ~ ('^' || owner_id::text || '/[A-Za-z0-9_-]{1,80}\.jpg$')
         AND thumb_path ~ ('^' || owner_id::text || '/[A-Za-z0-9_-]{1,80}\.jpg$') AND photo_path <> thumb_path)
);
CREATE INDEX food_photos_owner_idx ON public.food_photos (owner_id, created_at DESC);
CREATE INDEX food_photos_group_idx ON public.food_photos (group_id) WHERE group_id IS NOT NULL;

ALTER TABLE public.food_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_photos FROM anon;

CREATE POLICY "owners, friends and group members can read food photos"
  ON public.food_photos FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR (visibility = 'friends' AND EXISTS (
          SELECT 1 FROM public.friendships f WHERE f.user_id = (SELECT auth.uid()) AND f.friend_id = food_photos.owner_id))
    OR (visibility = 'group' AND private.is_group_member(group_id))
  );

CREATE POLICY "owners can delete their food photos"
  ON public.food_photos FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

-- A deleted group's photos become 'only_me' (before the group row goes).
CREATE FUNCTION private.food_photos_group_deleted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.food_photos SET visibility = 'only_me', group_id = NULL WHERE group_id = OLD.id;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.food_photos_group_deleted() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER food_photos_before_group_delete
  BEFORE DELETE ON public.social_groups
  FOR EACH ROW EXECUTE FUNCTION private.food_photos_group_deleted();

-- Checks shared by add and update. Errors are short codes (as in the Social migrations):
-- invalid_location, invalid_visibility, not_group_member.
CREATE FUNCTION private.check_food_photo(p_place text, p_lat double precision, p_lon double precision, p_precision text,
                                         p_visibility text, p_group uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce((p_lat IS NULL AND p_lon IS NULL AND p_precision IS NULL AND p_place IS NULL)
          OR (p_lat BETWEEN -90 AND 90 AND p_lon BETWEEN -180 AND 180 AND p_precision IN ('city', 'exact')
              AND char_length(btrim(coalesce(p_place, ''))) BETWEEN 1 AND 200), false) THEN
    RAISE EXCEPTION 'invalid_location';
  END IF;
  IF NOT coalesce(p_visibility IN ('friends', 'group', 'only_me') AND (p_visibility = 'group') = (p_group IS NOT NULL), false) THEN
    RAISE EXCEPTION 'invalid_visibility';
  END IF;
  IF p_group IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.social_group_members WHERE group_id = p_group AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_group_member';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.check_food_photo(text, double precision, double precision, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.add_food_photo(p_photo_path text, p_thumb_path text, p_place text, p_lat double precision,
                                      p_lon double precision, p_precision text, p_taken_on date, p_visibility text, p_group uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me  uuid := auth.uid();
  pid uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  PERFORM private.check_food_photo(p_place, p_lat, p_lon, p_precision, p_visibility, p_group);
  IF NOT coalesce(p_photo_path ~ ('^' || me::text || '/[A-Za-z0-9_-]{1,80}\.jpg$')
                  AND p_thumb_path ~ ('^' || me::text || '/[A-Za-z0-9_-]{1,80}\.jpg$')
                  AND p_photo_path <> p_thumb_path, false) THEN
    RAISE EXCEPTION 'invalid_path';
  END IF;
  -- One add at a time per person, so the limit can't be passed by adding in parallel.
  PERFORM pg_advisory_xact_lock(hashtextextended('food_photos:' || me::text, 0));
  IF (SELECT count(*) FROM public.food_photos WHERE owner_id = me) >= 300 THEN RAISE EXCEPTION 'photo_limit'; END IF;
  INSERT INTO public.food_photos (owner_id, photo_path, thumb_path, place_name, lat, lon, precision, taken_on, visibility, group_id)
  VALUES (me, p_photo_path, p_thumb_path, nullif(btrim(p_place), ''), p_lat, p_lon, p_precision, p_taken_on, p_visibility, p_group)
  RETURNING id INTO pid;
  RETURN pid;
END;
$$;

-- Changes the location and who can see it (not the files or the date).
CREATE FUNCTION public.update_food_photo(p_photo uuid, p_place text, p_lat double precision, p_lon double precision,
                                         p_precision text, p_visibility text, p_group uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  PERFORM private.check_food_photo(p_place, p_lat, p_lon, p_precision, p_visibility, p_group);
  UPDATE public.food_photos
  SET place_name = nullif(btrim(p_place), ''), lat = p_lat, lon = p_lon, precision = p_precision, visibility = p_visibility, group_id = p_group
  WHERE id = p_photo AND owner_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_food_photo(text, text, text, double precision, double precision, text, date, text, uuid),
  public.update_food_photo(uuid, text, double precision, double precision, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_food_photo(text, text, text, double precision, double precision, text, date, text, uuid),
  public.update_food_photo(uuid, text, double precision, double precision, text, text, uuid) TO authenticated;

-- Storage --------------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('food-photos', 'food-photos', false, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "food-photos: upload to own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'food-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

CREATE POLICY "food-photos: delete in own folder"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'food-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

-- Read: your own folder, or a file of a photo row you may read (RLS on food_photos applies).
CREATE POLICY "food-photos: read own files and photos you may see"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'food-photos'
    AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
         OR EXISTS (SELECT 1 FROM public.food_photos p WHERE p.photo_path = storage.objects.name OR p.thumb_path = storage.objects.name))
  );

-- Rollback (run manually, then `supabase migration repair --status reverted 20261127000001`).
-- Empty the bucket first (Storage → food-photos → delete all), then:
-- DROP POLICY "food-photos: read own files and photos you may see" ON storage.objects;
-- DROP POLICY "food-photos: delete in own folder" ON storage.objects;
-- DROP POLICY "food-photos: upload to own folder" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'food-photos';
-- DROP FUNCTION public.update_food_photo(uuid, text, double precision, double precision, text, text, uuid),
--   public.add_food_photo(text, text, text, double precision, double precision, text, date, text, uuid),
--   private.check_food_photo(text, double precision, double precision, text, text, uuid);
-- DROP TRIGGER food_photos_before_group_delete ON public.social_groups;
-- DROP FUNCTION private.food_photos_group_deleted();
-- DROP TABLE public.food_photos;
