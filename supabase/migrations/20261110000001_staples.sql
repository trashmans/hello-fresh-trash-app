-- Rollout phase 4, step 1 (docs/adr/0005): staples and the retailer product cache.
--
-- public.retailer_products — products the app has seen in a retailer search (AH for now).
--   No owner: any signed-in user can read it; only the service role writes it (the
--   retailer-products Edge Function upserts what a search returns). Holds product facts
--   only (title, pack size, last price), never anything about a person.
--
-- public.household_staples — things a household buys regularly, owned by the household
--   (docs/adr/0001). A staple either pins one retailer product (product_external_id) or
--   keeps a search term the planner resolves each week (search_term), like the local
--   trial's staples.json. Columns match the planner's staple rows in src/lib/staples.js
--   and src/lib/stockup.js (quantity, cadence_weeks, perishable, max_weeks_stock,
--   skip_next, active, last_added_on, covered_until), so no mapping layer is needed.
--   Stock-up on bonus only applies to non-perishables, which then need max_weeks_stock.
--
-- Access: household members can read, add, change and delete their household's staples,
-- through private.is_household_member() like the other household tables. anon gets nothing.
-- Erasure: deleting the household deletes its staples (CASCADE). Products are not
-- personal data and stay.

CREATE TABLE public.retailer_products (
  retailer        text        NOT NULL CHECK (retailer ~ '^[a-z][a-z0-9_]{1,19}$'),
  external_id     bigint      NOT NULL CHECK (external_id > 0),
  title           text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  sales_unit_size text        CHECK (sales_unit_size IS NULL OR char_length(sales_unit_size) <= 60),
  price           numeric(8,2) CHECK (price IS NULL OR price >= 0),
  orderable       boolean     NOT NULL DEFAULT true,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (retailer, external_id)
);

ALTER TABLE public.retailer_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retailer_products FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.retailer_products FROM authenticated;

CREATE POLICY "signed-in users can read retailer products"
  ON public.retailer_products FOR SELECT TO authenticated
  USING (true);

CREATE TABLE public.household_staples (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name                text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  retailer            text        NOT NULL DEFAULT 'ah' CHECK (retailer ~ '^[a-z][a-z0-9_]{1,19}$'),
  product_external_id bigint,
  search_term         text        CHECK (search_term IS NULL OR char_length(btrim(search_term)) BETWEEN 2 AND 60),
  quantity            smallint    NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 20),
  cadence_weeks       smallint    NOT NULL DEFAULT 1 CHECK (cadence_weeks BETWEEN 1 AND 12),
  perishable          boolean     NOT NULL DEFAULT true,
  max_weeks_stock     smallint    CHECK (max_weeks_stock IS NULL OR max_weeks_stock BETWEEN 1 AND 26),
  skip_next           boolean     NOT NULL DEFAULT false,
  active              boolean     NOT NULL DEFAULT true,
  last_added_on       date,
  covered_until       date,
  created_by          uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT household_staples_product_or_search
    CHECK (product_external_id IS NOT NULL OR search_term IS NOT NULL),
  CONSTRAINT household_staples_stock_up_rule
    CHECK ((perishable AND max_weeks_stock IS NULL) OR (NOT perishable AND max_weeks_stock IS NOT NULL)),
  CONSTRAINT household_staples_product_fk
    FOREIGN KEY (retailer, product_external_id) REFERENCES public.retailer_products (retailer, external_id)
);

CREATE INDEX household_staples_household_idx ON public.household_staples (household_id);

ALTER TABLE public.household_staples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.household_staples FROM anon;

CREATE POLICY "members can read household staples"
  ON public.household_staples FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));
CREATE POLICY "members can add household staples"
  ON public.household_staples FOR INSERT TO authenticated
  WITH CHECK (private.is_household_member(household_id) AND created_by = (SELECT auth.uid()));
CREATE POLICY "members can change household staples"
  ON public.household_staples FOR UPDATE TO authenticated
  USING (private.is_household_member(household_id))
  WITH CHECK (private.is_household_member(household_id));
CREATE POLICY "members can remove household staples"
  ON public.household_staples FOR DELETE TO authenticated
  USING (private.is_household_member(household_id));

-- Rollback (run manually, then `supabase migration repair --status reverted 20261110000001`).
-- Deletes every household's staples:
-- DROP TABLE public.household_staples;
-- DROP TABLE public.retailer_products;
