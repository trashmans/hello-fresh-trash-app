# 0009. Recipes can be imported from a web link

- Status: Accepted
- Date: 2026-11-22
- Deciders: Chris (David reviews the PR)

## Context

Recipes could only be added as PDFs. Many recipes people want to cook are on websites. Most recipe sites publish the recipe as schema.org `Recipe` data (JSON-LD) for search engines; some only build the page in the browser, and some put recipes behind a paywall. Fetching a URL that a user supplies from our server is a classic way to reach internal services (SSRF).

## Decision

1. **Same pipeline as PDFs.** The app inserts a `recipes` row with `source_url` and no `storage_path`; the existing webhook runs `parse-recipe`, which fetches the page instead of downloading a PDF. The Gemini prompt, duplicate checks, statuses, Retry and admin re-parse are shared. A link already in the catalogue is rejected as a duplicate.
2. **Recipe data first, then page text, then Gemini's url_context.** `parse-recipe` reads the page's schema.org Recipe (`_shared/recipeLink.ts`) and writes it out like a recipe card for Gemini. Without Recipe data it sends the page's readable text; when that is almost empty (pages built in the browser) Gemini reads the link itself with its url_context tool. Paywalled recipes fail like an unreadable PDF.
3. **Safe fetching** (`_shared/safeFetch.ts`): https only, no IP addresses, local names, logins or odd ports; every address the host resolves to must be public, checked again on each of at most 3 redirects; only HTML (3 MB) or JPEG/PNG/WebP (5 MB); 10 s per fetch.
4. **The cover photo is stored.** The page's main photo (Recipe image, else `og:image`) is downloaded once and stored like a PDF cover, so it always loads and no viewer's browser contacts the recipe site. It is kept for this private, invite-only app; the recipe page links to the original.
5. **Steps are written in Gemini's own words**, as for PDFs; the original page is linked, not copied.

## Consequences

- One code path for both kinds of recipe; PDF behaviour is unchanged.
- Our server contacts the recipe site (its IP, not the user's), and the page text goes to Gemini. The privacy policy and record of processing say so.
- Remaining SSRF risk: the runtime resolves the host again when connecting (DNS rebinding). Acceptable because Supabase Edge Functions don't reach our database or other private services by address; the checks stop ordinary attempts.
- Sites that block automated requests will fail; the person can still save the page as PDF and upload it.

## Alternatives considered

- **A separate import function with a refactored prompt module.** Rejected: more code and two pipelines to keep in step.
- **Showing the photo from the recipe site** (no copy). Rejected: breaks when the site changes and makes every viewer's browser contact the site.
- **Recipe data only, no Gemini fallback.** Rejected: too many sites would fail.
