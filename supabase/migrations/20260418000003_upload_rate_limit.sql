CREATE OR REPLACE FUNCTION public.check_upload_rate_limit()
RETURNS TRIGGER AS $func$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM public.recipes
    WHERE uploaded_by = NEW.uploaded_by
      AND created_at > now() - INTERVAL '1 hour'
  ) >= 20 THEN
    RAISE EXCEPTION 'Upload rate limit exceeded. Maximum 20 uploads per hour.';
  END IF;

  RETURN NEW;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE TRIGGER enforce_upload_rate_limit
  BEFORE INSERT ON public.recipes
  FOR EACH ROW
  EXECUTE FUNCTION public.check_upload_rate_limit();
