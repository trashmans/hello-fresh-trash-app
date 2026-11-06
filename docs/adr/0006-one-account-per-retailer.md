# 0006. One account per retailer per household

- Status: Accepted
- Date: 2026-11-06
- Deciders: Chris
- Supersedes: the "One retailer account per household" rule in [0001](0001-household-ownership.md). The rest of 0001 stands.

## Context

ADR 0001 allowed one retailer account per household, written with Albert Heijn in mind. ADR 0004 already puts every retailer behind one adapter with retailer-neutral tables, so Jumbo or Picnic can be added later. If `private.retailer_accounts` is created with "one per household", supporting a second store means changing a unique constraint on a table that holds encrypted credentials, plus every query that assumes a single account. Rollout phase 3 creates that table, so the rule has to be settled first.

## Decision

- A household can link at most one account **per retailer**: `UNIQUE (household_id, retailer)` on `private.retailer_accounts`, where `retailer` is a fixed code such as `ah`.
- The adapter, the weekly run and the Settings screen always work with a (household, retailer) pair, never "the household's account".
- Only `ah` is supported until rollout phase 6 has run cleanly. Each further retailer needs its own spike first (unofficial APIs, different logins).

## Consequences

- Adding Jumbo or Picnic later needs no schema change to `retailer_accounts`, only a new adapter and a new retailer code.
- Code that looks up a household's account must always pass the retailer, which is slightly more verbose now.
- Weekly runs and run lines need to say which retailer they targeted; this is added when those tables are created (phases 5–7).
- Linking, unlinking and token refresh are per (household, retailer), so the single-flight refresh lock from ADR 0003 is held on that row.

## Alternatives considered

- **Keep one account per household.** Rejected: cheap now, but a migration on the most sensitive table later.
- **Allow several accounts for the same retailer.** Rejected: no use case, and it makes "which list do we fill?" ambiguous.
