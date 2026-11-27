# 0004. All retailer calls go through one adapter

- Status: Accepted
- Date: 2026-10-24
- Amended: 2026-11-13 (preview test windows), 2026-11-26 (terms of use, proposed)
- Deciders: Chris, David

## Context

Albert Heijn has no public API. The spike uses the unofficial mobile API, which AH can change or block at any time, and AH's terms may not allow automated access. If AH calls are spread through the run logic, one AH change breaks many places, and adding another retailer means a rewrite.

## Decision

- One adapter module per retailer, behind a shared interface:
  `getAccessToken`, `searchProducts`, `getPromotions`, `readList`, `writeListLines`.
- Tables and functions use retailer-neutral names: `retailer_accounts.retailer = 'ah'`, `products (retailer, external_id)`.
- The adapter validates every AH response against a schema before passing data on. A failed check stops the run with a clear error code instead of writing wrong data.
- Calls use timeouts, retry with exponential backoff, and a low request rate.
- A kill switch (`RETAILER_AH_ENABLED`) turns all AH traffic off without a deploy.
- Personal bonus offers returned by AH are never written to shared tables; only national promotions are cached.
- **A fake adapter** returns recorded responses. Preview and local use it by default; production always uses the real AH adapter.
- **Real-AH test windows on preview** (amended 2026-11-13, see below): with `RETAILER_AH_MODE=real` set on the preview project, preview uses the real AH adapter, so a feature is tested end to end against the real AH before it is promoted to production. Link a dedicated test AH account where AH allows one; otherwise the owner's own account, for a single short test window, unlinked straight after.
- The run logic is plan, diff, apply: the plan and diff are pure functions in `src/lib/` with Vitest tests. Only apply talks to the adapter.

## Consequences

- An AH API change is fixed in one file.
- By default preview deploys never touch a real AH account. A test window is the one exception to the README's "no real data in preview" rule, and it is kept short: the linked account is unlinked (its token deleted) and the setting removed straight after.
- A second retailer is a new adapter plus a `retailer` value, not a schema change.
- The fake adapter's recorded responses must be scrubbed of personal data before they are committed (public repo).

## Amendment 2026-11-13: real-AH test windows on preview

- Deciders: Chris, David
- Why: production should never be the first place the deployed code meets the real AH ("feature doesn't work in preview? You don't promote it to prod"). Before this, the real AH calls had only been tested from the local spike, not through the Edge Functions, encrypted token storage and refresh.
- How: `RETAILER_AH_MODE=real` (exactly that value) on the preview project switches preview to the real adapter; `RETAILER_AH_ENABLED=true` is still needed, so the kill switch works the same. Production ignores the setting and always uses the real adapter.
- Which account: a dedicated test AH account where AH allows one. AH requires a phone number and a delivery address for a new account, so that isn't practical today; until it is, the owner (Chris) links his own account for the window.
- Guardrails, because unreviewed PR code runs on preview and the token opens the whole AH account (name, address, phone, order history, list):
  - one test window at a time, done in a single sitting;
  - no other PR that touches `supabase/functions/` is opened or updated during the window (only Chris and David can deploy to preview; Dependabot PRs don't deploy);
  - afterwards, unlink in the app (deletes the stored token at once) and unset `RETAILER_AH_MODE` (back to the fake);
  - real mode is never left on between windows.

## Amendment 2026-11-26: retailers' terms of use (proposed, to be agreed by Chris and David)

- Why: a Jumbo price spike (`spike/jumbo-api/FINDINGS.md`) found that Jumbo's terms forbid scraping and repeated, systematic retrieval of site content. That raised the same question for the AH integration.
- **AH's terms** (read: current consumer terms of 7 Sep 2026, same wording as 4 Oct 2024 on these points): no clause on automated access, scraping or robots. They do say the account is for personal use only; content may be copied only for personal use; the AH app may not be decompiled, reverse-engineered or connected to a network so other devices can use it; AH may block an account for misuse. Summary in `spike/ah-api/FINDINGS.md`.
- **Our position:** the AH adapter uses AH's unofficial app API, with endpoints others found by reverse-engineering the app (taken from appie-go); we did not decompile the app ourselves. Each household links its own account and the app acts only for that household, which fits "personal use" best. This is not explicit permission, and AH can change or block the API at any time.
- **Accepted risk, with limits:**
  - AH stays limited to households that link their own account for their own shopping. No AH data is published, resold or shown outside the household (the product cache holds only titles, pack sizes, prices and photo links).
  - Sending stays limited to Chris's household until the deciders agree otherwise (ADR 0005 point 2). Before opening it to households beyond the two deciders' own, re-read AH's current terms and consider asking AH for consent.
  - Keep request volume low: as now, at most 25 product searches per preview, and one send at a time.
  - If AH objects or blocks access, the kill switch (`RETAILER_AH_ENABLED`) turns the integration off at once; the rest of the app does not depend on it.
- **Jumbo:** no automated access while its terms forbid it (Artikel 9 lid 3 of the B2C terms of 19 May 2026). Options are permission from Jumbo, a licensed price source, or prices typed in by the household.
- Not legal advice.

## Alternatives considered

- **Call AH directly from each Edge Function.** Rejected: spreads the riskiest dependency everywhere.
- **Use the spike script in production.** Rejected: it is a test tool with no locking, validation or backoff.
