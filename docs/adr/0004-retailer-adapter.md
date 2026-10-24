# 0004. All retailer calls go through one adapter

- Status: Accepted
- Date: 2026-10-24
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
- **A fake adapter** returns recorded responses. Preview and local always use it; only production uses the real AH adapter.
- The run logic is plan, diff, apply: the plan and diff are pure functions in `src/lib/` with Vitest tests. Only apply talks to the adapter.

## Consequences

- An AH API change is fixed in one file.
- Preview deploys can never touch a real AH account, matching the README's "no real data in preview" rule.
- A second retailer is a new adapter plus a `retailer` value, not a schema change.
- The fake adapter's recorded responses must be scrubbed of personal data before they are committed (public repo).

## Alternatives considered

- **Call AH directly from each Edge Function.** Rejected: spreads the riskiest dependency everywhere.
- **Use the spike script in production.** Rejected: it is a test tool with no locking, validation or backoff.
