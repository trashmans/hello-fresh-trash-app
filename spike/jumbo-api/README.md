# Jumbo price spike (phase J1)

Throwaway test for one question: **can the app look up Jumbo product prices by name, reliably, without an account?** Wanted for comparing the weekly list's cost at AH and Jumbo. Nothing here is part of the app or deployed by CI.

Jumbo has no public API. The old mobile-app API the open-source wrappers used no longer answers; the website has its own internal API. This spike only loads the public product search page, as a browser does, and reports what machine-readable data it carries.

## Run

Node 18+ only, no `npm install`. From the repo root:

```
node spike/jumbo-api/prices.mjs                    # melk, olijfolie, kipfilet
node spike/jumbo-api/prices.mjs "basmati rijst"    # up to 5 terms
node spike/jumbo-api/prices.mjs --product https://www.jumbo.com/producten/<name>-<sku>   # a product's own page
```

One page per term, 3 seconds apart, no login. Raw pages go to `spike/jumbo-api/out/` (git-ignored).

## Still to check by hand

- Jumbo's terms of use: are automated price lookups allowed?
- Whether the same request works from a Supabase Edge Function (server address, not a home connection).

Findings go in `FINDINGS.md`.
