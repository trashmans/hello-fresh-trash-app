# Jumbo price spike — findings (26 Nov 2026)

Question: can the app look up Jumbo product prices without an account, to compare the weekly list's cost at AH and Jumbo? Run by Chris from his home connection with `prices.mjs`.

## 1. Search page: no

`https://www.jumbo.com/producten/?searchTerms=<term>` (melk, olijfolie, kipfilet) returns HTTP 200 in about 0.6–0.8 s, no bot check. The page is a Nuxt 3 app: no JSON-LD, and its embedded data (`__NUXT_DATA__`, a flat "devalue" array) holds **one product only, the sponsored one**. The real results are loaded afterwards in the browser from Jumbo's internal GraphQL API (`/api/graphql`, Apollo, CSRF-protected). Using that API directly would mean relying on an unofficial, undocumented interface; not pursued.

The old mobile-app API used by open-source wrappers (`mobileapi.jumbo.com`) no longer answers.

## 2. Product page: yes

`https://www.jumbo.com/producten/<slug>-<sku>` (tested: Arla Bio Volle Melk 1,5 L `284485PAK`, Bertolli extra vierge olijfolie `605387FLS`) returns HTTP 200 in 0.5–1.2 s and carries the product twice:

- **schema.org `Product` JSON-LD** (published for search engines): `name`, `brand`, `sku`, `gtin13` (EAN), `image`, `url`, `category`, and `offers` as an `AggregateOffer` with `lowPrice` / `highPrice` in euros (2.69, 8.29).
- **Nuxt data**: `id`/`sku`, `ean`, `title`, `subtitle` = pack size ("1.5 liter", "500 ml"), `image` (`https://www.jumbo.com/dam-images/…`), `price` in cents (`price` 269, `promoPrice` or null, `pricePerUnit` {179, "l"}), `promotions` (tags, e.g. a delivery promotion on the olive oil), `assortmentEligibility.orderable`, availability.

So a known product can be priced from its own page. The JSON-LD is the most stable and the most clearly public source; pack size, the offer price and promotions come from the Nuxt data.

## 3. Finding the product

Search isn't usable, so a product has to be found another way. The app already does this for AH: *Suggest AH products* asks Gemini with Google Search grounding for the store's Dutch product name. The same can return a jumbo.com product link, which the server then checks (host `www.jumbo.com`, path `/producten/…-<sku>`) and reads. A household can also paste a Jumbo product link by hand. The EAN (`gtin13`) could later match the same product at AH and Jumbo.

## 4. Still open

- **Jumbo's terms of use** (algemene voorwaarden) on automated use: to be checked by Chris before building.
- Whether the product page answers the same from a Supabase Edge Function (server address) as from a home connection. To test in J2 with one function call before anything else.
- Request volume: one page per mapped product, cached (prices change weekly; refresh at most once a day per product), so a household's comparison is a few dozen page loads a week at most.

## Recommendation

Build price comparison (J2) on product pages: find products with Gemini + Google Search or a pasted link, read price and pack size from the product page server-side through `safeFetch`, cache them in `retailer_products` (`retailer = 'jumbo'`), and keep Jumbo mappings per ingredient next to the AH ones. Ordering from Jumbo (J3) needs an account and its own spike.
