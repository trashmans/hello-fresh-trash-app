-- Product photos in the product cache (roadmap item I).
--
-- public.retailer_products gets image_url: the AH product photo used for thumbnails
-- (supabase/functions/_shared/retailer/ahSchema.ts picks the 200 px size). Product facts only, nothing
-- about a person. Written by the retailer-products and retailer-week Edge Functions with
-- every product they see; a search that returns no photo keeps the one already cached.
--
-- Only https URLs on AH's image host are allowed, matching the adapter's own check and the
-- app's Content-Security-Policy (img-src), so the cache can't hold a link to anywhere else.
-- Existing rows start without a photo and get one the next time the product is seen.
--
-- No new table and no policy change: signed-in users already read this table and only the
-- service role writes it (migration 20261110000001).

ALTER TABLE public.retailer_products
  ADD COLUMN image_url text
    CONSTRAINT retailer_products_image_url_check
    CHECK (image_url IS NULL OR (image_url LIKE 'https://static.ah.nl/%' AND char_length(image_url) <= 500));

-- Rollback (run manually, then `supabase migration repair --status reverted 20261119000001`).
-- Only the photos are lost; the screens fall back to placeholders:
-- ALTER TABLE public.retailer_products DROP COLUMN image_url;
